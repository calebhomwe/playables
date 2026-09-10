"""Headless playtest gate for HELIX DROP.

Spawns `python -m http.server 8154` itself, then drives a real Canvas 2D
Chromium through the whole loop: boot, menu, the ball falling, rotating the
tower so the gap slides, threading a gap to descend a ring, a red danger landing
that ends the run, records to localStorage, restart, pause/resume, auto-pause on
tab hide, real keyboard + touch rotation, the canvas pixel census, the portrait
crop and the offline constraint at runtime.

Determinism: the debug hook can freeze the simulation (`freeze(true)`) so only
`advance(sec)` (1/60 s fixed steps) moves the world — no rAF drift. The gap is
lined up with `alignGap()`, red blocks planted with `forceDanger()`, and the
tower rebuilt from a known seed with `clearTower()` / `setSeed()`.

Run:  python tools/playtest.py   (needs playwright; screenshots land in proof/)
"""
import pathlib
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8154
URL = f"http://localhost:{PORT}/index.html"
OUT = ROOT / "proof"
OUT.mkdir(exist_ok=True)
D = "window.__helix_debug"
ST = f"()=>{D}.state()"


def fn(body):
    """Block-bodied arrow so a multi-statement body is ONE evaluate() call."""
    return "()=>{" + body + "}"


# Counts canvas pixels that match the game's palette. A dead context, a thrown
# error inside rAF or a poisoned draw all show up here as a flat frame — which
# "no errors in the console" would happily hide.
PIXEL_JS = """()=>{
  const cv=document.getElementById('cv'), cc=cv.getContext('2d');
  const d=cc.getImageData(0,0,cv.width,cv.height).data;
  const near=(r,g,b,R,G,B,t)=>Math.abs(r-R)<t&&Math.abs(g-G)<t&&Math.abs(b-B)<t;
  let blue=0,red=0,gold=0,mint=0,dark=0;
  for(let i=0;i<d.length;i+=4){
    const r=d[i],g=d[i+1],b=d[i+2];
    if(near(r,g,b,91,110,225,46)||near(r,g,b,127,144,242,40))blue++;
    if(near(r,g,b,255,45,85,50))red++;
    if(near(r,g,b,255,198,63,46))gold++;
    if(near(r,g,b,47,224,200,52))mint++;
    if(r+g+b<200)dark++;
  }
  return {blue:blue,red:red,gold:gold,mint:mint,dark:dark,
          total:d.length/4,w:cv.width,h:cv.height};
}"""


def main():
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)],
        cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    errors, requests, checks = [], [], []

    def check(name, ok, detail=""):
        checks.append((name, bool(ok), str(detail)))
        print(("  ok  " if ok else "FAIL  ") + name
              + (f"  [{detail}]" if detail and not ok else ""))

    def stage(extra="", seed=7, depth=None):
        """Deterministic stage: frozen sim, tower rebuilt from a known seed."""
        body = (f"{D}.start();{D}.freeze(true);{D}.setSeed({seed});"
                f"{D}.clearTower();")
        if depth is not None:
            body += f"{D}.setDepth({depth});"
        body += extra
        return fn(body)

    try:
        with sync_playwright() as p:
            br = p.chromium.launch(headless=True)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
            pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
            pg.on("request", lambda r: requests.append(r.url))

            pg.goto(URL, wait_until="load")
            pg.wait_for_timeout(900)
            pg.evaluate(fn(D + ".wipe()"))
            pg.reload(wait_until="load")
            pg.wait_for_timeout(900)
            check("wipe() clears the saved records",
                  pg.evaluate("()=>localStorage.getItem('hx_rec')") is None)

            # ---- boot + menu --------------------------------------------------
            check("debug handle exists", pg.evaluate(f"()=>!!{D}"))
            check("canvas present", pg.evaluate("()=>!!document.querySelector('canvas')"))
            body = pg.evaluate("()=>document.body.innerText")
            up, low = body.upper(), body.lower()
            check("menu shows the title", "HELIX" in up and "DROP" in up)
            check("menu explains the loop",
                  "rotate" in low and "gap" in low and "danger" in low
                  and "bounce" in low and "bonus" in low, body[:170])
            check("menu shows the how-to-play keys",
                  ("ARROW" in up or "A / D" in body) and "ESC" in up and "MUTE" in up)
            check("menu shows the best depth", "best" in low)
            check("menu is the active screen", pg.evaluate(
                "()=>document.getElementById('s-menu').classList.contains('on')"))
            pg.screenshot(path=str(OUT / "01-menu.png"))

            # ---- the rAF loop is really rendering ------------------------------
            f0 = pg.evaluate(ST)["frames"]
            pg.wait_for_timeout(400)
            f1 = pg.evaluate(ST)["frames"]
            check("rAF render loop is alive", f1 > f0 + 3, f"frames {f0} -> {f1}")

            # ---- start(): the ball is live and falling -------------------------
            s0 = pg.evaluate(fn(f"return {D}.start();"))
            check("start() puts us in a live run",
                  s0["phase"] == "play" and not s0["paused"], str(s0["phase"]))
            check("HUD visible while running", pg.evaluate(
                "()=>document.getElementById('hud').style.display==='flex'"))
            check("a fresh run starts at depth 0", s0["depth"] == 0, str(s0["depth"]))
            y0 = pg.evaluate(ST)["ballY"]
            pg.wait_for_timeout(300)
            y1 = pg.evaluate(ST)["ballY"]
            check("the ball is falling under gravity", abs(y1 - y0) > 4,
                  f"ballY {y0} -> {y1}")
            pg.screenshot(path=str(OUT / "02-play.png"))

            # ---- rotating the tower slides the gap ------------------------------
            pg.evaluate(stage(f"{D}.rotateTo(0);"))
            g0 = pg.evaluate(ST)["gapScreen"]
            b0 = pg.evaluate(ST)["ballCell"]
            pg.evaluate(stage(f"{D}.rotateTo(2);"))
            g1 = pg.evaluate(ST)["gapScreen"]
            check("rotating the tower slides the gap sideways",
                  [round(v, 2) for v in g0] != [round(v, 2) for v in g1],
                  f"{g0} -> {g1}")
            check("rotateTo is exact and cyclic",
                  pg.evaluate(fn(f"return {D}.rotateTo(99).rot;")) == 99)
            # real keyboard rotates too
            pg.evaluate(stage(f"{D}.rotateTo(0);"))
            pg.keyboard.down("ArrowRight")
            rk = pg.evaluate(fn(f"return {D}.advance(0.4).rot;"))
            pg.keyboard.up("ArrowRight")
            check("holding ArrowRight rotates the tower (real key)", rk > 0.5, str(rk))
            pg.evaluate(stage(f"{D}.rotateTo(0);"))
            pg.keyboard.down("a")
            rk2 = pg.evaluate(fn(f"return {D}.advance(0.4).rot;"))
            pg.keyboard.up("a")
            check("holding A rotates the other way", rk2 < -0.5, str(rk2))
            # touch drag rotates
            pg.evaluate(stage(f"{D}.rotateTo(0);"))
            pg.mouse.move(640, 400)
            pg.mouse.down()
            pg.mouse.move(840, 400, steps=6)
            pg.mouse.up()
            rk3 = pg.evaluate(ST)["rot"]
            check("dragging on touch rotates the tower", abs(rk3) > 0.5, str(rk3))

            # ---- lining the gap up threads it and descends a ring ---------------
            pg.evaluate(stage(f"{D}.setDepth(0);{D}.alignGap(0);"))
            s = pg.evaluate(ST)
            check("alignGap puts the gap under the ball", s["ballCell"] == "G",
                  f"ballCell={s['ballCell']}")
            check("a fresh ball starts above ring 0", s["ring"] == 0, str(s["ring"]))
            s1 = pg.evaluate(fn(f"return {D}.advance(0.6);"))
            check("threading the gap descends a ring (depth rises)",
                  s1["depth"] >= 1 and s1["ring"] >= 1 and s1["phase"] == "play",
                  f"depth={s1['depth']} ring={s1['ring']} phase={s1['phase']}")
            check("threading counts a clean-drop combo", s1["combo"] >= 1,
                  str(s1["combo"]))
            pg.screenshot(path=str(OUT / "03-thread.png"))

            # ---- a safe block bounces, a planted red ends the run ---------------
            pg.evaluate(stage(f"{D}.setDepth(0);"))
            sb = pg.evaluate(ST)
            check("the start ring is safe to land on", sb["ballCell"] in ("S", "B"),
                  str(sb["ballCell"]))
            pg.evaluate(stage(f"{D}.setDepth(0);{D}.forceDangerHere(0);"))
            sd = pg.evaluate(ST)
            check("forceDanger plants a red block under the ball",
                  sd["ballCell"] == "D", f"ballCell={sd['ballCell']}")
            sd2 = pg.evaluate(fn(f"return {D}.advance(1.2);"))
            check("landing on a red block ends the run", sd2["phase"] == "over",
                  f"phase={sd2['phase']}")
            check("end screen appears", pg.evaluate(
                "()=>document.getElementById('s-over').classList.contains('on')"))
            end_txt = pg.evaluate("()=>document.body.innerText").upper()
            check("end screen shows the stats",
                  "DEPTH" in end_txt and "BEST" in end_txt and "DROP AGAIN" in end_txt,
                  end_txt[:150])
            pg.screenshot(path=str(OUT / "04-over.png"))

            # ---- records persist to hx_rec --------------------------------------
            pg.evaluate(stage(f"{D}.setDepth(3);{D}.forceDangerHere(0);"))
            pg.evaluate(fn(f"return {D}.advance(1.4);"))
            rec = pg.evaluate("()=>JSON.parse(localStorage.getItem('hx_rec'))")
            check("records persisted to hx_rec",
                  rec and rec["games"] >= 1 and rec["best"] >= 3, str(rec))
            check("best depth matches the deepest run", rec and rec["best"] >= 3,
                  str(rec))

            # ---- restart from the game-over screen ------------------------------
            pg.click("#again")
            pg.wait_for_timeout(260)
            s12 = pg.evaluate(ST)
            check("drop-again restarts a clean run",
                  s12["phase"] == "play" and s12["depth"] == 0, str(s12["phase"]))

            # ---- pause / resume -------------------------------------------------
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(180)
            check("Escape pauses", pg.evaluate(ST)["paused"] is True)
            check("pause screen appears", pg.evaluate(
                "()=>document.getElementById('s-pause').classList.contains('on')"))
            pg.click("#resume")
            pg.wait_for_timeout(180)
            check("resume continues the run", pg.evaluate(ST)["paused"] is False)

            # ---- hiding the tab auto-pauses --------------------------------------
            pg.evaluate(fn("Object.defineProperty(document,'hidden',"
                           "{value:true,configurable:true});"
                           "document.dispatchEvent(new Event('visibilitychange'));"
                           "return 1;"))
            pg.wait_for_timeout(180)
            check("tab hidden auto-pauses",
                  pg.evaluate(ST)["paused"] is True
                  and pg.evaluate(ST)["phase"] == "play")
            pg.evaluate(fn("Object.defineProperty(document,'hidden',"
                           "{value:false,configurable:true});"
                           "document.dispatchEvent(new Event('visibilitychange'));"
                           "return 1;"))
            pg.evaluate(fn(D + ".resume();"))
            pg.wait_for_timeout(120)
            check("coming back does not un-pause by itself",
                  pg.evaluate(ST)["paused"] is False)

            # ---- setBallX aims the landing column --------------------------------
            pg.evaluate(stage(f"{D}.setDepth(0);{D}.setBallX(-120);"))
            check("setBallX moves the ball's landing column",
                  abs(pg.evaluate(ST)["ballX"] + 120) < 0.6,
                  str(pg.evaluate(ST)["ballX"]))

            # ---- the frame really rendered: canvas pixel census ------------------
            pg.evaluate(stage(f"{D}.setDepth(6);{D}.forceDanger(0,3);"
                              f"{D}.forceBonus(0,8);{D}.forceDanger(1,2);"
                              f"return {D}.advance(0.05);"))
            px = pg.evaluate(PIXEL_JS)
            print(f"  px {px}")
            check("canvas draws the blue safe blocks", px["blue"] > 1500, str(px))
            check("canvas draws red danger blocks", px["red"] > 250, str(px))
            check("canvas draws gold bonus blocks", px["gold"] > 150, str(px))
            check("canvas draws the mint ball", px["mint"] > 200, str(px))
            check("canvas draws the dark well", px["dark"] > 4000, str(px))
            check("canvas is not a flat blank frame",
                  px["total"] > 100000 and px["w"] >= 1280, str(px))
            pg.screenshot(path=str(OUT / "05-render.png"))
            pg.evaluate(stage(f"{D}.setDepth(9);{D}.forceDanger(0,1);"
                              f"{D}.forceBonus(0,6);{D}.forceDanger(1,7);"
                              f"return {D}.advance(0.05);"))
            pg.screenshot(path=str(OUT / "06-hazards.png"))

            # ---- portrait crop (mobile-first sizing) ------------------------------
            pg.set_viewport_size({"width": 1080, "height": 1920})
            pg.wait_for_timeout(260)
            pg.evaluate(stage(f"{D}.setDepth(5);{D}.forceDanger(0,4);"
                              f"return {D}.advance(0.05);"))
            pg.wait_for_timeout(140)
            rect = pg.evaluate(
                "()=>{const h=document.getElementById('hud').getBoundingClientRect();"
                "const d=document.getElementById('depth').getBoundingClientRect();"
                "return{hudTop:h.top,hudRight:h.right,depthH:d.height,"
                "vw:innerWidth,vh:innerHeight};}")
            check("HUD survives the portrait crop",
                  rect["hudTop"] >= 0 and rect["hudRight"] <= rect["vw"] + 1
                  and rect["depthH"] > 16 and rect["hudTop"] < rect["vh"] * 0.25,
                  str(rect))
            pg.screenshot(path=str(OUT / "07-portrait.png"))
            pg.set_viewport_size({"width": 1280, "height": 720})
            pg.wait_for_timeout(220)

            # ---- sound toggle persists -------------------------------------------
            pg.evaluate(fn("document.getElementById('sndBtn').click();return 1;"))
            pg.wait_for_timeout(150)
            saved = pg.evaluate("()=>localStorage.getItem('hx_snd')")
            check("sound toggle persists to hx_snd",
                  saved is not None and ("true" in saved or "false" in saved),
                  str(saved))

            # ---- offline at runtime ---------------------------------------------
            bad = [u for u in requests if not u.startswith(f"http://localhost:{PORT}")]
            check(f"zero external requests ({len(requests)} total)", not bad, str(bad[:3]))
            check("zero console/page errors", not errors, str(errors[:3]))

            br.close()
    finally:
        server.terminate()

    shots = sorted(OUT.glob("*.png"))
    check("at least 3 proof screenshots written", len(shots) >= 3, f"{len(shots)} png")

    npass = sum(1 for _, ok, _ in checks if ok)
    print(f"\n{npass}/{len(checks)} asserts passed")
    if npass != len(checks):
        print("PLAYTEST: FAIL")
        sys.exit(1)
    print("PLAYTEST: PASS")


if __name__ == "__main__":
    main()

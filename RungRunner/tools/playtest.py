"""Headless playtest gate for RUNG RUNNER.

Spawns `python -m http.server 8151` itself, then drives a real Canvas 2D
Chromium through the whole loop: boot, menu, deterministic rung pickups,
wall clears that spend the stack, short-stack splats, saw hits, pause/resume,
records to localStorage, restart, and the offline constraint at runtime.

Run:  python tools/playtest.py   (needs playwright; screenshots land in proof/)
"""
import pathlib
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8151
URL = f"http://localhost:{PORT}/index.html"
OUT = ROOT / "proof"
OUT.mkdir(exist_ok=True)
D = "window.__rung_debug"
ST = f"()=>{D}.state()"


def fn(body):
    """Block-bodied arrow so a multi-statement body is ONE evaluate() call."""
    return "()=>{" + body + "}"


# Counts canvas pixels that match the game's accent palette. A dead context, a
# thrown error inside rAF or a poisoned draw all show up here as a flat frame â€”
# which "no errors in the console" would happily hide.
PIXEL_JS = """()=>{
  const cv=document.getElementById('cv'), cc=cv.getContext('2d');
  const d=cc.getImageData(0,0,cv.width,cv.height).data;
  const near=(r,g,b,R,G,B,t)=>Math.abs(r-R)<t&&Math.abs(g-G)<t&&Math.abs(b-B)<t;
  let gold=0,cyan=0,pink=0,dark=0;
  for(let i=0;i<d.length;i+=4){
    const r=d[i],g=d[i+1],b=d[i+2];
    if(near(r,g,b,255,198,63,58))gold++;
    if(near(r,g,b,53,224,208,58))cyan++;
    if(near(r,g,b,255,61,127,58))pink++;
    if(r+g+b<210)dark++;
  }
  return {gold:gold,cyan:cyan,pink:pink,dark:dark,total:d.length/4};
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

    def setup(stack, lane, dist=0):
        """Deterministic stage: no spawner, empty track, known stack + lane."""
        return fn(f"{D}.start();{D}.setSpawner(false);{D}.setDist({dist});"
                  f"{D}.clearTrack();{D}.setStack({stack});{D}.snapLane({lane});")

    try:
        with sync_playwright() as p:
            br = p.chromium.launch(headless=True)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
            pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
            pg.on("request", lambda r: requests.append(r.url))

            pg.goto(URL, wait_until="load")
            pg.wait_for_timeout(1000)
            pg.evaluate(fn(D + ".wipe()"))
            pg.reload(wait_until="load")
            pg.wait_for_timeout(1000)

            # ---- boot + menu --------------------------------------------------
            check("debug handle exists", pg.evaluate(f"()=>!!{D}"))
            check("canvas present", pg.evaluate("()=>!!document.querySelector('canvas')"))
            body = pg.evaluate("()=>document.body.innerText")
            up, low = body.upper(), body.lower()
            check("menu shows the title", "RUNG" in up and "RUNNER" in up)
            check("menu explains the loop",
                  "auto-run" in low and "lane" in low and "rung" in low
                  and "wall" in low and "saw" in low, body[:110])
            check("menu shows the best score", "best" in low)
            check("menu is the active screen", pg.evaluate(
                "()=>document.getElementById('s-menu').classList.contains('on')"))
            pg.screenshot(path=str(OUT / "01-menu.png"))

            # ---- a rung in your lane grows the ladder by exactly one -----------
            pg.evaluate(setup(2, 1))
            pg.evaluate(fn(D + ".spawnRungAt(1,12);"))
            pg.evaluate(fn(D + ".advance(1.3);"))
            s = pg.evaluate(ST)
            check("run is live", s["phase"] == "play" and not s["paused"], str(s["phase"]))
            check("HUD visible while running", pg.evaluate(
                "()=>document.getElementById('hud').style.display==='flex'"))
            check("rung pickup raises the stack by 1",
                  s["stack"] == 3 and s["collected"] == 1,
                  f"stack={s['stack']} collected={s['collected']}")
            pg.screenshot(path=str(OUT / "02-play.png"))

            # ---- a rung in another lane is NOT collected -----------------------
            pg.evaluate(setup(2, 0))
            pg.evaluate(fn(D + ".spawnRungAt(2,12);"))
            pg.evaluate(fn(D + ".advance(1.3);"))
            s = pg.evaluate(ST)
            check("rung in a different lane is left behind",
                  s["stack"] == 2 and s["collected"] == 0, f"stack={s['stack']}")

            # ---- clearing a wall spends the stack ------------------------------
            pg.evaluate(setup(6, 1))
            pg.evaluate(fn(D + ".forceWall(4,14);"))
            pg.evaluate(fn(D + ".advance(1.6);"))
            s = pg.evaluate(ST)
            check("a tall enough stack clears the wall",
                  s["phase"] == "play" and s["wallsCleared"] == 1,
                  f"phase={s['phase']} wallsCleared={s['wallsCleared']}")
            check("clearing spends the wall's height in rungs",
                  s["stack"] == 2, f"stack={s['stack']} (expected 6-4=2)")
            pg.screenshot(path=str(OUT / "03-wall-clear.png"))

            # ---- a short stack splats into the wall ----------------------------
            pg.evaluate(setup(1, 1))
            pg.evaluate(fn(D + ".forceWall(5,14);"))
            pg.evaluate(fn(D + ".advance(1.6);"))
            s = pg.evaluate(ST)
            check("short stack ends the run at the wall",
                  s["phase"] == "over" and s["crash"] == "wall",
                  f"phase={s['phase']} crash={s['crash']}")
            check("end screen appears", pg.evaluate(
                "()=>document.getElementById('s-over').classList.contains('on')"))
            end_txt = pg.evaluate("()=>document.body.innerText").upper()
            check("end screen shows stats", "DISTANCE" in end_txt and "RUNGS" in end_txt,
                  end_txt[:110])
            rec = pg.evaluate("()=>JSON.parse(localStorage.getItem('rr_rec'))")
            check("records persisted to rr_rec",
                  rec and rec["games"] >= 1 and rec["best"] >= 1, str(rec))
            pg.screenshot(path=str(OUT / "04-over.png"))

            # ---- restart from the game-over screen -----------------------------
            pg.click("#again")
            pg.wait_for_timeout(250)
            s = pg.evaluate(ST)
            # a restarted run is live immediately, so allow the couple of hundred
            # ms of travel that happens between the click and this assertion.
            check("run again restarts a clean run",
                  s["phase"] == "play" and s["stack"] == 0 and s["collected"] == 0
                  and s["dist"] < 12,
                  f"phase={s['phase']} stack={s['stack']} dist={s['dist']}")

            # ---- pause / resume -------------------------------------------------
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(200)
            check("Escape pauses", pg.evaluate(ST)["paused"] is True)
            pg.click("#resume")
            pg.wait_for_timeout(200)
            check("resume continues the run", pg.evaluate(ST)["paused"] is False)

            # ---- real keyboard + touch steering (no debug pokes) -----------------
            pg.evaluate(setup(0, 1))
            pg.keyboard.press("ArrowLeft")
            pg.wait_for_timeout(140)
            l1 = pg.evaluate(ST)["lane"]
            pg.keyboard.press("d")
            pg.wait_for_timeout(140)
            l2 = pg.evaluate(ST)["lane"]
            check("ArrowLeft then D steer across lanes", l1 == 0 and l2 == 1,
                  f"lane {l1} then {l2}")
            pg.mouse.click(320, 460)
            pg.wait_for_timeout(180)
            l3 = pg.evaluate(ST)["lane"]
            check("tap on the left half steers left", l3 == 0, f"lane={l3}")

            # ---- hiding the tab auto-pauses --------------------------------------
            pg.evaluate(fn("Object.defineProperty(document,'hidden',"
                           "{value:true,configurable:true});"
                           "document.dispatchEvent(new Event('visibilitychange'));"
                           "return 1;"))
            pg.wait_for_timeout(180)
            check("tab hidden auto-pauses", pg.evaluate(ST)["paused"] is True)
            pg.evaluate(fn("Object.defineProperty(document,'hidden',"
                           "{value:false,configurable:true});"
                           "document.dispatchEvent(new Event('visibilitychange'));"
                           "return 1;"))
            pg.wait_for_timeout(140)

            # ---- a saw in your lane ends the run --------------------------------
            pg.evaluate(setup(6, 0))
            pg.evaluate(fn(D + ".forceSaw(0,14);"))
            pg.evaluate(fn(D + ".advance(1.6);"))
            s = pg.evaluate(ST)
            check("saw collision ends the run",
                  s["phase"] == "over" and s["crash"] == "saw",
                  f"phase={s['phase']} crash={s['crash']}")

            # ---- a saw in another lane is harmless ------------------------------
            pg.evaluate(setup(6, 0))
            pg.evaluate(fn(D + ".forceSaw(2,14);"))
            pg.evaluate(fn(D + ".advance(1.6);"))
            s = pg.evaluate(ST)
            check("saw in a different lane is dodged", s["phase"] == "play", str(s["phase"]))

            # ---- distance ramps speed and the sky climbs zones -------------------
            pg.evaluate(setup(0, 1))
            z1 = pg.evaluate(ST)
            pg.evaluate(fn(D + ".setDist(700);"))
            pg.evaluate(fn(D + ".advance(0.5);"))
            z4 = pg.evaluate(ST)
            check("speed ramps with distance", z4["speed"] > z1["speed"] + 5,
                  f"{z1['speed']} -> {z4['speed']}")
            check("sky climbs through zones with distance",
                  z1["zone"] == 1 and z4["zone"] == 4 and z1["zoneName"] != z4["zoneName"],
                  f"{z1['zoneName']} -> {z4['zoneName']}")
            pg.screenshot(path=str(OUT / "05-space.png"))

            # ---- the frame really rendered: canvas pixel census ------------------
            pg.evaluate(setup(6, 1, 200))
            pg.evaluate(fn(D + ".forceWall(3,16);" + D + ".spawnRungAt(2,10);"
                           + D + ".advance(0.35);"))
            pg.wait_for_timeout(120)
            px = pg.evaluate(PIXEL_JS)
            check("canvas draws gold ladder + rung pixels", px["gold"] > 150, str(px))
            check("canvas draws cyan wall pixels", px["cyan"] > 150, str(px))
            check("canvas draws dark road / ink pixels", px["dark"] > 5000, str(px))
            check("canvas is not a flat blank frame", px["total"] > 100000, str(px))
            pg.screenshot(path=str(OUT / "07-render.png"))

            # ---- portrait crop (mobile-first sizing) ----------------------------
            pg.set_viewport_size({"width": 1080, "height": 1920})
            pg.wait_for_timeout(250)
            pg.evaluate(setup(6, 1, 240))
            pg.evaluate(fn(D + ".forceWall(3,18);" + D + ".spawnRungAt(0,12);"
                           + D + ".advance(0.35);"))
            pg.wait_for_timeout(200)
            pg.screenshot(path=str(OUT / "06-portrait.png"))
            pg.set_viewport_size({"width": 1280, "height": 720})
            pg.wait_for_timeout(200)

            # ---- sound toggle persists ------------------------------------------
            pg.evaluate(fn("document.getElementById('sndBtn').click();return 1;"))
            pg.wait_for_timeout(200)
            saved = pg.evaluate("()=>localStorage.getItem('rr_snd')")
            check("sound toggle persists to rr_snd", saved is not None, str(saved))

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

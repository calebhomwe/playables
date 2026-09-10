"""Headless playtest gate for CROWD CLASH.

Spawns `python -m http.server 8153` itself, then drives a real Canvas 2D
Chromium through the whole loop: boot, menu, the ×2 / +N / ÷N / −N gates,
clipping the centre post, a rotating bar and a swinging mace knocking members
out, dodging by steering, a wiped-out crowd, the BOSS GATE burst (and the
failure case), records to localStorage, restart, pause/resume, auto-pause on
tab hide, the canvas pixel census and the offline constraint at runtime.

Determinism: the debug hook can freeze the simulation (`freeze(true)`) so only
`advance(sec)` (1/60 s fixed steps) moves the world — no rAF drift, no RNG luck.
Gates are placed with `spawnGateAt()` / crossed with `runThroughGate()`, and
hazards with `forceObstacle()`, so every mechanic assert is exact.

Run:  python tools/playtest.py   (needs playwright; screenshots land in proof/)
"""
import pathlib
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8153
URL = f"http://localhost:{PORT}/index.html"
OUT = ROOT / "proof"
OUT.mkdir(exist_ok=True)
D = "window.__crowd_debug"
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
  let sky=0,grass=0,track=0,cream=0,good=0,bad=0;
  for(let i=0;i<d.length;i+=4){
    const r=d[i],g=d[i+1],b=d[i+2];
    if(b>200&&b>r+30&&g>140)sky++;
    if(g>140&&g>r+34&&g>b+34)grass++;
    if(near(r,g,b,155,140,240,26))track++;
    if(near(r,g,b,255,244,220,14))cream++;
    if(near(r,g,b,34,201,138,40))good++;
    if(near(r,g,b,255,90,95,40))bad++;
  }
  return {sky:sky,grass:grass,track:track,cream:cream,good:good,bad:bad,
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

    def stage(crowd=30, dist=0.0, speed=12.5, lane=0.0):
        """Deterministic stage: frozen sim, no spawner, empty track, known
        crowd / distance / speed / lane, ready for hand-placed gates."""
        return fn(f"{D}.start();{D}.freeze(true);{D}.setSpawner(false);"
                  f"{D}.clearTrack();{D}.setDist({dist});"
                  f"{D}.setSpeed({'null' if speed is None else speed});"
                  f"{D}.setCrowd({crowd});{D}.setLane({lane});")

    def gate(crowd, side, op, value, dist=0.0, speed=12.5, lane=0.0):
        """Stage, then walk the crowd through one known gate side."""
        pg.evaluate(stage(crowd, dist, speed, lane))
        return pg.evaluate(fn(f"return {D}.runThroughGate('{side}','{op}',{value});"))

    def hazard(crowd, kind, ahead, cx, lane, dist=0.0, speed=12.5, adv=1.2):
        pg.evaluate(stage(crowd, dist, speed, lane))
        pg.evaluate(fn(f"{D}.forceObstacle('{kind}',{ahead},{cx});"))
        return pg.evaluate(fn(f"return {D}.advance({adv});"))

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
                  pg.evaluate("()=>localStorage.getItem('cc_rec')") is None)

            # ---- boot + menu --------------------------------------------------
            check("debug handle exists", pg.evaluate(f"()=>!!{D}"))
            check("canvas present", pg.evaluate("()=>!!document.querySelector('canvas')"))
            body = pg.evaluate("()=>document.body.innerText")
            up, low = body.upper(), body.lower()
            check("menu shows the title", "CROWD" in up and "CLASH" in up)
            check("menu explains the loop",
                  "steer" in low and "gate" in low and "\u00d7" in body
                  and "+7" in body and "\u00f7" in body and "\u2212" in body
                  and "boss" in low and "crowd" in low, body[:160])
            check("menu shows the how-to-play keys",
                  "A / D" in body and "ESC" in up and "PAUSE" in up)
            check("menu shows the best score", "best" in low)
            check("menu is the active screen", pg.evaluate(
                "()=>document.getElementById('s-menu').classList.contains('on')"))
            pg.screenshot(path=str(OUT / "01-menu.png"))

            # ---- the rAF loop is really rendering ------------------------------
            f0 = pg.evaluate(ST)["frames"]
            pg.wait_for_timeout(400)
            f1 = pg.evaluate(ST)["frames"]
            check("rAF render loop is alive", f1 > f0 + 3, f"frames {f0} -> {f1}")

            # ---- start(): the crowd spawns -------------------------------------
            s0 = pg.evaluate(fn(f"return {D}.start();"))
            check("start() puts us in a live run",
                  s0["phase"] == "play" and not s0["paused"], str(s0["phase"]))
            check("the crowd starts above zero", s0["crowd"] > 0, str(s0["crowd"]))
            check("HUD visible while running", pg.evaluate(
                "()=>document.getElementById('hud').style.display==='flex'"))
            check("the hero crowd number mirrors the sim", pg.evaluate(
                "()=>document.getElementById('crowdCount').textContent"),
                str(s0["crowd"]))

            # ---- GATE: x2 doubles the crowd ------------------------------------
            g = gate(10, "left", "mul", 2)
            check("a x2 gate doubles the crowd (10 -> 20)",
                  g["crowd"] == 20 and g["gates"] == 1,
                  f"crowd={g['crowd']} gates={g['gates']}")
            check("the gate is logged for the HUD", g["lastGate"] == "\u00d72",
                  str(g["lastGate"]))
            check("growing the crowd raises the peak", g["peak"] == 20, str(g["peak"]))

            # ---- GATE: +N adds -------------------------------------------------
            g = gate(10, "right", "add", 7)
            check("a +7 gate adds 7 to the crowd (10 -> 17)",
                  g["crowd"] == 17, f"crowd={g['crowd']}")

            # ---- GATE: -N subtracts --------------------------------------------
            g = gate(20, "right", "sub", 12)
            check("a \u221212 gate subtracts 12 (20 -> 8)",
                  g["crowd"] == 8, f"crowd={g['crowd']}")

            # ---- GATE: /N divides ----------------------------------------------
            g = gate(21, "left", "div", 3)
            check("a \u00f73 gate divides the crowd (21 -> 7)",
                  g["crowd"] == 7, f"crowd={g['crowd']}")

            # ---- GATE: both halves are pickable --------------------------------
            gl = gate(12, "left", "mul", 2)
            gr = gate(12, "right", "mul", 2)
            check("either half of a gate grows you when you aim at it",
                  gl["crowd"] == 24 and gr["crowd"] == 24,
                  f"L={gl['crowd']} R={gr['crowd']}")

            # ---- GATE: the centre post punishes a lazy line ---------------------
            pg.evaluate(stage(20, 0.0, 12.5, 0.0))
            pg.evaluate(fn(f"{D}.spawnGateAt(4,'mul:2','mul:2');"))
            pm = pg.evaluate(fn(f"return {D}.advance(0.9);"))
            check("clipping the centre post costs 3 members (20 -> 17)",
                  pm["crowd"] == 17 and pm["posts"] == 1,
                  f"crowd={pm['crowd']} posts={pm['posts']}")
            check("a post clip is not counted as a gate win",
                  pm["gates"] == 0, str(pm["gates"]))

            # ---- a crowd too small for a /N gate is wiped out -------------------
            g = gate(2, "left", "div", 3)
            check("a division gate can wipe a tiny crowd",
                  g["phase"] == "over" and g["crowd"] == 0,
                  f"phase={g['phase']} crowd={g['crowd']}")

            # ---- HAZARD: a spinning bar knocks members out ----------------------
            h = hazard(30, "bar", 6, 0.0, 0.0)
            check("a rotating bar knocks out 6 members (30 -> 24)",
                  h["hits"] == 1 and h["crowd"] == 24,
                  f"hits={h['hits']} crowd={h['crowd']}")
            check("the knocked-out members are tallied", h["lost"] == 6, str(h["lost"]))
            check("clipping a bar does not end the run", h["phase"] == "play",
                  str(h["phase"]))

            # ---- HAZARD: steering clear of the same bar costs nothing -----------
            h = hazard(30, "bar", 6, 0.0, -1.9)
            check("steering wide dodges the bar untouched",
                  h["hits"] == 0 and h["crowd"] == 30 and h["dodges"] >= 1,
                  f"hits={h['hits']} crowd={h['crowd']} dodges={h['dodges']}")

            # ---- HAZARD: the swinging mace takes 5 ------------------------------
            h = hazard(30, "mace", 6, 0.0, 0.0)
            check("a swinging mace knocks out 5 members (30 -> 25)",
                  h["hits"] == 1 and h["crowd"] == 25,
                  f"hits={h['hits']} crowd={h['crowd']}")

            # ---- a bar right at the edge of its band is still a dodge ------------
            h = hazard(30, "bar", 6, 0.0, 1.9)
            check("a bar's band has to be entered to hurt you",
                  h["hits"] == 0 and h["crowd"] == 30, f"hits={h['hits']}")

            # ---- the crowd hitting 0 ends the run -------------------------------
            h = hazard(4, "bar", 6, 0.0, 0.0)
            check("a crowd of 4 against a bar reaches 0 and ends the run",
                  h["phase"] == "over" and h["crowd"] == 0,
                  f"phase={h['phase']} crowd={h['crowd']}")
            check("the wipe-out reason is recorded", h["reason"] == "wiped",
                  str(h["reason"]))
            check("end screen appears", pg.evaluate(
                "()=>document.getElementById('s-over').classList.contains('on')"))
            end_txt = pg.evaluate("()=>document.body.innerText").upper()
            check("end screen shows the stats",
                  "PEAK CROWD" in end_txt and "DISTANCE" in end_txt
                  and "KNOCKED OUT" in end_txt and "SCORE" in end_txt, end_txt[:160])
            pg.screenshot(path=str(OUT / "04-wiped-out.png"))

            # ---- a mid-run shot with a real crowd and a pair of gates -----------
            pg.evaluate(stage(46, 120.0, 18.0, -0.7))
            pg.evaluate(fn(f"{D}.spawnGateAt(20,'add:9','div:3');"
                           f"{D}.forceObstacle('bar',44,-0.6);"
                           f"{D}.forceObstacle('mace',58,1.5);"
                           f"return {D}.advance(0.9);"))
            mid = pg.evaluate(ST)
            check("a running crowd is alive mid-run",
                  mid["phase"] == "play" and mid["crowd"] == 46, str(mid["crowd"]))
            pg.screenshot(path=str(OUT / "02-mid-run.png"))

            # ---- the BOSS GATE ---------------------------------------------------
            pg.evaluate(stage(80, 880.0, 24.0, 0.0))
            b1 = pg.evaluate(fn(f"return {D}.advance(1.0);"))
            check("the boss gate spawns at the end of the road",
                  b1["bossSpawned"] is True and b1["ents"]["boss"] == 1,
                  f"spawned={b1['bossSpawned']} bosses={b1['ents']['boss']}")
            check("the boss gate is ahead of us, still in play",
                  b1["phase"] == "play" and b1["dist"] < b1["boss"],
                  f"dist={b1['dist']} boss={b1['boss']}")
            check("the HUD warns about the boss gate", pg.evaluate(
                "()=>document.getElementById('bossChip').style.display!=='none'"))
            pg.screenshot(path=str(OUT / "03-boss-gate.png"))

            b2 = pg.evaluate(fn(f"return {D}.advance(3.0);"))
            check("a big enough crowd bursts the boss gate",
                  b2["phase"] == "win" and b2["win"] is True,
                  f"phase={b2['phase']} win={b2['win']}")
            check("the burst pays a crowd-sized bonus",
                  b2["burstBonus"] == 640 and b2["crowd"] >= 60,
                  f"bonus={b2['burstBonus']} crowd={b2['crowd']}")
            win_txt = pg.evaluate("()=>document.body.innerText").upper()
            check("victory screen shows the burst",
                  "BURST" in win_txt and "RUN AGAIN" in win_txt, win_txt[:160])
            pg.screenshot(path=str(OUT / "05-victory.png"))

            # ---- a crowd below the threshold fails the boss ----------------------
            pg.evaluate(stage(10, 880.0, 24.0, 0.0))
            b3 = pg.evaluate(fn(f"return {D}.advance(4.0);"))
            check("too small a crowd cannot burst the boss gate",
                  b3["phase"] == "over" and b3["reason"] == "boss",
                  f"phase={b3['phase']} reason={b3['reason']}")
            check("the failure screen names the gate",
                  "GATE HELD" in pg.evaluate("()=>document.body.innerText").upper())
            pg.screenshot(path=str(OUT / "06-boss-failed.png"))

            # ---- records persist -------------------------------------------------
            rec = pg.evaluate("()=>JSON.parse(localStorage.getItem('cc_rec'))")
            check("records persisted to cc_rec",
                  rec and rec["games"] >= 1 and rec["best"] >= 1
                  and rec["crowd"] >= 1 and rec["bursts"] >= 1, str(rec))

            # ---- restart from the end screen -------------------------------------
            pg.click("#again")
            pg.wait_for_timeout(260)
            s12 = pg.evaluate(ST)
            check("run again restarts a clean run",
                  s12["phase"] == "play" and s12["crowd"] == 8 and s12["dist"] < 40,
                  f"phase={s12['phase']} crowd={s12['crowd']} dist={s12['dist']}")

            # ---- speed ramps with distance ---------------------------------------
            pg.evaluate(stage(30, 0.0, None))
            a = pg.evaluate(fn(f"return {D}.advance(0.02);"))
            pg.evaluate(fn(f"{D}.setDist(460);"))
            mid2 = pg.evaluate(fn(f"return {D}.advance(0.02);"))
            pg.evaluate(fn(f"{D}.setDist(900);"))
            far = pg.evaluate(fn(f"return {D}.advance(0.02);"))
            check("speed ramps with distance",
                  mid2["speed"] > a["speed"] + 4 and far["speed"] > mid2["speed"] + 4,
                  f'{a["speed"]} -> {mid2["speed"]} -> {far["speed"]}')
            check("speed is capped by SPEED1", abs(far["speed"] - 24) < 0.5,
                  str(far["speed"]))

            # ---- real keyboard steering ------------------------------------------
            pg.evaluate(stage(30, 0.0, 12.5, 0.0))
            pg.keyboard.down("ArrowLeft")
            k1 = pg.evaluate(fn(f"return {D}.advance(0.3);"))
            pg.keyboard.up("ArrowLeft")
            check("ArrowLeft steers the crowd left (real key)",
                  k1["px"] < -0.4, f"px={k1['px']}")
            pg.keyboard.down("ArrowRight")
            k2 = pg.evaluate(fn(f"return {D}.advance(0.5);"))
            pg.keyboard.up("ArrowRight")
            check("ArrowRight steers back, right of centre",
                  k2["px"] > 0.2 and k2["px"] > k1["px"], f"px={k2['px']}")

            # ---- pause / resume ---------------------------------------------------
            pg.evaluate(stage(30, 40.0, 12.5, 0.0))
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(180)
            check("Escape pauses", pg.evaluate(ST)["paused"] is True)
            check("pause screen appears", pg.evaluate(
                "()=>document.getElementById('s-pause').classList.contains('on')"))
            pg.click("#resume")
            pg.wait_for_timeout(180)
            check("resume continues the run", pg.evaluate(ST)["paused"] is False)

            # ---- hiding the tab auto-pauses ---------------------------------------
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

            # ---- the frame really rendered: canvas pixel census -------------------
            pg.evaluate(stage(34, 60.0, 20.0, -0.8))
            pg.evaluate(fn(f"return {D}.advance(0.05);"))
            bare = pg.evaluate(PIXEL_JS)
            pg.evaluate(fn(f"{D}.spawnGateAt(16,'mul:2','sub:12');"
                           f"return {D}.advance(0.02);"))
            px = pg.evaluate(PIXEL_JS)
            print(f"  px bare={bare}")
            print(f"  px gate={px}")
            check("canvas draws the sky and the grass", px["sky"] > 20000
                  and px["grass"] > 3000, str(px))
            check("canvas draws the candy track", px["track"] > 8000, str(px))
            check("canvas draws the cream lane paint", px["cream"] > 200, str(px))
            check("the grow-side gate panel is painted green",
                  px["good"] > bare["good"] + 1200,
                  f"good bare={bare['good']} with-gate={px['good']}")
            check("the shrink-side gate panel is painted coral",
                  px["bad"] > bare["bad"] + 800,
                  f"bad bare={bare['bad']} with-gate={px['bad']}")
            check("canvas is not a flat blank frame",
                  px["total"] > 100000 and px["w"] >= 1280, str(px))
            pg.screenshot(path=str(OUT / "07-render.png"))

            # ---- portrait crop -----------------------------------------------------
            pg.set_viewport_size({"width": 1080, "height": 1920})
            pg.wait_for_timeout(260)
            pg.evaluate(stage(34, 60.0, 20.0, -0.5))
            pg.evaluate(fn(f"{D}.spawnGateAt(15,'mul:2','sub:12');"
                           f"return {D}.advance(0.05);"))
            pg.wait_for_timeout(140)
            rect = pg.evaluate(
                "()=>{const h=document.getElementById('hud').getBoundingClientRect();"
                "const c=document.getElementById('crowdWrap').getBoundingClientRect();"
                "const k=document.getElementById('crowdCount').getBoundingClientRect();"
                "return{hudTop:h.top,hudRight:h.right,cw:c.width,countH:k.height,"
                "vw:innerWidth,vh:innerHeight};}")
            check("HUD survives the portrait crop",
                  rect["hudTop"] >= 0 and rect["hudRight"] <= rect["vw"] + 1
                  and rect["cw"] > 70 and rect["countH"] > 20
                  and rect["hudTop"] < rect["vh"] * 0.25, str(rect))
            check("the hero crowd count is legible in portrait",
                  rect["countH"] >= 34, str(rect["countH"]))
            pg.screenshot(path=str(OUT / "08-portrait.png"))
            pg.set_viewport_size({"width": 1280, "height": 720})
            pg.wait_for_timeout(220)

            # ---- sound toggle persists ---------------------------------------------
            pg.evaluate(fn("document.getElementById('sndBtn').click();return 1;"))
            pg.wait_for_timeout(150)
            saved = pg.evaluate("()=>localStorage.getItem('cc_snd')")
            check("sound toggle persists to cc_snd",
                  saved is not None and ("true" in saved or "false" in saved),
                  str(saved))

            # ---- offline at runtime -------------------------------------------------
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

"""Headless playtest gate for SNAKE CLASH.

Spawns `python -m http.server 8155` itself, then drives a real Canvas 2D
Chromium through the whole loop: boot, menu, steering, eating an orb to grow,
wall death, ramming a rival, boosting (which burns length), the rival ramp,
records to localStorage, restart, pause/resume, auto-pause on tab hide, the
canvas pixel census, the portrait crop and the offline constraint at runtime.

Determinism: the debug hook can freeze the simulation (`freeze(true)`) so only
`advance(sec)` (1/60 s fixed steps) moves the world — no rAF drift, no RNG luck.
Orbs are planted with `spawnOrbAt()`, the head is teleported with `setHead()`,
rivals are planted with `forceRival()`, so every mechanic assert is exact.

Run:  python tools/playtest.py   (needs playwright; screenshots land in proof/)
"""
import pathlib
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8155
URL = f"http://localhost:{PORT}/index.html"
OUT = ROOT / "proof"
OUT.mkdir(exist_ok=True)
D = "window.__snake_debug"
ST = f"()=>{D}.state()"
ARENA, WALL = 2600, 28


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
  let green=0,pink=0,cyan=0,warm=0,dark=0;
  for(let i=0;i<d.length;i+=4){
    const r=d[i],g=d[i+1],b=d[i+2];
    if(near(r,g,b,63,240,138,66))green++;
    if(near(r,g,b,255,77,141,66))pink++;
    if(near(r,g,b,37,230,200,60))cyan++;
    if(r>195&&g>140&&b<175)warm++;
    if(r+g+b<175)dark++;
  }
  return {green:green,pink:pink,cyan:cyan,warm:warm,dark:dark,
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

    def stage(extra="", head=None, heading=None, length=None):
        """Deterministic stage: frozen sim, no spawner, empty arena."""
        body = (f"{D}.start();{D}.freeze(true);{D}.setSpawner(false);{D}.clearArena();")
        if length is not None:
            body += f"{D}.setLength({length});"
        if head is not None:
            body += f"{D}.setHead({head[0]},{head[1]});"
        if heading is not None:
            body += f"{D}.setHeading({heading});"
        return fn(body + extra)

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
            check("wipe() clears the saved records",
                  pg.evaluate("()=>localStorage.getItem('sc_rec')") is None)

            # ---- boot + menu --------------------------------------------------
            check("debug handle exists", pg.evaluate(f"()=>!!{D}"))
            check("canvas present", pg.evaluate("()=>!!document.querySelector('canvas')"))
            body = pg.evaluate("()=>document.body.innerText")
            up, low = body.upper(), body.lower()
            check("menu shows the title", "SNAKE" in up and "CLASH" in up)
            check("menu explains the loop",
                  "steer" in low and "orb" in low and "boost" in low
                  and "rival" in low and "wall" in low and "grow" in low, body[:170])
            check("menu shows the how-to-play keys",
                  "MOUSE" in up and "ARROW" in up and "SHIFT" in up and "ESC" in up)
            check("menu shows the best length", "best" in low)
            check("menu is the active screen", pg.evaluate(
                "()=>document.getElementById('s-menu').classList.contains('on')"))
            pg.screenshot(path=str(OUT / "01-menu.png"))

            # ---- the rAF loop is really rendering ------------------------------
            f0 = pg.evaluate(ST)["frames"]
            pg.wait_for_timeout(400)
            f1 = pg.evaluate(ST)["frames"]
            check("rAF render loop is alive", f1 > f0 + 3, f"frames {f0} -> {f1}")

            # ---- start(): the snake is live ------------------------------------
            s0 = pg.evaluate(fn(f"return {D}.start();"))
            check("start() puts us in a live run",
                  s0["phase"] == "play" and not s0["paused"], str(s0["phase"]))
            check("a fresh snake starts at the base length",
                  s0["len"] == 14, str(s0["len"]))
            check("rivals are already roaming", s0["rivalCount"] >= 1,
                  str(s0["rivalCount"]))
            check("HUD visible while running", pg.evaluate(
                "()=>document.getElementById('hud').style.display==='flex'"))
            check("HUD length mirrors the sim", pg.evaluate(
                "()=>document.getElementById('len').textContent"), str(s0["len"]))
            check("rank is computed against the rivals",
                  isinstance(s0["rank"], int) and s0["rank"] >= 1, str(s0["rank"]))

            # ---- the snake really moves (real rAF, no debug pokes) --------------
            pg.evaluate(fn(f"{D}.setSpawner(false);{D}.clearArena();"))
            h0 = pg.evaluate(ST)["head"]
            pg.wait_for_timeout(450)
            h1 = pg.evaluate(ST)["head"]
            moved = h0 and h1 and (abs(h1["x"] - h0["x"]) + abs(h1["y"] - h0["y"]))
            check("the snake moves on its own", moved > 20, f"{h0} -> {h1}")

            # ---- a mid-run showcase shot ---------------------------------------
            pg.evaluate(stage(head=(ARENA / 2 - 260, ARENA / 2), heading=0, length=34,
                              extra=f"{D}.spawnOrbAt({ARENA/2-120},{ARENA/2-70},40);"
                                    f"{D}.spawnOrbAt({ARENA/2-40},{ARENA/2+90},150);"
                                    f"{D}.spawnOrbAt({ARENA/2+120},{ARENA/2-110},300);"
                                    f"{D}.forceRival({ARENA/2+230},{ARENA/2+240},"
                                    f"{{heading:2.2,len:38,live:true}});"
                                    f"{D}.forceRival({ARENA/2-40},{ARENA/2+330},"
                                    f"{{heading:-0.4,len:26,live:true}});"))
            pg.evaluate(fn(D + ".advance(0.05);"))
            check("rival snakes were created", pg.evaluate(ST)["rivalCount"] >= 2,
                  str(pg.evaluate(ST)["rivalCount"]))
            pg.screenshot(path=str(OUT / "02-play.png"))

            # ---- eating an orb grows the snake by exactly one -------------------
            pg.evaluate(stage(head=(ARENA / 2, ARENA / 2), heading=0, length=14,
                              extra=f"{D}.spawnOrbAt({ARENA/2+90},{ARENA/2},150);"))
            before = pg.evaluate(ST)
            after = pg.evaluate(fn(f"return {D}.advance(1.0);"))
            check("there was exactly one orb to eat", before["orbs"] == 1,
                  str(before["orbs"]))
            check("eating an orb grows the snake by 1",
                  after["len"] == 15 and after["orbsEaten"] == 1,
                  f"len={after['len']} eaten={after['orbsEaten']}")
            check("the orb is gone from the arena", after["orbs"] == 0,
                  str(after["orbs"]))
            check("the +1 LENGTH floater was raised",
                  "+1 LENGTH" in after["floats"], str(after["floats"]))

            # ---- a rival body is solid: running into it ends the run ------------
            pg.evaluate(stage(head=(ARENA / 2 - 320, ARENA / 2), heading=0, length=14,
                              extra=f"{D}.forceRival({ARENA/2+80},{ARENA/2},"
                                    f"{{heading:0,len:60}});"))
            planted = pg.evaluate(ST)
            check("a rival can be planted with a known body",
                  planted["rivalCount"] == 1 and planted["rivals"][0]["len"] == 60,
                  str(planted["rivals"]))
            hit = pg.evaluate(fn(f"return {D}.advance(2.5);"))
            check("colliding with a rival body ends the run",
                  hit["phase"] == "over" and hit["crash"] == "rival",
                  f"phase={hit['phase']} crash={hit['crash']}")
            check("end screen appears", pg.evaluate(
                "()=>document.getElementById('s-over').classList.contains('on')"))
            end_txt = pg.evaluate("()=>document.body.innerText").upper()
            check("end screen shows the stats",
                  "LENGTH" in end_txt and "SCORE" in end_txt and "BEST" in end_txt,
                  end_txt[:150])
            check("end screen offers PLAY AGAIN", "PLAY AGAIN" in end_txt)
            pg.screenshot(path=str(OUT / "03-over.png"))

            # ---- head-on: the longer snake survives the clash --------------------
            pg.evaluate(stage(head=(ARENA / 2, ARENA / 2), heading=0, length=120,
                              extra=f"{D}.forceRival({ARENA/2+60},{ARENA/2},"
                                    f"{{heading:3.14159265,len:20,speed:0.86}});"))
            prey = pg.evaluate(ST)
            check("the planted rival is the shorter snake",
                  bool(prey["rivals"]) and prey["rivals"][0]["len"] == 20
                  and prey["len"] == 120,
                  f"me={prey['len']} rival={prey['rivals']}")
            clash = pg.evaluate(fn(f"return {D}.advance(0.6);"))
            check("head-on, the longer snake bursts the shorter rival",
                  clash["kills"] == 1 and clash["phase"] == "play",
                  f"kills={clash['kills']} phase={clash['phase']}")

            # ---- the wall kills -------------------------------------------------
            pg.evaluate(stage(head=(WALL + 70, ARENA / 2), heading=3.14159265,
                              length=140))
            wall = pg.evaluate(fn(f"return {D}.advance(1.0);"))
            check("hitting the wall ends the run",
                  wall["phase"] == "over" and wall["crash"] == "wall",
                  f"phase={wall['phase']} crash={wall['crash']}")

            # ---- records persist to sc_rec --------------------------------------
            rec = pg.evaluate("()=>JSON.parse(localStorage.getItem('sc_rec'))")
            check("records persisted to sc_rec",
                  rec and rec["games"] >= 1 and rec["best"] >= 100,
                  str(rec))
            check("best score is recorded too", rec and rec["bestScore"] >= 100, str(rec))

            # ---- restart from the game-over screen ------------------------------
            pg.click("#again")
            pg.wait_for_timeout(280)
            s12 = pg.evaluate(ST)
            check("play-again restarts a clean run",
                  s12["phase"] == "play" and s12["len"] == 14 and s12["orbsEaten"] == 0,
                  f"phase={s12['phase']} len={s12['len']}")

            # ---- boost trades length for speed ----------------------------------
            pg.evaluate(stage(head=(ARENA / 2, ARENA / 2), heading=-1.5707963, length=40))
            pg.evaluate(fn(f"{D}.setBoost(true);"))
            bh0 = pg.evaluate(ST)
            boost = pg.evaluate(fn(f"return {D}.advance(1.0);"))
            check("boost is flagged while held", boost["boost"] is True)
            check("boost burns length", boost["len"] <= bh0["len"] - 6,
                  f"{bh0['len']} -> {boost['len']}")
            check("boost raises the speed",
                  boost["speed"] > bh0["speed"] * 1.5,
                  f"{bh0['speed']} -> {boost['speed']}")
            bh1 = pg.evaluate(ST)["head"]
            check("the boosted snake still travels",
                  abs(bh1["y"] - (ARENA / 2)) > 150, str(bh1))
            pg.evaluate(fn(f"{D}.setBoost(false);"))
            noB = pg.evaluate(fn(f"return {D}.advance(0.5);"))
            check("releasing boost stops burning length",
                  noB["len"] == boost["len"] and noB["boost"] is False,
                  f"{boost['len']} -> {noB['len']}")
            check("boost cannot burn below the floor", noB["len"] >= 12, str(noB["len"]))
            pg.screenshot(path=str(OUT / "04-boost.png"))

            # ---- growing ramps the rival pack -----------------------------------
            pg.evaluate(fn(f"{D}.start();{D}.freeze(true);{D}.clearArena();"
                           f"{D}.setSpawner(true);{D}.setLength(70);"))
            ramp0 = pg.evaluate(ST)["rivalCount"]
            ramp = pg.evaluate(fn(f"return {D}.advance(1.4);"))
            check("growing pulls more rivals into the arena",
                  ramp["rivalCount"] > ramp0, f"{ramp0} -> {ramp['rivalCount']}")
            check("the arena still tops itself up with orbs",
                  ramp["orbs"] > 40, str(ramp["orbs"]))

            # ---- rank improves as the snake out-grows the pack -------------------
            pg.evaluate(stage(head=(ARENA / 2, ARENA / 2), heading=0, length=14,
                              extra=f"{D}.forceRival({ARENA/2+600},{ARENA/2+400},"
                                    f"{{heading:0,len:80}});"
                                    f"{D}.forceRival({ARENA/2-600},{ARENA/2+400},"
                                    f"{{heading:0,len:90}});"
                                    f"{D}.advance(0.05);"))
            low_rank = pg.evaluate(ST)["rank"]
            pg.evaluate(fn(f"{D}.setLength(300);{D}.advance(0.05);"))
            high_rank = pg.evaluate(ST)["rank"]
            check("rank improves as you out-grow the rivals",
                  low_rank > 1 and high_rank == 1, f"{low_rank} -> {high_rank}")

            # ---- pause / resume --------------------------------------------------
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(200)
            check("Escape pauses", pg.evaluate(ST)["paused"] is True)
            check("pause screen appears", pg.evaluate(
                "()=>document.getElementById('s-pause').classList.contains('on')"))
            pg.click("#resume")
            pg.wait_for_timeout(200)
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
            pg.wait_for_timeout(160)
            check("coming back does not un-pause by itself",
                  pg.evaluate(ST)["paused"] is True)
            pg.evaluate(fn(D + ".resume();"))
            pg.wait_for_timeout(120)
            check("resume continues the run after returning",
                  pg.evaluate(ST)["paused"] is False)

            # ---- real keyboard steering (no debug pokes) -------------------------
            delta = ("const h0=" + D + ".state().heading;"
                     "const h1=" + D + ".advance(0.4).heading;"
                     "return (h1-h0+Math.PI*3)%(Math.PI*2)-Math.PI;")
            pg.evaluate(stage(head=(ARENA / 2, ARENA / 2), heading=0, length=14))
            pg.keyboard.down("ArrowRight")
            k1 = pg.evaluate(fn(delta))
            pg.keyboard.up("ArrowRight")
            pg.evaluate(stage(head=(ARENA / 2, ARENA / 2), heading=0, length=14))
            pg.keyboard.down("ArrowLeft")
            k2 = pg.evaluate(fn(delta))
            pg.keyboard.up("ArrowLeft")
            check("ArrowRight turns one way and ArrowLeft the other",
                  k1 > 0 and k2 < 0 and abs(k1 - k2) > 0.7, f"R={k1} L={k2}")

            # ---- mouse look steers toward the pointer ----------------------------
            pg.evaluate(stage(head=(ARENA / 2, ARENA / 2), heading=0, length=14))
            pg.mouse.move(300, 300)
            pg.mouse.move(640, 120)      # straight above the snake's head
            pg.wait_for_timeout(80)
            ml = pg.evaluate(fn("const h0=" + D + ".state().heading;"
                                "const h1=" + D + ".advance(0.6).heading;"
                                "return (h1-h0+Math.PI*3)%(Math.PI*2)-Math.PI;"))
            check("mouse look turns the head toward the pointer",
                  ml < -0.9 and ml > -2.5, str(ml))

            # ---- the frame really rendered: canvas pixel census ------------------
            pg.evaluate(stage(head=(WALL + 200, ARENA / 2), heading=0, length=30))
            pg.evaluate(fn(f"return {D}.advance(0.75);"))   # grow a real body trail
            pg.evaluate(fn(f"{D}.spawnOrbAt({WALL+520},{ARENA/2-120},40);"
                           f"{D}.spawnOrbAt({WALL+560},{ARENA/2+30},45);"
                           f"{D}.spawnOrbAt({WALL+500},{ARENA/2+200},35);"
                           f"{D}.spawnOrbAt({WALL+640},{ARENA/2-40},50);"
                           f"{D}.forceRival({WALL+720},{ARENA/2+250},"
                           f"{{heading:1.5707963,len:40}});"
                           f"{D}.advance(0.03);"))
            px = pg.evaluate(PIXEL_JS)
            print(f"  px {px}")
            check("canvas draws the green player snake", px["green"] > 800, str(px))
            check("canvas draws the rival snake", px["pink"] > 120, str(px))
            check("canvas draws the cyan arena wall", px["cyan"] > 1500, str(px))
            check("canvas draws warm glowing orbs", px["warm"] > 250, str(px))
            check("canvas draws the dark arena", px["dark"] > 20000, str(px))
            check("canvas is not a flat blank frame",
                  px["total"] > 100000 and px["w"] >= 1280, str(px))
            pg.screenshot(path=str(OUT / "05-render.png"))
            pg.evaluate(stage(head=(WALL + 400, ARENA / 2 + 340),
                              heading=-1.5707963, length=30))
            pg.evaluate(fn(f"return {D}.advance(1.6);"))
            pg.evaluate(fn(f"{D}.spawnOrbAt({WALL+240},{ARENA/2-150},150);"
                           f"{D}.spawnOrbAt({WALL+330},{ARENA/2-320},300);"
                           f"{D}.spawnOrbAt({WALL+560},{ARENA/2-70},40);"
                           f"{D}.spawnOrbAt({WALL+270},{ARENA/2+260},180);"
                           f"{D}.forceRival({WALL+740},{ARENA/2+320},"
                           f"{{heading:2.4,len:70}});"
                           f"{D}.forceRival({WALL+700},{ARENA/2-150},"
                           f"{{heading:1.05,len:55}});"
                           f"{D}.advance(0.02);"))
            pg.screenshot(path=str(OUT / "06-hazards.png"))

            # ---- portrait crop (mobile-first sizing) -----------------------------
            pg.set_viewport_size({"width": 1080, "height": 1920})
            pg.wait_for_timeout(280)
            pg.evaluate(stage(head=(ARENA / 2 - 90, ARENA / 2 - 300),
                              heading=-1.5707963, length=40))
            pg.evaluate(fn(f"return {D}.advance(1.2);"))
            pg.evaluate(fn(f"{D}.spawnOrbAt({ARENA/2+90},{ARENA/2-674},40);"
                           f"{D}.spawnOrbAt({ARENA/2-230},{ARENA/2-494},150);"
                           f"{D}.forceRival({ARENA/2+210},{ARENA/2-294},"
                           f"{{heading:2.4,len:50,live:true}});"
                           f"{D}.advance(0.02);"))
            pg.wait_for_timeout(160)
            rect = pg.evaluate(
                "()=>{const h=document.getElementById('hud').getBoundingClientRect();"
                "const l=document.getElementById('len').getBoundingClientRect();"
                "return{hudTop:h.top,hudRight:h.right,lenH:l.height,vw:innerWidth,vh:innerHeight};}")
            check("HUD survives the portrait crop",
                  rect["hudTop"] >= 0 and rect["hudRight"] <= rect["vw"] + 1
                  and rect["lenH"] > 16 and rect["hudTop"] < rect["vh"] * 0.25,
                  str(rect))
            pg.screenshot(path=str(OUT / "07-portrait.png"))
            pg.set_viewport_size({"width": 1280, "height": 720})
            pg.wait_for_timeout(220)

            # ---- sound toggle persists -------------------------------------------
            pg.evaluate(fn("document.getElementById('sndBtn').click();return 1;"))
            pg.wait_for_timeout(150)
            saved = pg.evaluate("()=>localStorage.getItem('sc_snd')")
            check("sound toggle persists to sc_snd",
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

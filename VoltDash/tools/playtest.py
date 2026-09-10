"""Headless playtest gate for VOLT DASH.

Spawns `python -m http.server 8152` itself, then drives a real Canvas 2D
Chromium through the whole loop: boot, menu, deterministic hop-over-spike,
missed spike costing energy, cell pickup, the slide window under a conduit,
DASH cost + speed burst, the drain to a blackout, records to localStorage,
restart, pause/resume, auto-pause on tab hide, the canvas pixel census and
the offline constraint at runtime.

Determinism: the debug hook can freeze the simulation (`freeze(true)`) so
only `advance(sec)` (1/60 s fixed steps) moves the world — no rAF drift, no
RNG luck.

Run:  python tools/playtest.py   (needs playwright; screenshots land in proof/)
"""
import pathlib
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8152
URL = f"http://localhost:{PORT}/index.html"
OUT = ROOT / "proof"
OUT.mkdir(exist_ok=True)
D = "window.__volt_debug"
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
  let lime=0,cyan=0,magenta=0,dark=0;
  for(let i=0;i<d.length;i+=4){
    const r=d[i],g=d[i+1],b=d[i+2];
    if(near(r,g,b,168,255,53,62))lime++;
    if(near(r,g,b,37,230,255,62))cyan++;
    if(near(r,g,b,255,46,139,62))magenta++;
    if(r+g+b<220)dark++;
  }
  return {lime:lime,cyan:cyan,magenta:magenta,dark:dark,total:d.length/4};
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

    def stage(energy=80.0, speed=11.0, dist=0.0, obs=None, cells=()):
        """Deterministic stage: frozen sim, no spawner, empty track, known
        energy / speed / distance, then hand-placed hazards and cells."""
        body = (f"{D}.start();{D}.freeze(true);{D}.setSpawner(false);{D}.clearTrack();"
                f"{D}.setDist({dist});{D}.setSpeed({speed});{D}.setEnergy({energy});")
        if obs:
            body += f"{D}.forceObstacle('{obs[0]}',{obs[1]});"
        for c in cells:
            body += f"{D}.spawnCellAt({c[0]},{c[1]});"
        return fn(body)

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
            check("menu shows the title", "VOLT" in up and "DASH" in up)
            check("menu explains the loop",
                  "auto-run" in low and "hop" in low and "slide" in low
                  and "cell" in low and "energy" in low, body[:120])
            check("menu shows the best score", "best" in low)
            check("menu is the active screen", pg.evaluate(
                "()=>document.getElementById('s-menu').classList.contains('on')"))
            pg.screenshot(path=str(OUT / "01-menu.png"))

            # ---- the rAF loop is really rendering -------------------------------
            f0 = pg.evaluate(ST)["frames"]
            pg.wait_for_timeout(400)
            f1 = pg.evaluate(ST)["frames"]
            check("rAF render loop is alive", f1 > f0 + 3, f"frames {f0} -> {f1}")

            # ---- a hop clears a low zapper, and costs no energy ----------------
            pg.evaluate(stage(80, 11, 0, obs=("spike", 11)))
            s = pg.evaluate(ST)
            check("run is live", s["phase"] == "play" and not s["paused"], str(s["phase"]))
            check("HUD visible while running", pg.evaluate(
                "()=>document.getElementById('hud').style.display==='flex'"))
            check("energy bar is wired to the run", pg.evaluate(
                "()=>document.getElementById('energyFill').style.width!==''"))
            pg.evaluate(fn("return " + D + ".advance(0.75);"))
            pg.evaluate(fn(D + ".hop();"))
            s2 = pg.evaluate(fn("return " + D + ".advance(0.45);"))
            check("a hop clears the zapper untouched",
                  s2["hits"] == 0 and s2["cleared"] >= 1 and s2["phase"] == "play",
                  f"hits={s2['hits']} cleared={s2['cleared']} phase={s2['phase']}")
            check("clearing a hop obstacle costs no energy",
                  s2["energy"] > 70, f"energy={s2['energy']}")
            pg.screenshot(path=str(OUT / "02-play.png"))

            # ---- a missed obstacle costs a big chunk of energy ------------------
            pg.evaluate(stage(84, 11, 0, obs=("spike", 8)))
            s3 = pg.evaluate(fn("return " + D + ".advance(1.0);"))
            check("a missed zapper costs 26 energy",
                  s3["hits"] == 1 and s3["energy"] < 62 and s3["energy"] > 45
                  and s3["phase"] == "play", f"hits={s3['hits']} energy={s3['energy']}")
            check("damage grants a brief recovery window", s3["invuln"] is True,
                  str(s3["hitCd"]))
            pg.screenshot(path=str(OUT / "03-hit.png"))

            # ---- a slide ducks the hanging conduit ------------------------------
            pg.evaluate(stage(80, 11, 0, obs=("beam", 6)))
            pg.evaluate(fn(D + ".slide();"))
            s4 = pg.evaluate(fn("return " + D + ".advance(0.75);"))
            check("a slide ducks the conduit untouched",
                  s4["hits"] == 0 and s4["cleared"] >= 1, f"hits={s4['hits']}")
            # same conduit standing up is a hit
            pg.evaluate(stage(80, 11, 0, obs=("beam", 6)))
            s5 = pg.evaluate(fn("return " + D + ".advance(0.75);"))
            check("standing under the conduit is a hit",
                  s5["hits"] == 1, f"hits={s5['hits']}")
            pg.screenshot(path=str(OUT / "04-slide.png"))

            # ---- a battery cell refills the bar --------------------------------
            pg.evaluate(stage(60, 11, 0, cells=((7, 0.55),)))
            s6 = pg.evaluate(fn("return " + D + ".advance(1.0);"))
            check("collecting a cell raises energy",
                  s6["collected"] == 1 and s6["energy"] > 62,
                  f"cells={s6['collected']} energy={s6['energy']}")
            check("score counts distance + cells",
                  s6["score"] == s6["dist"] + s6["collected"] * 5,
                  f"score={s6['score']} dist={s6['dist']} cells={s6['collected']}")
            # a cell left behind is missed, not collected
            pg.evaluate(stage(60, 11, 0, cells=((7, 2.05),)))
            s7 = pg.evaluate(fn("return " + D + ".advance(1.0);"))
            check("a high cell is missed unless you hop",
                  s7["collected"] == 0 and s7["missed"] == 1 and s7["energy"] < 60,
                  f"cells={s7['collected']} missed={s7['missed']} energy={s7['energy']}")

            # ---- DASH: energy out, speed up --------------------------------------
            pg.evaluate(stage(90, 12, 0))
            pg.evaluate(fn(D + ".dash();"))
            s8 = pg.evaluate(fn("return " + D + ".advance(0.05);"))
            check("DASH spends 22 energy",
                  s8["energy"] < 70 and s8["energy"] > 60, f"energy={s8['energy']}")
            check("DASH raises speed by 1.85x",
                  s8["dashing"] is True and s8["speed"] > 20 and s8["speed"] < 24,
                  f"speed={s8['speed']}")
            check("DASH grants invulnerability", s8["invuln"] is True)
            pg.screenshot(path=str(OUT / "05-dash.png"))
            s9 = pg.evaluate(fn("return " + D + ".advance(0.8);"))
            check("the burst expires back to normal speed",
                  s9["dashing"] is False and abs(s9["speed"] - 12) < 0.01,
                  f"speed={s9['speed']} dashT={s9['dashT']}")
            # dashing through a hazard is safe (invulnerable)
            pg.evaluate(stage(80, 11, 0, obs=("spike", 7)))
            pg.evaluate(fn(D + ".dash();"))
            s10 = pg.evaluate(fn("return " + D + ".advance(0.8);"))
            check("a dash ploughs through a hazard safely",
                  s10["hits"] == 0 and s10["phase"] == "play", f"hits={s10['hits']}")
            # a dash with no charge is refused
            pg.evaluate(stage(10, 11, 0))
            check("DASH is refused below 22 energy",
                  pg.evaluate(fn("return " + D + ".dash();")) is False)

            # ---- distance ramps speed and the sectors climb ---------------------
            pg.evaluate(stage(100, 11, 0))
            pg.evaluate(fn(D + ".setSpeed(null);"))
            a = pg.evaluate(fn("return " + D + ".advance(0.05);"))
            pg.evaluate(fn(D + ".setDist(450);"))
            mid = pg.evaluate(fn("return " + D + ".advance(0.05);"))
            pg.evaluate(fn(D + ".setDist(900);"))
            far = pg.evaluate(fn("return " + D + ".advance(0.05);"))
            check("speed ramps with distance",
                  mid["speed"] > a["speed"] + 5 and far["speed"] > mid["speed"] + 5,
                  f'{a["speed"]} -> {mid["speed"]} -> {far["speed"]}')
            check("speed is capped by SPEED1", abs(far["speed"] - 24) < 0.5,
                  str(far["speed"]))
            check("sectors climb with distance",
                  a["sector"] == 1 and far["sector"] == 5
                  and a["sectorName"] != far["sectorName"],
                  f'{a["sectorName"]} -> {far["sectorName"]}')

            # ---- real keyboard: Space hops ---------------------------------------
            pg.evaluate(stage(90, 11, 0))
            pg.keyboard.press("Space")
            k1 = pg.evaluate(fn("return " + D + ".advance(0.22);"))
            check("Space hops (real key, no debug poke)",
                  k1["air"] > 0.5 and k1["grounded"] is False, f"air={k1['air']}")
            k2 = pg.evaluate(fn("return " + D + ".advance(0.6);"))
            check("the hop lands again", k2["grounded"] is True, f"air={k2['air']}")

            # ---- pause / resume --------------------------------------------------
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
            check("tab hidden auto-pauses", pg.evaluate(ST)["paused"] is True)
            pg.evaluate(fn("Object.defineProperty(document,'hidden',"
                           "{value:false,configurable:true});"
                           "document.dispatchEvent(new Event('visibilitychange'));"
                           "return 1;"))
            pg.evaluate(fn(D + ".resume();"))
            pg.wait_for_timeout(120)

            # ---- the drain reaches zero and blacks the grid out ------------------
            pg.evaluate(stage(9, 11, 0))
            e1 = pg.evaluate(ST)
            check("a run starts with the bar charged", e1["energy"] > 8, str(e1["energy"]))
            s11 = pg.evaluate(fn("return " + D + ".advance(3.0);"))
            check("0 energy ends the run", s11["phase"] == "over",
                  f"phase={s11['phase']} energy={s11['energy']}")
            check("energy can never go negative", s11["energy"] == 0.0, str(s11["energy"]))
            check("end screen appears", pg.evaluate(
                "()=>document.getElementById('s-over').classList.contains('on')"))
            end_txt = pg.evaluate("()=>document.body.innerText").upper()
            check("end screen shows stats",
                  "SCORE" in end_txt and "DISTANCE" in end_txt and "BATTERY CELLS" in end_txt,
                  end_txt[:120])
            rec = pg.evaluate("()=>JSON.parse(localStorage.getItem('vd_rec'))")
            check("records persisted to vd_rec",
                  rec and rec["games"] >= 1 and rec["best"] >= 1, str(rec))
            pg.screenshot(path=str(OUT / "06-over.png"))

            # ---- restart from the game-over screen -------------------------------
            pg.click("#again")
            pg.wait_for_timeout(250)
            s12 = pg.evaluate(ST)
            check("run again restarts a clean run",
                  s12["phase"] == "play" and s12["energy"] > 90 and s12["cells"] == 0
                  and s12["dist"] < 12,
                  f"phase={s12['phase']} energy={s12['energy']} dist={s12['dist']}")

            # ---- the frame really rendered: canvas pixel census ------------------
            pg.evaluate(stage(70, 11, 0, obs=("spike", 4.6), cells=((1.3, 0.6),)))
            pg.evaluate(fn(D + ".forceObstacle('beam',2.4);return " + D + ".advance(0.02);"))
            px = pg.evaluate(PIXEL_JS)
            check("canvas draws lime battery / runner pixels", px["lime"] > 300, str(px))
            check("canvas draws cyan grid / runner pixels", px["cyan"] > 300, str(px))
            check("canvas draws magenta zapper pixels", px["magenta"] > 200, str(px))
            check("canvas draws dark grid pixels", px["dark"] > 3000, str(px))
            check("canvas is not a flat blank frame", px["total"] > 100000, str(px))
            pg.screenshot(path=str(OUT / "07-render.png"))
            pg.evaluate(stage(64, 13, 210, obs=("spike", 4.4), cells=((1.2, 0.6),)))
            pg.evaluate(fn(D + ".forceObstacle('beam',2.6);return " + D + ".advance(0.02);"))
            pg.screenshot(path=str(OUT / "09-hazards.png"))

            # ---- portrait crop (mobile-first sizing) -----------------------------
            pg.set_viewport_size({"width": 1080, "height": 1920})
            pg.wait_for_timeout(250)
            pg.evaluate(stage(70, 14, 40, obs=("beam", 1.75), cells=((0.9, 1.45),)))
            pg.evaluate(fn(D + ".advance(0.02);"))
            pg.wait_for_timeout(120)
            rect = pg.evaluate(
                "()=>{const c=document.getElementById('hud').getBoundingClientRect();"
                "const e=document.getElementById('energyFill').getBoundingClientRect();"
                "return {hudTop:c.top,hudRight:c.right,barW:e.width,"
                "vw:innerWidth,vh:innerHeight};}")
            check("HUD survives the portrait crop",
                  rect["hudTop"] >= 0 and rect["hudRight"] <= rect["vw"] + 1
                  and rect["barW"] > 200,
                  str(rect))
            pg.screenshot(path=str(OUT / "08-portrait.png"))
            pg.set_viewport_size({"width": 1280, "height": 720})
            pg.wait_for_timeout(200)

            # ---- sound toggle persists -------------------------------------------
            pg.evaluate(fn("document.getElementById('sndBtn').click();return 1;"))
            pg.wait_for_timeout(150)
            saved = pg.evaluate("()=>localStorage.getItem('vd_snd')")
            check("sound toggle persists to vd_snd", saved is not None, str(saved))

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

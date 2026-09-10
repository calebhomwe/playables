"""Headless playtest gate for BRIDGE RUSH.

Spawns `python -m http.server 8156` itself, then drives a real Canvas 2D
Chromium through a whole race slice: boot + menu, a live run, deterministic
material pickup, laying bridge over a forced gap, running dry over a gap
(-> run over), a progressing rival, records to localStorage, pause/resume,
tab-hide auto-pause, restart, a canvas pixel census and the offline constraint
at runtime. Writes proof/*.png.

Run:  python tools/playtest.py   (needs playwright; screenshots land in proof/)
"""
import pathlib
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8156
URL = f"http://localhost:{PORT}/index.html"
OUT = ROOT / "proof"
OUT.mkdir(exist_ok=True)
ST = "()=>window.__bridge_debug.state()"

# Atomic setup: reset, freeze the sim, clear the deck, stop the spawner.
# (start() un-freezes, so freeze must happen in the same task.)
SETUP = ("(extra)=>{const d=window.__bridge_debug;d.start();d.freeze(true);"
         "d.clearTrack();d.setSpawner(false);(new Function('d',extra))(d);"
         "return d.state();}")

CENSUS = ("()=>{const c=document.querySelector('canvas');const g=c.getContext('2d');"
          "const w=c.width,h=c.height;const d=g.getImageData(0,0,w,h).data;"
          "let nb=0;const u=new Set();for(let i=0;i<d.length;i+=4*53){"
          "const r=d[i],gg=d[i+1],b=d[i+2];u.add((r>>4)+'_'+(gg>>4)+'_'+(b>>4));"
          "if(r+gg+b>54)nb++;}return {nb:nb,uniq:u.size,w:w,h:h};}")


def setup(pg, extra=""):
    return pg.evaluate(SETUP, extra)


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

    try:
        with sync_playwright() as p:
            br = p.chromium.launch(headless=True)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
            pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
            pg.on("request", lambda r: requests.append(r.url))

            pg.goto(URL, wait_until="load")
            pg.wait_for_timeout(1200)
            pg.evaluate("()=>window.__bridge_debug.wipe()")
            pg.reload(wait_until="load")
            pg.wait_for_timeout(1200)

            # ---- boot + menu --------------------------------------------------
            check("debug handle exists", pg.evaluate("()=>!!window.__bridge_debug"))
            check("canvas present",
                  pg.evaluate("()=>!!document.querySelector('canvas')"))
            body = pg.evaluate("()=>document.body.innerText")
            up = body.upper()
            check("menu shows title", "BRIDGE" in up and "RUSH" in up)
            check("menu explains the loop",
                  "material" in body.lower() and "gap" in body.lower()
                  and "rival" in body.lower())
            check("menu shows best distance", "Best" in body)
            pg.screenshot(path=str(OUT / "01-menu.png"))

            # ---- start() ------------------------------------------------------
            s = pg.evaluate("()=>window.__bridge_debug.start()")
            check("start() enters play", s["phase"] == "play" and not s["paused"])
            check("HUD visible", pg.evaluate(
                "()=>document.getElementById('hud').style.display==='flex'"))
            check("a gap is planned ahead", s["gaps"] >= 1, f"gaps={s['gaps']}")

            # a real Space starts the race from the menu too
            pg.evaluate("()=>window.__bridge_debug.menu()")
            pg.keyboard.press("Space")
            pg.wait_for_timeout(200)
            check("Space starts from the menu",
                  pg.evaluate(ST)["phase"] == "play")
            pg.wait_for_timeout(700)
            pg.screenshot(path=str(OUT / "02-play.png"))

            # ---- runner advances (deterministic) ------------------------------
            s0 = setup(pg)
            d0, f0 = s0["distExact"], s0["frames"]
            s1 = pg.evaluate("()=>window.__bridge_debug.advance(1.0)")
            check("runner advances on open deck",
                  s1["distExact"] > d0 + 3 and s1["frames"] > f0,
                  f"{d0} -> {s1['distExact']}")

            # ---- collecting material raises the counter -----------------------
            setup(pg, "d.setMaterial(0);")
            pg.evaluate("()=>window.__bridge_debug.spawnMaterialAt(6,0.62)")
            s = pg.evaluate("()=>window.__bridge_debug.advance(1.5)")
            check("collecting material raises the counter",
                  s["material"] >= 1 and s["matCollected"] >= 1,
                  f"material={s['material']} collected={s['matCollected']}")

            # ---- laying a bridge consumes material + extends the path ----------
            setup(pg, "d.autoBuild(false);d.setMaterial(3);")
            glen = pg.evaluate("()=>window.__bridge_debug.forceGap(8,4)")
            check("forced gap created", glen and glen > 4, f"len={glen}")
            s0 = pg.evaluate("()=>window.__bridge_debug.advance(1.5)")
            check("runner stops at the gap edge",
                  s0["blocked"] and s0["gap"] is not None,
                  f"blocked={s0['blocked']} gap={s0['gap']}")
            check("material untouched while idle",
                  s0["material"] == 3, f"material={s0['material']}")
            lad0 = s0["gap"]["lad"]
            pg.screenshot(path=str(OUT / "03-gap.png"))
            pg.evaluate("()=>window.__bridge_debug.layBridge()")
            s1 = pg.evaluate(ST)
            check("laying a segment spends material",
                  s1["material"] == 2 and s1["segsLaid"] >= 1,
                  f"material={s1['material']} segs={s1['segsLaid']}")
            check("the bridge extends over the gap",
                  s1["gap"]["lad"] > lad0 and s1["gap"]["lad"] <= s1["gap"]["x1"],
                  f"lad {lad0} -> {s1['gap']['lad']}")
            s2 = pg.evaluate("()=>window.__bridge_debug.advance(0.5)")
            check("the runner walks onto the new span",
                  s2["distExact"] > s1["distExact"] + 0.5,
                  f"{s1['distExact']} -> {s2['distExact']}")
            pg.screenshot(path=str(OUT / "04-bridge.png"))

            # ---- running out of material over a gap ends the run --------------
            setup(pg, "d.setMaterial(0);")
            pg.evaluate("()=>window.__bridge_debug.forceGap(8,4)")
            s = pg.evaluate("()=>window.__bridge_debug.advance(3.0)")
            check("dry over a gap ends the run",
                  s["phase"] == "over" and s["reason"] == "fall",
                  f"phase={s['phase']} reason={s['reason']}")
            check("end screen appears", pg.evaluate(
                "()=>document.getElementById('s-over').classList.contains('on')"))
            end_txt = pg.evaluate("()=>document.body.innerText").upper()
            check("end screen shows stats",
                  "SEGMENTS" in end_txt and "DISTANCE" in end_txt)
            rec = pg.evaluate("()=>JSON.parse(localStorage.getItem('br_rec'))")
            check("records persisted in br_rec",
                  rec and rec["games"] >= 1, str(rec))
            pg.screenshot(path=str(OUT / "05-over.png"))

            # ---- restart via the real button ----------------------------------
            pg.click("#again")
            pg.wait_for_timeout(300)
            s = pg.evaluate(ST)
            check("race again restarts the run",
                  s["phase"] == "play" and s["dist"] < 20
                  and s["segsLaid"] == 0 and s["material"] > 0,
                  f"phase={s['phase']} dist={s['dist']} segs={s['segsLaid']}")

            # ---- pause / resume + tab-hide auto-pause -------------------------
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(200)
            check("Escape pauses", pg.evaluate(ST)["paused"] is True)
            pg.click("#resume")
            pg.wait_for_timeout(200)
            check("resume continues", pg.evaluate(ST)["paused"] is False)
            pg.evaluate(
                "()=>{Object.defineProperty(document,'hidden',{configurable:true,"
                "get:()=>true});document.dispatchEvent(new Event('visibilitychange'));}")
            pg.wait_for_timeout(150)
            check("tab-hide auto-pauses", pg.evaluate(ST)["paused"] is True)
            pg.evaluate(
                "()=>{Object.defineProperty(document,'hidden',{configurable:true,"
                "get:()=>false});document.dispatchEvent(new Event('visibilitychange'));}")
            pg.evaluate("()=>window.__bridge_debug.resume()")

            # ---- rival progresses ---------------------------------------------
            setup(pg, "d.setRivalX(0);")
            s = pg.evaluate("()=>window.__bridge_debug.advance(2.0)")
            check("rival builder progresses",
                  s["rival"]["dist"] > 0, f"rival={s['rival']['dist']}")
            check("rival stays on its own span",
                  s["rival"]["finishT"] is None)
            pg.screenshot(path=str(OUT / "06-rival.png"))

            # ---- canvas pixel census (render chain is alive) ------------------
            setup(pg)
            pg.evaluate("()=>window.__bridge_debug.advance(0.3)")
            cen = pg.evaluate(CENSUS)
            check("render chain paints a non-blank frame",
                  cen["nb"] > 400 and cen["uniq"] > 5, str(cen))

            # ---- portrait 1080x1920 readability -------------------------------
            pg.set_viewport_size({"width": 540, "height": 960})
            pg.wait_for_timeout(300)
            setup(pg)
            pg.evaluate("()=>window.__bridge_debug.advance(0.3)")
            check("canvas resizes for portrait",
                  pg.evaluate("()=>{const c=document.querySelector('canvas');"
                              "return c.width>0 && c.height>c.width;}"))
            pg.screenshot(path=str(OUT / "07-portrait.png"))

            # ---- offline at runtime -------------------------------------------
            bad = [u for u in requests
                   if (u.startswith("http://") or u.startswith("https://"))
                   and not u.startswith(f"http://localhost:{PORT}")]
            check(f"zero external requests ({len(requests)} total)", not bad,
                  str(bad[:3]))
            check("zero console/page errors", not errors, str(errors[:3]))

            br.close()
    finally:
        server.terminate()

    shots = sorted(OUT.glob("*.png"))
    check(f"at least 3 proof shots ({len(shots)})", len(shots) >= 3,
          str([s.name for s in shots]))

    npass = sum(1 for _, ok, _ in checks if ok)
    print(f"\n{npass}/{len(checks)} asserts passed")
    if npass != len(checks):
        print("PLAYTEST: FAIL")
        sys.exit(1)
    print("PLAYTEST: PASS")


if __name__ == "__main__":
    main()

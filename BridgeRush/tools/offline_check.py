"""Offline gate: load the game from file:// — no server at all.

If any CDN asset were referenced the console would fill with errors.
Asserts the game boots clean with zero network access, shows the menu and
can actually start and drive a run.

Run:  python tools/offline_check.py
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent

with sync_playwright() as p:
    br = p.chromium.launch(headless=True)
    pg = br.new_page(viewport={"width": 1280, "height": 720})
    errors, requests = [], []
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    pg.on("request", lambda r: requests.append(r.url))
    pg.goto((ROOT / "index.html").as_uri(), wait_until="load")
    pg.wait_for_timeout(2500)
    hooked = pg.evaluate("()=>!!window.__bridge_debug")
    menu = pg.evaluate("()=>document.querySelector('.screen.on')!==null")
    body = pg.evaluate("()=>document.body.innerText").upper()
    title = "BRIDGE" in body and "RUSH" in body
    # drive a real deterministic run under file://
    drivable = pg.evaluate(
        "()=>{const d=window.__bridge_debug;d.start();d.freeze(true);"
        "d.clearTrack();d.setSpawner(false);d.advance(1.0);"
        "const a=d.state().distExact;d.forceGap(8,4);d.advance(1.5);"
        "const s=d.state();return {moved:a>3,blocked:s.blocked,material:s.material};}")
    br.close()

fails = []
ext = [u for u in requests
       if (u.startswith("http://") or u.startswith("https://"))]
if errors:
    fails.append(f"{len(errors)} console errors: {errors[:3]}")
if not hooked:
    fails.append("debug hook missing under file://")
if not menu:
    fails.append("menu never appeared under file://")
if not title:
    fails.append("menu title missing under file://")
if not drivable.get("moved"):
    fails.append("runner did not advance under file://")
if not drivable.get("blocked"):
    fails.append("gap did not block the runner under file://")
if ext:
    fails.append(f"external requests under file://: {ext[:3]}")

for f in fails:
    print("FAIL  " + f)
print(f"  requests: {len(requests)} total, {len(ext)} external (must be 0)")
print("OFFLINE:", "FAIL" if fails else "PASS")
sys.exit(1 if fails else 0)

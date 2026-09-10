"""Offline gate: load the game from file:// — no server at all.

If any CDN asset were referenced the console would fill with errors.
Asserts the game boots clean with zero network access, and that the arena snake
is still drivable with nothing behind it.

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
    hooked = pg.evaluate("()=>!!window.__snake_debug")
    menu = pg.evaluate("()=>document.querySelector('.screen.on')!==null")
    # the game must still be drivable with no server behind it
    st = pg.evaluate("()=>window.__snake_debug.start()")
    head0 = pg.evaluate("()=>window.__snake_debug.state().head")
    drove = pg.evaluate("()=>window.__snake_debug.advance(0.5).head")
    br.close()

fails = []
if errors:
    fails.append(f"{len(errors)} console errors: {errors[:3]}")
if not hooked:
    fails.append("debug hook missing under file://")
if not menu:
    fails.append("menu never appeared under file://")
if st.get("phase") != "play":
    fails.append(f"could not start a run under file:// (phase={st.get('phase')!r})")
moved = head0 and drove and (abs(drove["x"] - head0["x"]) + abs(drove["y"] - head0["y"]) > 4)
if not moved:
    fails.append(f"snake never moved under file:// ({head0} -> {drove})")
bad = [u for u in requests if not u.startswith("file:")]
if bad:
    fails.append(f"{len(bad)} non-file:// requests: {bad[:3]}")

for f in fails:
    print("FAIL  " + f)
print(f"  file:// requests: {len(requests)} (all file:)")
print(f"  head after start(): {head0} -> {drove}  phase: {st.get('phase')}")
print("OFFLINE:", "FAIL" if fails else "PASS")
sys.exit(1 if fails else 0)

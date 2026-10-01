"""Offline gate: load the game from a throwaway localhost server — no outside network at all.

The 3D build is ES modules (the vendored three.js in ../lib3d plus its GLB models), which
browsers refuse to load from file://, so the page is served from 127.0.0.1 out of this
repo instead; every request must still stay on that local origin (or the arcade SDK).

If any CDN asset were referenced the console would fill with errors.
Asserts the game boots clean with zero network access, shows the menu and
can actually start and drive a run.

Run:  python tools/offline_check.py
"""
import functools
import http.server
import os
import pathlib
import threading
import sys

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# The one allowed outside request: Caleb's Arcade SDK and its shared sound kit (the game runs without them).
ARCADE = "https://calebhomwe.github.io/arcade/"
ROOT = pathlib.Path(__file__).resolve().parent.parent


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


_srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(_Quiet, directory=str(ROOT.parent)))
threading.Thread(target=_srv.serve_forever, daemon=True).start()
LOCAL = f"http://127.0.0.1:{_srv.server_address[1]}/"

with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None, headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = br.new_page(viewport={"width": 1280, "height": 720})
    errors, requests = [], []
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    pg.on("request", lambda r: requests.append(r.url))
    pg.goto(LOCAL + ROOT.name + "/index.html", wait_until="load")
    pg.wait_for_timeout(2500)
    hooked = pg.evaluate("()=>!!window.__bridge_debug")
    menu = pg.evaluate("()=>document.querySelector('.screen.on')!==null")
    body = pg.evaluate("()=>document.body.innerText").upper()
    title = "BRIDGE" in body and "RUSH" in body
    # drive a real deterministic run offline
    drivable = pg.evaluate(
        "()=>{const d=window.__bridge_debug;d.start();d.freeze(true);"
        "d.clearTrack();d.setSpawner(false);d.advance(1.0);"
        "const a=d.state().distExact;d.forceGap(8,4);d.advance(1.5);"
        "const s=d.state();return {moved:a>3,blocked:s.blocked,material:s.material};}")
    br.close()

fails = []
ext = [u for u in requests
       if (u.startswith("http://") or u.startswith("https://"))
       and not u.startswith(ARCADE) and not u.startswith(LOCAL)
       and not u.startswith("blob:" + LOCAL)]  # GLB textures decode through local blob: URLs
if errors:
    fails.append(f"{len(errors)} console errors: {errors[:3]}")
if not hooked:
    fails.append("debug hook missing offline")
if not menu:
    fails.append("menu never appeared offline")
if not title:
    fails.append("menu title missing offline")
if not drivable.get("moved"):
    fails.append("runner did not advance offline")
if not drivable.get("blocked"):
    fails.append("gap did not block the runner offline")
if ext:
    fails.append(f"external requests offline: {ext[:3]}")

for f in fails:
    print("FAIL  " + f)
print(f"  requests: {len(requests)} total, {len(ext)} external (must be 0)")
print("OFFLINE:", "FAIL" if fails else "PASS")
sys.exit(1 if fails else 0)

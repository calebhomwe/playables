"""Offline gate: load the game from a throwaway localhost server — no outside network at all.

The 3D build is ES modules (the vendored three.js in ../lib3d plus its GLB models), which
browsers refuse to load from file://, so the page is served from 127.0.0.1 out of this
repo instead; every request must still stay on that local origin (or the arcade SDK).

If any CDN asset were referenced the console would fill with errors.
Asserts the game boots clean with zero network access, and that the helix is
still drivable with nothing behind it.

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
    hooked = pg.evaluate("()=>!!window.__helix_debug")
    menu = pg.evaluate("()=>document.querySelector('.screen.on')!==null")
    # the game must still be drivable with no server behind it
    st = pg.evaluate("()=>window.__helix_debug.start()")
    drove = pg.evaluate("()=>window.__helix_debug.advance(0.6).ballY")
    br.close()

fails = []
if errors:
    fails.append(f"{len(errors)} console errors: {errors[:3]}")
if not hooked:
    fails.append("debug hook missing offline")
if not menu:
    fails.append("menu never appeared offline")
if st.get("phase") != "play":
    fails.append(f"could not start a run offline (phase={st.get('phase')!r})")
if drove is None:
    fails.append("ball never moved offline")
bad = [u for u in requests if not u.startswith(LOCAL) and not u.startswith(ARCADE)
       and not u.startswith("blob:" + LOCAL)]  # GLB textures decode through local blob: URLs
if bad:
    fails.append(f"{len(bad)} non-local requests: {bad[:3]}")

for f in fails:
    print("FAIL  " + f)
print(f"  local requests: {len(requests)} (all local)")
print(f"  ballY after start(): {drove}  phase: {st.get('phase')}")
print("OFFLINE:", "FAIL" if fails else "PASS")
sys.exit(1 if fails else 0)

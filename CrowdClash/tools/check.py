"""Static gate on the single-file game (CROWD CLASH).

Hard constraint: OFFLINE — zero network. Any external reference is a FAIL.
Also parses the inline <script> with node --check, and sanity-checks the
crowd-runner constants, the persistence keys and the debug hook wiring.

Run:  python tools/check.py [index.html]
"""
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = r"C:\Users\caleb\nodejs\node-v24.18.0-win-x64\node.exe"

path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "index.html")
src = open(path, encoding="utf-8").read()
# The one allowed outside reference: Caleb's Arcade SDK, loaded first in <head> (pause menu, mute,
# codes, shared sound kit). The game is guarded to run on its own when it cannot load, so the
# offline gate below checks everything else.
ARCADE_SDK_TAG = '<script src="https://calebhomwe.github.io/arcade/assets/arcade-sdk.js"></script>'
if src.count(ARCADE_SDK_TAG) != 1:
    print("  FAIL  the arcade SDK tag must appear exactly once")
    sys.exit(1)
src = src.replace(ARCADE_SDK_TAG, "")
fails, warns = [], []

if not src.lstrip().startswith("<!DOCTYPE"):
    fails.append("does not start with <!DOCTYPE>")
if not src.rstrip().endswith("</html>"):
    fails.append("TRUNCATED: does not end with </html>")
if "```" in src:
    fails.append("markdown fence leaked into the file")

# node --check the single inline script
# The 3D renderer (three.js r180 + ../lib3d/p3d.js) is vendored in this repo and mapped by one
# import map; it must stay local (no CDN), and the game itself is still ONE inline module script.
maps = re.findall(r"<script type=\"importmap\">(.*?)</script>", src, re.S)
if len(maps) != 1 or re.search(r"https?:|//", maps[0]) or "../lib3d/three/" not in maps[0]:
    fails.append("the import map must exist once and point only at the vendored ../lib3d/three/")
if not os.path.exists(os.path.join(ROOT, "..", "lib3d", "p3d.js")):
    fails.append("missing the shared 3D layer ../lib3d/p3d.js")
bodies = re.findall(r"<script(?![^>]*\bsrc=)(?![^>]*importmap)[^>]*>(.*?)</script>", src, re.S)
if len(bodies) != 1:
    fails.append(f"expected exactly ONE inline <script>, found {len(bodies)}")
elif os.path.exists(NODE):
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False,
                                     encoding="utf-8", newline="") as fh:
        fh.write(bodies[0])
        tmp = fh.name
    try:
        r = subprocess.run([NODE, "--check", tmp], capture_output=True, text=True)
        if r.returncode != 0:
            err = [ln for ln in (r.stderr or "").splitlines() if "Error" in ln or "^" in ln]
            fails.append("JS parse error: " + " / ".join(err[:3]))
    finally:
        os.unlink(tmp)

# --- OFFLINE GATE -------------------------------------------------------
urls = [m.group(0) for m in re.finditer(r"https?://[^\s\"')<>]+", src)]
for u in urls:
    if u.startswith("http://www.w3.org/"):
        continue  # SVG namespace identifier, never fetched
    fails.append(f"NETWORK REFERENCE (breaks offline): {u[:80]}")
for tok in ("cdn.", "unpkg", "jsdelivr", "googleapis", "@import url(",
            "fetch(", "XMLHttpRequest", "new WebSocket", "importScripts"):
    if tok in src:
        fails.append(f"network API / remote asset token: {tok}")
if re.search(r"<script[^>]+src=", src):
    fails.append("any <script src= (must be a single inline script)")
if re.search(r"<link[^>]+href=[\"']https?:", src):
    fails.append("remote <link> stylesheet")
if not re.search(r"<link[^>]+rel=[\"']icon[\"'][^>]+href=[\"']data:", src):
    fails.append("favicon is not an inline data: URI (offline scan must be 0)")

# --- game contract ------------------------------------------------------
for need in ("window.__crowd_debug", "requestAnimationFrame", "getContext",
             "visibilitychange", "localStorage", "cc_rec", "cc_snd",
             'id="play"', 'id="again"', 'id="resume"', 'id="s-over"',
             'id="crowdCount"', 'id="sndBtn"', 'id="bossChip"',
             "CANVAS", "BOSS_Z", "BOSS_HP", "SPEED0", "SPEED1", "SPEED_RAMP",
             "CROWD0", "CROWD_MAX", "VISIBLE_CROWD", "CLUMP_K", "LANE_MAX",
             "GATE_HW", "GATE_H", "POST_HALF", "POST_LOSS", "BAR_HW",
             "BAR_LOSS", "MACE_HW", "MACE_LOSS", "HIT_CD", "CAM_BACK",
             "GATE_EVERY0", "GATE_EVERY1", "OBS_EVERY0", "OBS_EVERY1",
             "spawnGateAt", "runThroughGate", "forceObstacle", "setCrowd",
             "setLane", "setDist", "setSpeed", "clearTrack", "setSpawner",
             "freeze(", "live(", "advance("):
    if need not in src:
        fails.append(f"missing required hook: {need}")
for tok in ("TODO", "FIXME", "rest of the code", "your code here"):
    if tok.lower() in src.lower():
        warns.append(f"placeholder marker: {tok}")
if "neon" in src.lower():
    warns.append("the word neon appears — check the art direction")

if src.count("{") - src.count("}") != 0:
    fails.append(f"unbalanced braces: {src.count('{') - src.count('}'):+d}")

print(f"{path}: {len(src.splitlines())} lines, {len(src)} chars")
print(f"  offline scan: {len(urls)} http(s) URLs found (must be 0)")
for w in warns:
    print("  WARN  " + w)
for f in fails:
    print("  FAIL  " + f)
print("RESULT:", "FAIL" if fails else "PASS", f"({len(fails)} fail, {len(warns)} warn)")
sys.exit(1 if fails else 0)

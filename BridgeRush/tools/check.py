"""Static gate on the single-file game (BRIDGE RUSH).

Hard constraint: OFFLINE — zero network. Any external reference is a FAIL.
Also parses the inline <script> with node --check, and sanity-checks the
bridge-builder constants, the persistence keys and the debug hook wiring.

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
fails, warns = [], []

if not src.lstrip().startswith("<!DOCTYPE"):
    fails.append("does not start with <!DOCTYPE>")
if not src.rstrip().endswith("</html>"):
    fails.append("TRUNCATED: does not end with </html>")
if "```" in src:
    fails.append("markdown fence leaked into the file")

# node --check the single inline script
bodies = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", src, re.S)
if len(bodies) != 1:
    fails.append(f"expected exactly ONE inline <script>, found {len(bodies)}")
elif os.path.exists(NODE):
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False,
                                     encoding="utf-8") as fh:
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
for need in ("window.__bridge_debug", "requestAnimationFrame", "getContext",
             "visibilitychange", "localStorage", "br_rec", "br_snd",
             'id="play"', 'id="again"', 'id="resume"', 'id="s-over"',
             'id="matFill"', 'id="sndBtn"', 'id="hud"',
             "SPEED0", "SPEED1", "SPEED_RAMP", "FINISH_DIST", "GRAVITY",
             "HOP_V", "STAND_H", "SEG_W", "SEG_COST", "LAY_TIME", "TEETER",
             "MAT_START", "MAT_GAIN", "GAPSEG0", "GAPSEG1", "groundNow",
             "spawnMaterialAt", "forceGap", "layBridge", "setMaterial",
             "setRivalX", "setSpawner", "clearTrack", "advance("):
    if need not in src:
        fails.append(f"missing required hook: {need}")
for tok in ("TODO", "FIXME", "rest of the code", "your code here"):
    if tok.lower() in src.lower():
        warns.append(f"placeholder marker: {tok}")

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

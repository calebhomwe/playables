"""Hub gate for the PLAYABLES pack landing page.

Serves C:\\Games\\Web\\Playables, loads the launcher, and asserts:
  - the shelf renders exactly 6 cards
  - every thumbnail actually loads (naturalWidth > 0)
  - every card link resolves (HTTP 200 to the game's index.html)
  - every game actually boots (canvas present)
  - zero console / page errors
Screenshot lands in proof/hub.png.

Run:  python tools/hub_check.py
"""
import pathlib
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(r"C:\Games\Web\Playables")
PORT = 8180
URL = f"http://localhost:{PORT}/index.html"
OUT = ROOT / "proof"
OUT.mkdir(exist_ok=True)
GAMES = ["RungRunner", "VoltDash", "CrowdClash", "HelixDrop", "SnakeClash", "BridgeRush"]


def main():
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)],
        cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    errors, checks = [], []

    def check(name, ok, detail=""):
        checks.append((name, bool(ok), str(detail)))
        print(("  ok  " if ok else "FAIL  ") + name + (f"  [{detail}]" if detail and not ok else ""))

    try:
        with sync_playwright() as p:
            br = p.chromium.launch(headless=True)
            pg = br.new_page(viewport={"width": 1280, "height": 950})
            pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
            pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))

            pg.goto(URL, wait_until="load")
            pg.wait_for_timeout(1400)

            check("title present", "PLAYABLES" in pg.evaluate("()=>document.body.innerText"))
            n = pg.evaluate("()=>document.querySelectorAll('a.card').length")
            check("six game cards", n == 6, f"cards={n}")
            nimg = pg.evaluate(
                "()=>Array.from(document.querySelectorAll('.thumb img'))"
                ".filter(i=>i.complete && i.naturalWidth>0).length")
            check("thumbnails load", nimg == 6, f"loaded={nimg}")

            hrefs = pg.evaluate(
                "()=>Array.from(document.querySelectorAll('a.card'))"
                ".map(a=>a.getAttribute('href'))")
            for h in hrefs:
                u = f"http://localhost:{PORT}/" + h.lstrip("./")
                code = urllib.request.urlopen(u, timeout=5).status
                check(f"link {h}", code == 200, f"HTTP {code}")

            for g in GAMES:
                pg2 = br.new_page(viewport={"width": 1024, "height": 720})
                pg2.goto(f"http://localhost:{PORT}/{g}/index.html", wait_until="load")
                pg2.wait_for_timeout(700)
                ok = pg2.evaluate("()=>!!document.querySelector('canvas')")
                check(f"{g} boots", ok)
                pg2.close()

            check("zero console/page errors", not errors, str(errors[:3]))
            pg.screenshot(path=str(OUT / "hub.png"), full_page=True)
            br.close()
    finally:
        server.terminate()

    npass = sum(1 for _, ok, _ in checks if ok)
    print(f"\n{npass}/{len(checks)} asserts passed")
    print("HUB:", "PASS" if npass == len(checks) else "FAIL")
    sys.exit(0 if npass == len(checks) else 1)


if __name__ == "__main__":
    main()

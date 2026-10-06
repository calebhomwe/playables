# Playables

Six three.js browser games sharing `lib3d/`: Crowd Clash, Bridge Rush, Helix Drop, Rung Runner, Snake Clash and Volt Dash. The launcher is `index.html`; each game is `<Game>/index.html`. They are also listed in [Caleb's Arcade](https://calebhomwe.github.io/arcade/).

## Play / Test

- **Play online:** https://calebhomwe.github.io/playables/ (deployed from `main` by the `Deploy to GitHub Pages` workflow)
- **Run locally:** `python3 -m http.server 8080`, then open http://localhost:8080/ (serve the repo root: games load `../lib3d/`)
- **Smoke test** (launcher + all six games in headless Chromium, fails on page errors or missing files; the `Smoke` workflow runs it on every push and PR):

  ```sh
  npm install --no-save --no-package-lock playwright@1.58.2 && npx playwright install chromium
  python3 -m http.server 8080 &
  node .github/smoke.mjs http://127.0.0.1:8080/ index.html */index.html
  ```

- **Hub gate** (Python Playwright): `python3 tools/hub_check.py` checks six cards, thumbnails, links, that every game boots, and zero console errors.

The per-game `*/tools/playtest.py` scripts predate the 3D rebuild and several of their assertions (2D pixel census, menu wording) no longer match the games; only Volt Dash's passes as of 2026-10-06.

# RUNG RUNNER — moonlight ladder runner

Single-file Canvas 2D hyper-casual endless runner. HARD CONSTRAINT like the
studio's other web games: **fully OFFLINE, one `index.html`, zero network,
localStorage records.** No build step, no assets, no CDN.

- Play: `node serve.js` → http://localhost:8151 (or any static server, or
  plain `file://` — both verified).
- Art direction: bright, high-contrast, premium playable-ad palette — deep
  indigo glass UI, cyan / gold / hot-pink accents, flat shapes with soft
  gradients. The sky climbs as you do: Daylight → Golden Hour → Nightfall →
  Orbit → Deep Field, with the sun/moon swelling into a starfield.
- View: pseudo-3D **behind-the-back** camera. Three lanes, perspective road
  rushing at the camera. Everything is drawn from world quads projected with
  `s = f / (wz - dist + CAM_BACK)`.

## Loop

You **auto-run forward** and never stop. There is no jump — the whole game is
lane choice.

- **Rungs** float in the lanes. Running through one **collects** it: your
  ladder stack grows by 1, a particle burst pops, a chime rings (pitch rises
  with the stack) and the stack pill climbs.
- **Walls** cross the whole road periodically and carry a height number on
  their face. You clear a wall **only if `stack >= wall.h`**; clearing
  **spends exactly `wall.h` rungs**. Come up short and you **splat** — run
  over.
- **Spinning saws** occupy one lane each. Touching a saw is instant death.
  **Exact saw rule:** a saw only kills you if the lane you are occupying
  overlaps it — `|playerX - sawLaneX| < 0.66` world units when the saw's `z`
  reaches your `dist`. Lane changes are eased, so clipping the boundary of a
  neighbouring lane at the last moment still counts as that lane. There is no
  partial credit and no way to jump a saw.
- Rungs and walls are checked the same way (`|Δx| < 0.58` for rungs); walls
  span every lane so lane choice cannot dodge one.

## Numbers

| thing | value |
|---|---|
| Score | `floor(distance) + 4 × rungsCollected` |
| Speed | `lerp(14.5, 31, dist / 950)` — full ramp by 950 m |
| Lanes | 3, centred, spacing `LANE = 1.14` world units, road half-width `2.02` |
| Camera | `CAM_H = 1.85`, `CAM_BACK = 6.0`, `DRAW_DIST = 76` |
| Projection | `U = min(H×0.26, W×0.34)` px per world unit; `f = U × CAM_BACK`; `HY = clamp(H×0.78 − CAM_H·U, 0.16H, 0.60H)` |
| Rung float height | `RUNG_Y = 0.94` (they hang above the road, with a beam to the ground) |
| Wall unit | `WALL_UNIT = 0.34` world units per wall height step; walls are `1..6` tall |
| Zone | `ZONE_DIST = 210` m per zone, 5 zones |
| Rung spacing | `lerp(6.6, 4.3, diff)` |
| Wall spacing | `lerp(58, 34, diff)` |
| Saw chance | `lerp(0.07, 0.30, diff)` per beat, min 13 units apart |
| Wall height roll | 40% relative to your stack, else `clamp(round(2 + 4·diff + rnd(−0.6, 1.3)), 1, 6)` |

`diff = clamp(dist / 950, 0, 1)`. Fairness rule baked into the spawner: in the
52 units before a wall the road spawns **rungs only** (often paired in one
lane), so a tall wall always has a ladder in front of it; the last 7 units
before a wall are kept clear.

`rr_rec` = `{games, best, rungs, walls, dist, stack}` (lifetime totals; `best`
is best score). Sound toggle persists as `rr_snd`.

## Feel

- **Juice:** the runner squashes on pickup and stretches as it springs back;
  lane changes are eased (no snapping); a particle burst + expanding ring +
  ascending chime on every rung (chime pitch rises with the stack); the
  ladder stack visibly grows above the runner's shoulder and leans back-left
  so the road ahead stays readable; clearing a wall rumbles and shakes the
  camera; a wall splat or saw hit flashes white, shakes, sprays debris and
  tumbles the runner; floating "+1 / ×N / HEIGHT n" combo text.
- **Audio: WebAudio synth only** — oscillators plus a generated noise buffer
  through a bandpass. Zero asset files. Nothing is fetched.
- Ambient: sun/moon parallax and stars that fade in by zone; roadside pylons
  with pulsing cyan lamps; speed lines at high velocity; vignette.

## Controls

- **Steer:** `←` `→`, `A` / `D`. On touch: tap the left / right half of the
  screen, or swipe horizontally.
- `Space` / `Enter` = start or restart. `Esc` / `P` = pause. `M` = mute.
  Tab hidden **auto-pauses** (`visibilitychange`).
- Sound toggle button in the HUD persists `rr_snd`.

## Verify (the gates)

```
python tools/check.py         # static: offline scan, node --check, hooks, braces
python tools/playtest.py      # live :8151 — deterministic mechanics via debug hook
python tools/offline_check.py # file:// boot with zero network
```

All three must pass before any change is called done. The required debug hook
`window.__rung_debug` (state / start / menu / wipe / pause / resume / end /
setSpawner / clearTrack / setStack / setLane / snapLane / setDist /
spawnRungAt / forceWall / forceSaw / advance) exists for the playtest —
read-mostly, **do not remove**.

Deterministic staging recipe used by the gate (spawner off, then place, then
step the fixed-step sim):

```js
__rung_debug.start();
__rung_debug.setSpawner(false);
__rung_debug.setDist(0);      // then clearTrack() resets the wall clock
__rung_debug.clearTrack();
__rung_debug.setStack(6);
__rung_debug.snapLane(1);
__rung_debug.forceWall(4, 14);
__rung_debug.advance(1.6);    // 1/60 s fixed steps, then one render()
```

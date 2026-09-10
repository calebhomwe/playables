# HELIX DROP — rotating-gap helix diver

Single-file Canvas 2D hyper-casual game. HARD CONSTRAINT like the studio's other
web games: **fully OFFLINE, one `index.html`, zero network, localStorage
records.** No build step, no assets, no CDN, no `<script src>`, favicon is a
`data:` URI.

- Play: `node serve.js` → http://localhost:8154 (or any static server, or plain
  `file://` — both verified).
- Art direction: premium high-contrast. Deep navy well, light steel tower,
  saturated accents — mint ball, blue safe blocks, hot-red danger, gold bonus.
  Legible at 1280x720 and portrait 1080x1920.

## The 2D reinterpretation — side-on sliding-gap shaft

The 3D helix is reduced to a **side-on shaft** you look straight into. The ball
hangs on the tower axis (screen centre) and only ever falls straight down. Each
ring of the helix is drawn as a **horizontal band of blocks** across the shaft:
most blocks are safe, some are red danger, some are gold bonus, and one run of
blocks is missing — the **gap**.

Rotating the helix slides every ring's block pattern sideways through the shaft
window (the pattern is cyclic, so blocks wrap around the tower). That is the
whole mechanic: **rotate until the gap is under the ball, and the ball drops
through to the next ring.** This keeps the ball, the fall and the depth all on
one readable vertical axis while rotation stays a single, obvious gesture.

Why side-on and not top-down: a top-down disc hides the fall (the ball would
have to shrink "into" the screen) and can only show one ring at a time. Side-on
shows the ball, the ring it is bouncing on *and* the rings below it at once, so
you can read the coming pattern and plan the rotation. Depth is literally
downward distance, which makes speed/hazard ramps legible.

## Loop

The ball falls; it bounces on whatever block sits under it.

- **Gap under the ball** → it threads through and descends a ring. Depth +1.
  Depth is the score (max depth is the record).
- **Safe block under the ball** → it bounces (squash + dust + thump).
- **Gold block under the ball** → bounce plus a bonus point (chime + star burst).
- **Red block under the ball** → the run ends (warning flash while you fall
  toward one, red flash + shake on contact).

Deferred red blocks are warned as you fall; a gap flanked by red triggers a
brief slow-mo "near-miss". Threading gaps without touching a block chains a
clean-drop combo; touching down resets it.

Rooms for skill: since rotation is continuous, a red block between you and the
gap can often be skipped by rotating while the ball is airborne.

## Numbers

- `SHAFT_W 380` world px, `SEG_COUNT 11` blocks across the shaft,
  `GAP_CELLS 2`, `LEVEL_H 150` px between ring tops, `PLAT_H 26`, `BALL_R 22`.
- `GRAVITY 1500` (ramps up to ×2.3 with depth), `BOUNCE_V 560`, `MAX_FALL 2600`.
- Rotation: `ROT_SPEED 7.0` blocks/s, `ROT_RAMP +0.11` blocks/s per depth,
  capped at `ROT_MAX 15`.
- Difficulty: danger blocks per ring grow with depth (`DANGER_MAX 4`); gaps
  occasionally narrow to 1 block past ring 16.
- Depth → tier every `DEPTH_PER_LEVEL 8` rings, named across
  `SECTOR_NAMES = [Surface … Core]`.
- `hx_rec` = {games, best, bonus, combo}. `hx_snd` = sound on/off.
- All-time best depth is drawn in-world as a dashed mint line labelled "BEST n".

## Feel

- Bounce squash + stretch, ground dust, low thump.
- Gap-thread swoosh; near-miss shimmer + 0.35× slow-mo.
- Depth popups ("DEPTH n"), rising depth blip.
- Red warning flicker while a danger block is under the falling ball.
- Death: red flash, screen shake, descending crash.
- Clean-drop combo popups; bonus star bursts.
- WebAudio SYNTH ONLY (oscillators + one noise buffer). No samples.

## Controls

`← →` or `A / D` hold to rotate · drag on touch. `Esc` pauses. `M` mutes
(persisted `hx_snd`). Tab hidden auto-pauses. Space / tap starts and restarts.

## Verify (the gate)

```
python tools/check.py         # static: offline scan, node --check, hooks, braces
python tools/playtest.py      # live :8154 — deterministic asserts via debug hook
python tools/offline_check.py # file:// boot with zero network
```

All three must pass before any change is called done. Debug hook
`window.__helix_debug` (state/start/wipe/freeze/advance/setBallX/rotateTo/
forceDanger/alignGap/…) exists for the playtest — read-mostly, do not remove.

# SNAKE CLASH — top-down arena snake.io grower

Single-file Canvas 2D hyper-casual game. HARD CONSTRAINT like the studio's other
web games: **fully OFFLINE, one `index.html`, zero network, localStorage
records.** No build step, no assets, no CDN, no `<script src>`, favicon is a
`data:` URI. WebAudio is synth-only (oscillators + one generated noise buffer).

- Play: `node serve.js` → http://localhost:8155 (or any static server, or plain
  `file://` — both verified).
- Art direction: premium high-contrast. Deep navy arena, glowing cyan wall,
  mint player snake, hot-pink/orange/violet rivals, warm glowing orbs. Legible
  at 1280x720 and portrait 1080x1920.

## The mechanic — one snake versus many

Top-down square arena. Your snake is **continuously moving** and its body is a
trail recorded in a ring buffer, so it grows rear-first: every orb you eat
extends the tail. You never stop; you only steer.

- **Eat glowing orbs** to grow (+1 length each, pitch-rising chomp).
- **Rivals** roam the same arena, eat orbs, grow, dodge walls, and will chase
  you once they are longer than you.
- **Touch a rival's body → you burst** into a shower of orbs.
- **Touch the wall → you burst.**
- **Head-on clash** with a rival's head is decided by length: the longer snake
  survives and the shorter one bursts. Cut a rival off so it runs its head into
  your body and it bursts instead.
- **Boost** (hold `Shift` / `Space`) trades length for speed — it burns length
  at a fixed rate while held, with a hard floor so you can never boost yourself
  to death.

Score = length achieved (max length this run) + orbs eaten + whole seconds
survived. Rank is live: 1 + the number of live rivals longer than you.

## Ramp

Difficulty is driven purely by your own length, so the pack scales with you:
`want = clamp(3 + floor(len / 7), 3, 9)` rivals, and every rival's speed is
`0.86 + min(len / 320, 0.42)`.

## Numbers

- Arena `ARENA 2600` world px square, `WALL 28` thick, camera `VIEW 820` px
  across the short screen edge (`zoom = clamp(min(W,H)/820, .5, 1.9)`).
- Body ring buffer `MAXSEG 420`, `SPACING 12` world px between recorded points,
  `SEG_R 10`, `HEAD_R 12`, start length `START_LEN 14`, boost floor
  `MIN_BOOST_LEN 12`.
- Orbs: `ORB_R 9`, `ORB_GROWTH 1`, `ORB_TARGET 150` live (topped up),
  `ORB_MAX 520`.
- Speed `BASE_SPEED 212` px/s, boost `BOOST_MULT 1.85`, burn `BURN_RATE 9`
  length/s. Mouse-look turn `TURN_RATE 3.8` rad/s, arrow turn `KEY_TURN 3.6`,
  rival turn `RIVAL_TURN 2.7`, rival speed `RIVAL_SPEED 0.86`.
- Rivals `RIVAL_START 3`, `RIVAL_MAX 9`, ramp divisor `RIVAL_RAMP 7`.
- `sc_rec` = {games, best, bestScore, orbs, kills}. `sc_snd` = sound on/off.

## Feel

- Orb pop ring + particle pop; chomp pitch rises with orbs eaten.
- Player outline glow grows with length; extra bloom while boosting.
- Boost = streaked exhaust particles, screen micro-shake, low whoosh burst.
- Death = full burst into orbs, heavy screen shake, descending crash chord.
- "+1 LENGTH" floaters on every orb; "BURST" floater when a rival dies.
- Minimap (bottom-right) shows every rival, you, and the current view rect.

## Controls

Mouse move aims the head · `← →` or `A / D` turn · drag on touch ·
`Shift` / `Space` boost · `Esc` pause · `M` mute · `Space` / tap starts and
restarts. Tab hidden auto-pauses (`visibilitychange`), never auto-resumes.

## Screens

MENU (title, how-to-play, best length) → PLAY (HUD: length / score / rank,
sound + pause buttons) → GAME OVER (kicker, stats table, best, PLAY AGAIN).

## Verify (the gate)

```
python tools/check.py         # static: offline scan, node --check, hooks, braces
python tools/playtest.py      # live :8155 — deterministic asserts via debug hook
python tools/offline_check.py # file:// boot with zero network
```

All three must pass before any change is called done. Debug hook
`window.__snake_debug` (state/start/resume/pause/wipe/freeze/advance/setSpawner/
clearArena/spawnOrbAt/setHead/setHeading/setLength/setBoost/spawnRival/
forceRival/kill) exists for the playtest — read-mostly, do not remove.

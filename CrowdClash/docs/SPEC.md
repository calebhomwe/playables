# CROWD CLASH — specification

Game 3 of the Playables pack. A single-file, fully offline Canvas 2D
hyper-casual **crowd-runner** (genre ref: "Tiny Run 3D" / crowd multiplier).

- **Entry point:** `index.html` — the whole game. Exactly ONE inline `<script>`,
  no build step, no asset files.
- **Run it:** `node serve.js` then open `http://localhost:8153/`
  (or `python -m http.server 8153`). Also boots straight from `file://`.
- **Look:** a bright, chunky **sticker book** — sky-blue gradient, fat grass,
  a candy-striped lilac track with cream kerbs, and round little characters with
  ink outlines who clump into a crowd behind a flag-bearer. Deliberately distinct
  from Game 1 (`RungRunner`, glassy lanes) and Game 2 (`VoltDash`, neon grid):
  here nothing glows, everything has a 3 px ink outline and a hard drop shadow.

---

## 1. The loop

You steer a **crowd** — a real flock that trails and re-packs behind the leader
— down a straight track. **GATES** span the road in two halves; whichever half
you are in when you reach it applies its operation to your count. Spinning bars
and swinging maces knock members out on contact, so the count is also your
health. At the end of the road sits the **BOSS GATE**; carry enough crowd past
its threshold and it bursts.

```
MENU --(tap / Space / START THE RUN)--> PLAY --(crowd hits 0)--> WIPED OUT
  ^                                       |                          |
  |                                       +--(crowd >= 60 at 920 m)--> BURST
  +---------------------- BACK TO MENU ---+--------------------------+
                                     RUN AGAIN (one tap) ---------> PLAY
```

Two rules decide everything: **the gates do arithmetic to your crowd**, and
**every hazard costs members, not lives.** The run ends only at 0.

---

## 2. Numbers (all constants live at the top of the inline script)

### Space and camera
| constant | value | meaning |
|---|---|---|
| `TRACK_HW` | 3.5 | track half-width in world units |
| `LANE_MAX` | 1.95 | how far off centre the crowd can be steered |
| `STEER_SPEED` | 4.4 | units / second of held-key steering |
| `LEAD` | 60 | how far ahead the spawner keeps the road populated |
| `DRAW_DIST` | 70 | far clip, in metres |
| `NEAR` | 1.1 | near clip, in metres |
| `VP_Y` | 0.375 | vanishing point, as a fraction of height |
| `CAM_Y` | 2.95 | camera height above the road |
| `CAM_BACK` | 11 | camera sits this far behind the crowd |

The whole 3D is one function:

```js
proj(z, x, y) -> { x: W*.5 + x*s , y: vpY() + (CAM_Y-y)*s , s: FX/zr }
           zr = max(NEAR, z - (dist - CAM_BACK)) ,  FX = max(320, H*1.05)
```

### Movement and ramp
| constant | value | meaning |
|---|---|---|
| `SPEED0` | 12.5 | units/s at distance 0 |
| `SPEED1` | 24 | units/s at/after `SPEED_RAMP` |
| `SPEED_RAMP` | 920 | distance over which the ramp completes (= `BOSS_Z`) |
| `MENU_SPEED` | 8 | the idle scroll behind the menu |

`diffc() = clamp(dist / SPEED_RAMP, 0, 1)` drives **everything**: speed,
gate spacing, hazard spacing, and how nasty the gate arithmetic is.

### The crowd
| constant | value | meaning |
|---|---|---|
| `CROWD0` | 8 | the crowd you start every run with |
| `CROWD_MAX` | 999 | hard cap |
| `VISIBLE_CROWD` | 56 | reusable character slots — the pool never reallocates |
| `CLUMP_K` | 0.44 | clump tightness (radius law below) |

`clumpR(n) = min(4.3, 0.42*sqrt(n) + 0.42)` — the clump grows with the square
root of the count, so **a crowd of 200 is a blob, not a screen-filler.** The 56
visible members occupy a golden-angle spiral (`slotOf`, 2.399963 rad) inside that
radius, so the pack looks organic at every size while the *number* keeps growing.

### Gates
| constant | value | meaning |
|---|---|---|
| `GATE_HW` | 3.15 | half-width of the whole gate (two panels) |
| `GATE_H` | 4.3 | panel height |
| `POST_HALF` | 0.42 | half-width of the centre post you must not clip |
| `POST_LOSS` | **3** | members lost for clipping the post |
| `GATE_EVERY0` → `GATE_EVERY1` | 32 → 19 | metres between gates |

| op | symbol | effect |
|---|---|---|
| `mul` | `×N` | `floor(n * N)` — **grow** |
| `add` | `+N` | `n + N` — **grow** |
| `div` | `÷N` | `floor(n / N)` — **shrink** |
| `sub` | `−N` | `max(0, n - N)` — **shrink** |

Grow panels paint **green** (`#22c98a`), shrink panels paint **coral**
(`#ff5a5f`), and the two halves of the road are tinted to match, so the choice is
legible a full 70 m out — before the numbers resolve.

### Hazards
| kind | geometry | members lost |
|---|---|---|
| **rotating bar** | a spinning roller `±1.5` wide, `1.42` high, on two posts | `BAR_LOSS = 6` |
| **swinging mace** | a ball on a chain arcing `±1.3` around a pivot | `MACE_LOSS = 5` |

Both carry a red ground band so the danger reads before the art resolves, both
are one-shot (`e.done`), and both grant `HIT_CD = 0.7 s` of i-frames, so
overlapping geometry can never chain-kill you.

### The boss gate
| constant | value | meaning |
|---|---|---|
| `BOSS_Z` | 920 | how far down the road it stands |
| `BOSS_HP` | **60** | the crowd you must carry to burst it |

Reaching the boss with `crowd >= 60` bursts it; below that it holds and the run
ends with reason `boss`. Spawns stop at `BOSS_Z - 26` (gates) / `BOSS_Z - 16`
(hazards) so the last stretch is a clean run-up.

**Score** = `floor(dist) + 3 * peak + (win ? burstBonus : 0)` where
`burstBonus = crowd * 8` at the moment of the burst. So a big crowd burst
genuinely outscores a safe crawl.

### Difficulty ramp — the same `diffc()` again
| | at 0 m | at 920 m |
|---|---|---|
| speed | 12.5 | 24 |
| metres between gates | 32 | 19 |
| metres between hazards | 44 | 23 |
| chance a gate pair is *harsh* | 14 % | **58 %** |
| typical `+N` / `×` value | 4–13 | 13 |
| typical `−N` / `÷` value | 9–36 | 36 |

A **harsh** pair is the one that contains a `÷` or a `−`. At the start nearly
every gate is a pure gift (`×2` vs a small `+N`); by the boss, more than half
of them are a genuine decision between the lesser evil (`×2` vs `÷2`,
`÷3` vs `−34`). The ramp never removes the good option — it makes you *work*
for it.

---

## 3. Feel

- **Grow.** New members **pop in** at the gate itself (`gainCrowd` with
  `spawnZ/spawnX`) and spring outward into their slot: `easeBack` overshoot on
  scale with a 0.55 squash on spawn, one synth blip per member whose pitch walks
  up the scale (`pop(i, n)`), a green shock-ring, a confetti burst, and a fat
  stroked popup: **`×2 → 16`**.
- **Shrink.** Members are *knocked out*, not deleted: each becomes a tumbling
  body in `fly` with spin, drag and gravity (~90 max), plus a coral ring, a puff,
  and a descending `÷3 → 7` popup.
- **The centre post.** A metallic **CLANG** (`hiss` 2.8 kHz → 700 Hz over a
  150 Hz square), a hard screen shake, and a `CLANG −3` floater. It is the only
  way to lose members without being hit.
- **Churn.** Footsteps are a continuous noise tick (`AU.step`) whose rate
  interpolates `STEP_BASE 0.40 s → STEP_FAST 0.16 s` with speed, and a *second*,
  brighter tick fires whenever the crowd is over 16 — the **tsk-tsk** of many
  feet. Dust puffs are kicked from two live members every step.
- **Murmur.** A looping low-passed noise bed whose gain and cutoff track the
  crowd count (`0.004 + 0.05 * n/90`, `320 → 600 Hz`). A bigger crowd is a
  physically bigger sound; it is the one audio layer that changes *size* rather
  than pitch.
- **Hazard hit.** A red flash, a 1.0 shake, a metallic crunch whose pitch drops
  as the crowd shrinks, `−6` floating off, and bodies cartwheeling off screen.
- **The burst.** `state.flash = 1`, `state.shake = 1.4`, a screen-wide white
  flash, confetti scaled by `crowd/60` (up to ~150 pieces), 26 track chunks,
  two shock rings, a `BURST! +640` popup, and a five-note fanfare over a sub
  drop and a 1.2 s roar. **More crowd = visibly bigger burst.**
- **The hold.** The boss swallows you: a red flash, 30 puffs, a `THE GATE HELD`
  popup, and a falling four-note sting.

### Audio
`AU` is pure WebAudio: oscillators plus **one** procedurally generated 0.7 s
white-noise buffer. **Zero asset files.** The context is created and `resume()`d
from a real user gesture, and the mute flag persists to `cc_snd`. Crowd size
modulates pitch (`pop`), layer count (`step`), and the murmur bed's gain and
cutoff — there is no sample anywhere.

---

## 4. Controls

| action | touch | keyboard |
|---|---|---|
| **steer** | drag anywhere | `←` `→` / `A` `D` |
| pause | — | `Esc` / `P` |
| mute | the SOUND cell | `M` |
| start / restart | tap anywhere, or START THE RUN / RUN AGAIN | `Space` / `Enter` |

Auto-pause fires on `document.visibilitychange` while hidden, and will not
un-pause by itself when you come back — a tab switch never costs you a run.

---

## 5. Verify

Three gates, all must pass.

```
python tools/check.py          # static
python tools/playtest.py       # Playwright, port 8153, writes proof/*.png
python tools/offline_check.py  # file:// boot
```

- **`check.py`** — DOCTYPE/`</html>`, exactly one inline `<script>`, no fenced
  markdown, `node --check` on the extracted script, `{`/`}` balance, the
  **offline scan must report 0 `http(s)://` URLs**, the `data:` favicon, the
  `cc_rec` / `cc_snd` keys, the `window.__crowd_debug` hook, every gameplay
  constant and every debug method.
- **`playtest.py`** — real Canvas 2D Chromium: boot + menu copy, rAF liveness,
  the crowd starts above zero, **`×2` doubles**, `+7` adds, `−12` subtracts,
  `÷3` divides, either half is pickable, the centre post costs exactly 3 and is
  not counted as a gate win, a bar costs 6, a mace costs 5, steering wide dodges
  untouched, a crowd of 4 against a bar reaches 0 and ends the run with reason
  `wiped`, the boss gate spawns and a crowd of 80 bursts it for `80*8 = 640`
  bonus, a crowd of 10 is met with "the gate held", records land in `cc_rec`,
  RUN AGAIN restarts clean, speed ramps 12.5 → 24, real `ArrowLeft`/`ArrowRight`
  steering, `Esc` pause + resume, tab-hide auto-pause, a **canvas pixel census**
  (sky / grass / track / cream / **and both gate panel colours, measured against
  a gate-free frame**) so a silently dead render chain cannot pass, the portrait
  1080×1920 crop, `cc_snd`, zero external requests and zero console errors.
  It writes `proof/*.png`.
- **`offline_check.py`** — loads `index.html` over `file://` with no server,
  asserts zero console errors, the hook, the menu, a drivable run, and that every
  request is `file:`.

### Determinism

The playtest never rolls dice. `debug.freeze(true)` stops the rAF simulation;
`debug.advance(sec)` runs fixed 1/60 s steps with `force` and then renders, so
the world moves exactly as far as the test asks. `debug.runThroughGate(side, op,
value)` stages, aims and crosses a single known gate; `debug.spawnGateAt`,
`forceObstacle`, `setCrowd`, `setLane`, `setDist`, `setSpeed`, `setSpawner(false)`
and `clearTrack()` stage an exact scene.

### `window.__crowd_debug`

`state()` · `start()` · `menu()` · `wipe()` · `pause()` · `resume()` · `end(r)` ·
`freeze(on)` · `live()` · `setSpawner(on)` · `clearTrack()` · `setDist(d)` ·
`setSpeed(v|null)` · `setCrowd(n)` · `setLane(x)` · `steer(dir)` ·
`spawnGateAt(ahead, left, right)` · `runThroughGate(side, op, value)` ·
`forceObstacle('bar'|'mace', ahead, cx)` · `advance(sec)` · `render()`

`left` / `right` / `op` accept either the friendly form (`'mul'`, `'add'`,
`'div'`, `'sub'`, or the literal `× + ÷ −`) or a packed `'op:value'` string
(`'mul:2'`, `'sub:12'`).

`state()` returns `{phase, paused, frozen, frames, crowd, live, peak, lost, dist,
distExact, speed, score, px, pxT, spawner, gates, dodges, hits, posts, lastGate,
win, reason, boss, hp, bossSpawned, burstBonus, ents:{gates,bars,maces,boss},
parts, fly, floats, rec, snd}`.

---

## 6. Layout contract

- `index.html` — the game
- `serve.js` — static server, `PORT` env or **8153**
- `tools/check.py`, `tools/playtest.py`, `tools/offline_check.py` — the gates
- `docs/SPEC.md` — this file
- `proof/` — screenshots written by the playtest
- `.gitignore`

`localStorage`: `cc_rec` (records: games / best / crowd / dist / bursts),
`cc_snd` (sound on/off).

### Screens

| screen | id | shows |
|---|---|---|
| MENU | `#s-menu` | title **CROWD CLASH**, how to play, the `×2 / +7 / ÷3 / −12` legend, keys, `Best N`, START THE RUN |
| PLAY | `#hud` | the hero **crowd count** at ~2.9 rem with a grow/shrink bump, then Distance / Score / Peak / Best / Sound, plus a bobbing `BOSS 60 · you N` chip in the last 150 m |
| PAUSED | `#s-pause` | the run stats so far, Back to the run / Give up |
| OVER / VICTORY | `#s-over` | the reason pair (`Nobody left` / `Gate burst!`), `★ NEW BEST ★`, full stats, RUN AGAIN / BACK TO MENU |

Everything sits inside `max(6px, env(safe-area-inset-*))` with `clamp()` type, so
the HUD survives a 1080×1920 portrait crop with the road still readable.

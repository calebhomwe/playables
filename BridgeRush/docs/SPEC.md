# BRIDGE RUSH — SPEC

Game 6 of the Playables pack. A single-file, fully offline Canvas 2D
hyper-casual **bridge-builder racer** (genre ref: "Bridge Race" / "Bridge
Builder" runners).

- **Entry point:** `index.html` — the whole game. Exactly ONE inline `<script>`,
  no build step, no asset files.
- **Run it:** `node serve.js` then open `http://localhost:8156/`
  (or `python -m http.server 8156`). Also boots straight from `file://`.
- **Look:** a 2D side-on construction site at dusk. Warm site timber, galvanised
  steel and hi-vis safety yellow on a blueprint sky that lerps dawn → night as
  the finish approaches. Deliberately distinct from the pack's neon power grid
  (`VoltDash`) and pseudo-3D lane runner (`RungRunner`).

---

## 1. The loop

You **auto-run to the right** toward the finish flag. Floating **material**
(bricks/planks) tops up your counter. The deck has **gaps** — the only way
across is to **spend material to lay a bridge segment**. Reach a gap with an
empty wallet and you **fall**; the run ends.

```
MENU  --(tap / Space / START THE BUILD)-->  PLAY  --(fall at a gap)-->  RUN OVER
  ^                                                                        |
  +------------------------ BACK TO MENU ----------------------------------+
                                     RACE AGAIN (one tap) ----------------> PLAY

PLAY  --(reach the finish flag)-->  FINISH  (1st or 2nd vs the rival) --> RACE AGAIN
```

One rule decides everything: **material is both your runway and your life.**
Spend it to make ground; hoard it and you stall at the next gap.

---

## 2. Numbers (all constants live at the top of the inline script)

### Movement
| constant | value | meaning |
|---|---|---|
| `SPEED0` | 10 | world units / second at distance 0 |
| `SPEED1` | 22 | world units / second at/after `SPEED_RAMP` |
| `SPEED_RAMP` | 520 | distance over which the speed ramp completes |
| `MENU_SPEED` | 6 | idle scroll speed behind the menu |
| `FINISH_DIST` | 620 | length of the race |
| `AHEAD` | 62 | how far ahead the spawner keeps the deck populated |
| `GRAVITY` | 70 | units / s² |
| `HOP_V` | 16 | take-off velocity → apex **1.83 units**, airtime **0.457 s** |
| `HALF_W` | 0.34 | player half-width |
| `STAND_H` | 1.15 | collision height |

The runner's body is drawn ~1.3 units tall but collides as 1.15 — the art is
deliberately more generous than the hitbox.

### Material — the whole game
| constant | value | meaning |
|---|---|---|
| `MAT_START` | 4 | material in hand at the whistle |
| `MAT_MAX` | 99 | counter ceiling |
| `MAT_GAIN` | +1 | material per pickup |
| `SEG_W` | 2.2 | world length of one laid bridge segment |
| `SEG_COST` | 1 | material spent per segment |
| `LAY_TIME` | 0.16 | seconds between **auto**-build segments |
| `LAY_CD` | 0.07 | seconds between **held**-build segments (faster) |
| `TEETER` | 0.55 | how long you wobble at a dry edge before falling |

**Rule choice (documented):** material is spent one `SEG_COST` per `SEG_W` of
gap. A held build (`LAY_CD`) is more than twice as fast as the autopilot
(`LAY_TIME`), so a player who *commits* to a wide gap crosses it sooner and
keeps more of the wallet for the next one. Reach a gap dry and you **teeter for
0.55 s** — a readable beat that gives you a last chance to hop clear — before
you drop.

### Difficulty ramp — all driven by one variable, `prog() = dist / FINISH_DIST`
| | start | at the finish |
|---|---|---|
| speed | 10 | 22 |
| gap width (`gapSegsNow`, segments) | 3 | 6 |
| clear ground between gaps (`groundNow`) | 17 | 11 |
| material placed per inter-gap stretch | `segs + 1` | `segs` |
| cone tax (`coneCost`) | 1 | 3 |
| chance of a cone in a stretch | 14 % | 62 % |

Because `gapSegsNow` grows to **6** while late stretches only place `segs`
income, and each missed cone taxes up to **3**, **careless runs run out of
material and fall.** Skilled play (hopping cones, holding build) pushes the
fall further out; it never removes it.

### Legs — one visual ramp, five skies
`LEG_NAMES = ['Groundworks','Pier Run','Truss Span','High Steel','Sky Bridge']`,
indexed by `floor(prog()*5)`. Sky, haze, far skyline, near scaffolding and deck
colour all lerp continuously between five palettes, so the world visibly
travels somewhere.

### Obstacles
| kind | geometry | clear it by |
|---|---|---|
| **site cone** | `y 0 → 0.95`, half-width `0.42` | **hop** (apex 1.83) |

A cone you fail to clear taxes `coneCost()` material (1–3) and stumbles you
(`0.6 s` at 55 % speed). It does **not** end the run — only a dry gap does.

### Score
`score = floor(dist) + (place === 1 ? 500 : place === 2 ? 200 : 0)`.
Cross the flag first and the placement bonus dominates the distance term.

---

## 3. Feel

- **Plank snap + hammer tap.** Each segment laid fires a bandpassed noise snap
  plus a square/triangle pair; pitch climbs with the running segment count. A
  hammer-swing overlay reads on the runner while building.
- **Material pop.** A lime→hi-vis shock-ring, 9 sparks, a rising `+1` floater
  and a synth pop whose pitch climbs with your collected combo.
- **Cone tax.** Orange sparks + a paper flash, a `-N material` floater, a heavy
  `stumble` and a 0.7 shake.
- **Fall.** A wood-dust burst at the dropped edge, a descending noise sweep and
  a sagging sawtooth — the "the gap wins" read.
- **Finish.** Confetti (26 pieces in hi-vis/orange), three shock-rings, a rising
  fanfare arpeggio and a roar.
- **Rival.** A rubber-banded ghost builder on a parallel elevated span, taunting
  (`catch up!` / `too slow!`) when ahead; speed-lines whiten the frame when
  *you* lead (`state.aheadT`).
- **Ambience.** A half-pixel scan pass at low alpha, a radial vignette, tower
  cranes and scaffold silhouettes in the haze, and a starfield that fades in as
  the sky darkens toward the flag.

### Audio
`AU` is pure WebAudio: oscillators plus one procedurally generated 0.5 s white
noise buffer. **Zero asset files.** The context is created (and `resume()`d)
from a real user gesture, and the mute state persists to `br_snd`.

---

## 4. Controls

| action | touch | keyboard |
|---|---|---|
| **hop** | tap | `Space` / `↑` / `W` / `Enter` |
| **build** (lay a segment) | hold / `↓` | hold `↓` / `S` / `J` |
| pause | — | `Esc` / `P` |
| mute | the SOUND pill | `M` |
| start / restart | tap anywhere, or START THE BUILD / RACE AGAIN | `Space` / `Enter` |

Reaching a gap switches the tap from **hop** to **build** automatically. The
autopilot (`autoBuild`) also lays segments on its own at `LAY_TIME`, so a
first-time player never stalls — but the manual hold is ~2.3× faster.

Auto-pause fires on `document.visibilitychange` while hidden, and resumes only
from an explicit action, so a tab switch never costs you a run.

---

## 5. Verify

Three gates, all must pass.

```
python tools/check.py          # static
python tools/playtest.py       # Playwright, port 8156, writes proof/*.png
python tools/offline_check.py  # file:// boot
```

- **`check.py`** — DOCTYPE/`</html>`, exactly one inline `<script>`, no fenced
  markdown, `node --check` on the extracted script, `{`/`}` balance, the
  **offline scan must report 0 `http(s)://` URLs**, the `data:` favicon, the
  `br_rec` / `br_snd` keys, the `window.__bridge_debug` hook, every gameplay
  constant and every debug method.
- **`playtest.py`** — real Canvas 2D Chromium, **32 assertions**: boot + menu
  copy, `start()`, a real `Space` start, the runner advancing on open deck,
  collecting material, laying a segment (spends material **and** extends the
  path over a forced gap), walking onto the new span, running dry over a gap
  (→ run over, reason `fall`), records in `br_rec`, `Esc` pause + resume,
  tab-hide auto-pause, a progressing rival, restart, a **canvas pixel census**
  (non-blank + colour variety) so a silently dead render chain cannot pass, the
  portrait crop, zero external requests and zero console errors. It writes
  `proof/*.png`.
- **`offline_check.py`** — loads `index.html` over `file://` with no server,
  asserts zero console errors, the hook, the menu, a drivable deterministic run
  and that every request is `file:`.

### Determinism

The playtest never rolls dice. `debug.freeze(true)` stops the rAF simulation;
`debug.advance(sec)` runs fixed 1/60 s steps with `force` and then renders, so
the world moves exactly as far as the test asks. `debug.spawnMaterialAt`,
`forceGap`, `layBridge`, `setMaterial`, `setRivalX`, `setSpawner(false)` and
`clearTrack()` let a test stage an exact scene.

### `window.__bridge_debug`

`state()` · `start()` · `menu()` · `wipe()` · `pause()` · `resume()` · `end()` ·
`finish()` · `freeze(on)` · `live()` · `setSpawner(on)` · `autoBuild(on)` ·
`clearTrack()` · `resetTrack()` · `setDist(d)` · `setMaterial(v)` ·
`setSpeed(v|null)` · `spawnMaterialAt(ahead,y)` · `forceGap(ahead,segs)` ·
`layBridge()` · `setRivalX(x)` · `setRival(ahead)` · `hop()` · `build(on)` ·
`advance(sec)`

`state()` returns `{phase, paused, frozen, frames, score, dist, distExact,
speed, base, material, matCollected, segsLaid, cones, hits, missed,
gapsCrossed, grounded, air, py, teeter, building, autoBuild, blocked, finished,
place, reason, leg, legName, rival:{dist,speed,finishT,rlad}, gap, gaps, mats,
conesN, rec, snd}`.

---

## 6. Layout contract

- `index.html` — the game
- `serve.js` — static server, `PORT` env or **8156**
- `tools/check.py`, `tools/playtest.py`, `tools/offline_check.py` — the gates
- `docs/SPEC.md` — this file
- `proof/` — screenshots written by the playtest
- `.gitignore`

`localStorage`: `br_rec` (records: games / best / bestDist / material / segs /
finishes / wins / dist), `br_snd` (sound on/off).

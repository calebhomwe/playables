# VOLT DASH — specification

Game 2 of the Playables pack. A single-file, fully offline Canvas 2D
hyper-casual **energy-runner** (genre ref: "Battery Run").

- **Entry point:** `index.html` — the whole game. Exactly ONE inline `<script>`,
  no build step, no asset files.
- **Run it:** `node serve.js` then open `http://localhost:8152/`
  (or `python -m http.server 8152`). Also boots straight from `file://`.
- **Look:** a 2D side-scrolling neon power grid. Deliberately distinct from
  Game 1 (`RungRunner`, pseudo-3D lane-runner): this one is a flat, high-contrast
  side view with parallax silhouette layers, a lit conductor rail grid, and an
  electric "arc" palette.

---

## 1. The loop

You auto-run to the right forever. Your **battery cell is always draining**.
Battery cells floating over the track top you up. You decide, every second,
whether to spend charge to go faster or hoard it to stay alive.

```
MENU  --(tap / Space / PLUG IN)-->  PLAY  --(energy hits 0)-->  BROWNOUT
  ^                                                                  |
  +----------------------- BACK TO MENU -----------------------------+
                                     RUN AGAIN (one tap) ----------> PLAY
```

One rule decides everything: **energy is both your health bar and your ammo.**

---

## 2. Numbers (all constants live at the top of the inline script)

### Movement
| constant | value | meaning |
|---|---|---|
| `SPEED0` | 11 | world units / second at distance 0 |
| `SPEED1` | 24 | world units / second at/after `SPEED_RAMP` |
| `SPEED_RAMP` | 900 | distance over which the ramp completes |
| `MENU_SPEED` | 7 | the idle scroll speed behind the menu |
| `GRAVITY` | 74 | units / s² |
| `HOP_V` | 17.2 | take-off velocity → apex **2.00 units**, airtime **0.465 s** |
| `SLIDE_TIME` | 0.75 | maximum slide duration |
| `SLIDE_LOCK` | 0.22 | cooldown before you can slide again |
| `SLIDE_H` / `STAND_H` | 0.55 / 1.15 | collision heights |
| `HALF_W` | 0.34 | player half-width |
| `LEAD` | 15 | how far ahead the spawner keeps the track populated |

The runner's body is drawn ~1.43 units tall but collides as 1.15 — the art is
deliberately more generous than the hitbox.

### Energy — the whole game
| constant | value | meaning |
|---|---|---|
| `ENERGY_MAX` | 100 | full cell |
| `DRAIN0` → `DRAIN1` | 4.0 → 15.0 /s | drain rate, lerped by the same distance ramp |
| `CELL_GAIN` | +12 | energy per battery cell |
| `CELL_PICK` | 0.62 | vertical pickup radius |
| `CELL_HALF` | 0.62 | horizontal pickup radius |
| `HIT_COST` | **26** | energy lost per obstacle you fail to clear |
| `DAMAGE_CD` | 0.95 | seconds of i-frames after a hit |
| `DASH_COST` | **22** | energy spent on a dash |
| `DASH_TIME` | **0.7** | seconds the burst lasts |
| `DASH_MULT` | **1.85** | speed multiplier during the burst |

**Rule choice (documented):** hitting an obstacle **costs 26 energy**, it does
not instantly end the run. The run only ends at **0 energy**. So a mistake is
survivable but expensive, a `26 / 12` cost means one hit erases more than two
cells of income, and the tension stays on the drain rather than on one-shot
death. `DAMAGE_CD` of 0.95 s also makes a single collision cost at most one
hit — you cannot be chain-killed by overlapping geometry.

Because `DRAIN1` (15/s) is faster than the best possible cell income
(`12 / CELL_EVERY1 = 12 / 0.86 ≈ 13.95/s`), **every run terminates**. Skilled
play pushes the blackout further out; it never removes it.

### Difficulty ramp — all driven by one variable, `diffc() = dist / SPEED_RAMP`
| | start | at 900+ distance |
|---|---|---|
| speed | 11 | 24 |
| drain | 4.0 /s | 15.0 /s |
| seconds between cells (`CELL_EVERY`) | 1.10 | 0.86 |
| seconds between obstacles (`OBS_EVERY`) | 2.30 | 1.05 |

As the world speeds up, the *time* between pickups tightens and the *distance*
between them grows — so the game gets harder in the way that matters (less
reaction time) without ever becoming a wall of pickups.

### Sectors — one visual ramp, five skies
`SECTOR_DIST = 220`. `['Neon Yard', 'Coil Field', 'Arc Basin', 'Grid Core',
'Voltage Void']` — sky, haze, skyline silhouette, floor, conductor and accent
colour all lerp continuously between the five palettes, so the world visibly
travels somewhere.

### Obstacles
| kind | geometry | clear it by |
|---|---|---|
| **zapper spike** | `y 0 → 0.95`, half-width `0.42` | **hop** (apex 2.00) |
| **hanging conduit** | `y 0.72 → 2.35`, half-width `0.50` | **slide** (`0.55` < `0.72`) |

Both are one-shot per entity (`e.done`) and grant `DAMAGE_CD` i-frames on hit.

---

## 3. Feel

- **Trail.** The runner leaves an additive cyan wake at body height (amber while
  sliding) that bends with the hop arc — recorded from the body centre, not the
  feet, or it would be drawn straight over by the floor.
- **Cell pickup.** A lime shock-ring + a cyan counter-ring, 11 sparks, a rising
  `+12 volts` floater, and a synth pop whose pitch climbs with your combo
  (`520 Hz * 2^(n/13)`, plus 2x and 3x partials and a bright noise chirp).
- **Damage.** Arc-coil sparks in magenta + paper, two rings, a 1.0 screen shake,
  a white flash, a `-26 volts` floater, and a **descending static crackle**: one
  bandpassed noise sweep from 3.4 kHz → 240 Hz plus seven staggered noise grains
  walking down from 4.2 kHz, over a sagging sawtooth. It *sounds* like a short.
- **Dash.** Speed lines, a three-pass chromatic split (magenta trailing → lime →
  cyan leading) on the runner, a cyan shock-ring and 18 sparks, a `DASH`
  floater, and a bass whoosh (78 Hz → 3.2x sine + rising saw + a 240 Hz → 4.8 kHz
  noise sweep).
- **Ambience.** A half-pixel CRT scan pass at low alpha (never bands), a radial
  vignette, blinking skyline beacons, and a pulsing warning light on every pylon.
- **Danger.** Under 25 energy the beacon on the runner's pack drops to magenta, a
  magenta aura pulses around the body, and a 196 Hz low-voltage tick sounds every
  0.5 s.
- **Squash.** `state.sq` squashes on take-off and landing and eases back — the
  hop has weight.

### Audio
`AU` is pure WebAudio: oscillators plus one procedurally generated 0.5 s white
noise buffer. **Zero asset files.** The context is created (and `resume()`d)
from a real user gesture, and the mute state persists to `vd_snd`.

---

## 4. Controls

| action | touch | keyboard |
|---|---|---|
| **hop** | tap | `Space` / `↑` / `W` / `Enter` |
| **slide** | hold or swipe down | `↓` / `S` |
| **dash** | swipe right | `Shift` / `X` |
| pause | — | `Esc` / `P` |
| mute | the SOUND pill | `M` |
| start / restart | tap anywhere, or PLUG IN / RUN AGAIN | `Space` / `Enter` |

Auto-pause fires on `document.visibilitychange` while hidden, and resumes only
from an explicit action, so a tab switch never costs you a run.

---

## 5. Verify

Three gates, all must pass.

```
python tools/check.py          # static
python tools/playtest.py       # Playwright, port 8152, writes proof/*.png
python tools/offline_check.py  # file:// boot
```

- **`check.py`** — DOCTYPE/`</html>`, exactly one inline `<script>`, no fenced
  markdown, `node --check` on the extracted script, `{`/`}` balance, the
  **offline scan must report 0 `http(s)://` URLs**, the `data:` favicon, the
  `vd_rec` / `vd_snd` keys, the `window.__volt_debug` hook, every gameplay
  constant and every debug method.
- **`playtest.py`** — real Canvas 2D Chromium, 51 assertions: boot + menu copy,
  rAF liveness, hop-over-spike costs nothing, a missed spike costs 26, a slide
  ducks the conduit while standing under it does not, a cell refills the bar and
  scores, a high cell is missed, DASH spends 22 and multiplies speed by 1.85 and
  grants i-frames and is refused below 22, the ramp and the sector climb, a real
  `Space` hop, `Esc` pause + resume, tab-hide auto-pause, the drain to blackout,
  records in `vd_rec`, restart, a **canvas pixel census** (lime / cyan / magenta /
  dark / non-blank) so a silently dead render chain cannot pass, the portrait
  crop, `vd_snd`, zero external requests and zero console errors. It writes
  `proof/*.png`.
- **`offline_check.py`** — loads `index.html` over `file://` with no server,
  asserts zero console errors, the hook, the menu, a drivable run, and that every
  request is `file:`.

### Determinism

The playtest never rolls dice. `debug.freeze(true)` stops the rAF simulation;
`debug.advance(sec)` runs fixed 1/60 s steps with `force` and then renders, so
the world moves exactly as far as the test asks. `debug.spawnCellAt`,
`forceObstacle`, `setEnergy`, `setSpeed`, `setDist`, `setSpawner(false)` and
`clearTrack()` let a test stage an exact scene.

### `window.__volt_debug`

`state()` · `start()` · `menu()` · `wipe()` · `pause()` · `resume()` · `end()` ·
`freeze(on)` · `live()` · `setSpawner(on)` · `clearTrack()` · `setDist(d)` ·
`setSpeed(v|null)` · `setEnergy(v)` · `spawnCellAt(ahead, y)` ·
`forceObstacle('spike'|'beam', ahead)` · `hop()` · `slide(on)` · `dash()` ·
`advance(sec)`

`state()` returns `{phase, paused, frozen, frames, score, dist, distExact,
speed, base, energy, cells, collected, missed, hits, cleared, dashes, dashT,
dashing, grounded, air, py, sliding, slideT, invuln, hitCd, sector, sectorName,
ents, rec, snd}`.

---

## 6. Layout contract

- `index.html` — the game
- `serve.js` — static server, `PORT` env or **8152**
- `tools/check.py`, `tools/playtest.py`, `tools/offline_check.py` — the gates
- `docs/SPEC.md` — this file
- `proof/` — screenshots written by the playtest
- `.gitignore`

`localStorage`: `vd_rec` (records: games / best / cells / dist / dashes / hits),
`vd_snd` (sound on/off).

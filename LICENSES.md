# Third-party assets and code

The four 3D games (Helix Drop, Crowd Clash, Rung Runner, Bridge Rush) share one 3D layer in
`lib3d/`. Everything in it is either MIT (the engine) or CC0 (the models). No asset is loaded
from the network at run time.

## Engine

| What | Where | Licence | Source |
| --- | --- | --- | --- |
| three.js r180 (module build, GLTFLoader, BufferGeometryUtils) | `lib3d/three/` | MIT (`lib3d/three/LICENSE`) | https://github.com/mrdoob/three.js (npm `three@0.180.0`) |
| p3d.js (toon ramp, rim light, outlines, sky, instanced crowds) | `lib3d/p3d.js` | this repo | written for this pack |

## Models (all CC0 1.0, Kenney, www.kenney.nl)

Every model was run through `arcade/tools/blender/optimize_glb.py` (Blender 4.2: joined,
welded, pivot at the bottom centre, textures capped at 512 px). The characters were first
posed in Blender from Kenney's own animation clips and saved as one static mesh per frame
(`<name>_<clip>_<frame>.glb`); the game swaps frames to animate them.

| File(s) in `lib3d/models/` | Kenney pack | Original model | Triangles | Used by |
| --- | --- | --- | --- | --- |
| `crowdA_sprint_0..7`, `crowdA_fall_0` | Mini Characters 1.0 | character-male-f (sprint, fall) | 692 | Crowd Clash (crowd) |
| `crowdB_sprint_0..7`, `crowdB_fall_0` | Mini Characters 1.0 | character-female-b (sprint, fall) | 744 | Crowd Clash (crowd) |
| `leader_sprint_0..7` | Mini Characters 1.0 | character-male-c (sprint) | 795 | Crowd Clash (flag-bearer) |
| `climber_sprint_0..9`, `climber_fall_0`, `climber_jump_0` | Mini Characters 1.0 | character-female-f | 790 | Rung Runner |
| `builder_sprint_0..9`, `builder_idle_0`, `builder_jump_0`, `builder_fall_0` | Mini Characters 1.0 | character-male-e | 688 | Bridge Rush (you) |
| `rival_sprint_0..9`, `rival_idle_0`, `rival_jump_0` | Mini Characters 1.0 | character-male-b | 692 | Bridge Rush (rival) |
| `coin-gold` | Platformer Kit 4.1 | coin-gold | 124 | Helix Drop |
| `flag` | Platformer Kit 4.1 | flag | 110 | Crowd Clash, Bridge Rush |
| `spike-block`, `brick`, `barrel`, `fence-straight`, `flowers` | Platformer Kit 4.1 | same names | 116 / 188 / 148 / 48 / 264 | Crowd Clash |
| `tree`, `tree-pine`, `rocks` | Platformer Kit 4.1 | same names | 408 / 204 / 100 | Crowd Clash, Rung Runner, Bridge Rush |
| `ladder`, `saw` | Platformer Kit 4.1 | same names | 56 / 128 | Rung Runner |
| `block-grass-large` | Platformer Kit 4.1 | same name | 92 | Rung Runner, Bridge Rush |
| `platform` | Platformer Kit 4.1 | platform | 84 | Bridge Rush (planks) |
| `cone` | Car Kit 3.1 | cone | 172 | Bridge Rush |

Kenney's licence text (all three packs): "License: (Creative Commons Zero, CC0)
http://creativecommons.org/publicdomain/zero/1.0/ — You may use these assets in personal
and commercial projects. Credit (Kenney or www.kenney.nl) would be nice but is not mandatory."

## Snake Clash: textures and fonts (added by the puzzle-and-board upgrade)

Snake Clash draws its arena, wall and paper panels from real material photographs, and its
menus use two self-hosted fonts. Nothing is loaded from the network at run time.

| File(s) | Source | Licence |
| --- | --- | --- |
| `SnakeClash/assets/tex/grass.jpg` `ground.jpg` `stones.jpg` `rock.jpg` `snow.jpg` `paper.jpg` `oak.jpg` `walnut.jpg` `leather.jpg` | ambientCG (https://ambientcg.com), downsized to 512 px JPEG. See `SnakeClash/assets/tex/LICENSE.txt` for the asset id of each | CC0 1.0 |
| `SnakeClash/assets/fonts/fredoka.woff2`, `nunito.woff2` | Google Fonts, Latin subsets (Fredoka, Nunito) | SIL Open Font License 1.1 |
| `SnakeClash/pz.js` | the shared progression kit (XP levels, daily goals, weekly stamps, result card). A copy of `arcade-hub/games/kit/pz.js` | this repo |

## Everything else

Textures on the tracks, roads, water, gate panels and signs are drawn at run time with
canvas 2D by the games themselves. Sounds are the games' own WebAudio synths plus each game's
`audio/bed.mp3` (unchanged by the 3D rebuild).

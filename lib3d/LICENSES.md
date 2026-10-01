# lib3d: third-party parts added by the "warm" look pass

| What | Where | Licence | Source |
| --- | --- | --- | --- |
| `tex/grass.jpg` (Grass001), `tex/paving.jpg` (PavingStones070), `tex/asphalt.jpg` (Asphalt 026 C), `tex/wood.jpg` (Wood066), all downscaled to 512 px | `tex/` | CC0 1.0 | ambientCG, https://ambientcg.com |
| Fraunces 800 (latin), logo type | `fonts/fraunces800.woff2` | SIL Open Font License 1.1 | https://fonts.google.com/specimen/Fraunces |
| Nunito (variable, latin), UI type | `fonts/nunito.woff2` | SIL Open Font License 1.1 | https://fonts.google.com/specimen/Nunito |
| `gk.css`, `gk.js` (Game Kit: glass buttons, wood and parchment panels, icons, progression) | this folder | this repo | copies of `arcade-hub/games/kit3d/` |
| `p3d.js` | this folder | this repo | shared three.js helpers (the `warm` look is opt-in per game) |

three.js r180 is vendored in `three/` (MIT). Models are in `models/` (see `../LICENSES.md`).
Wood and parchment grain in the UI are SVG turbulence filters in `gk.css`, not image files. Nothing is loaded from the network at run time.

# Mobile offline package support

This repository participates in Caleb's Arcade's explicit offline downloads. The root worker and generated local-file inventory contain the games in `offline-games.json`. Gameplay URLs and save keys are preserved. Game-page changes only redirect the shared arcade SDK to its byte-identical local snapshot, with its sound kit under `assets/offline-sdk/`.

Run `python3 tools/build-mobile-offline.py` after changing any game, module, texture or sound, then `python3 tools/build-mobile-offline.py --check`, `node tools/check-mobile-offline.cjs` and `node --test qa/offline/worker.test.cjs`. Browser CI installs pinned Playwright from `qa/offline/package-lock.json` and runs `NODE_PATH=./qa/offline/node_modules node tools/test-mobile-offline.cjs` in Chromium/Android and WebKit/iPhone profiles. Outputs are under `qa/offline-results/`. The browser check establishes cold offline boot and input smoke only; review screenshots and test real devices for actual gameplay quality.

Deploy this repository before the coordinated arcade portal change. Open the portal's Offline games page, install it from Safari on iPhone or Chrome on Android, download a game and wait for Ready offline. Standalone cold airplane-mode launch and saves after restart still require physical-device verification.

The worker validates hashes and byte sizes, supports Safari audio range requests, shares immutable assets between games, commits readiness only after the complete package is present, and leaves saves and other applications' caches untouched. A waiting update is applied by the player's Update downloads button after finishing open games. Original game behavior is retained; no new phone certification is claimed.

The canonical SDK and sounds came from calebhomwe/arcade commit d31da602991da4bc09ff63eb409a2de005ff4b93. Keep this snapshot in sync deliberately. The portal PR's docs/MOBILE_OFFLINE.md contains the complete rollout and verification record. At implementation time local browser QA was blocked by unavailable managed preview infrastructure. No physical device or browser-engine pass is claimed from unit/package tests.

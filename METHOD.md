# Method

Why 2dbench measures the way it does. Each rule exists because of a specific way renderer benchmarks go wrong.

## Same work, by construction

Scenes (`src/scenes.ts`) own a seeded simulation and write structure-of-arrays state each frame: `x`, `y`, `scale`, `rotation`, `color` (0xRRGGBBAA) and `texture`. Adapters only turn that state into draw calls. So:

- Simulation cost is identical for everyone, and it's included in the frame time, as in a real game.
- "Dynamic" scenes really are dynamic. Scale changes every 4 frames, alpha every 2, tint every 8 and rotation every frame, so no library can win by caching values that never change (an early version of this benchmark had that flaw).
- Adapters set only the properties a scene uses. A bulk API that can mark properties static is configured to match what the scene actually changes.

## Same output: the parity gate

Before timing, each adapter draws the same seeded frame (10 steps in, at 2,000 and at 50,000 sprites), and its pixels are compared with the reference's (`webgl2-baseline`, hand-written, so no library referees itself).

- **Coverage:** the adapter's drawn area divided by the reference's. Skipped, culled or missing sprites show here. The run fails outside 99.5–100.5%.
- **Interior differences:** pixels that differ (any channel by more than 8 levels) where the 3×3 neighbourhood is a single flat colour in both frames. Any edge, even a sprite drawn over another sprite, breaks flatness, so different rounding rules for rotated edges don't count. A wrong tint, alpha, blend or texture inside a sprite does. The run fails above 0.5%. This metric was validated by deliberately giving one library a wrong tint: interior differences rose from 0% to 22%.
- **Differing pixels overall** are reported for transparency. Libraries legitimately differ at the edges of rotated sprites (for example PixiJS's `roundPixels` snaps rotated corners). `PARITY_DUMP=1` writes each frame and a diff image to `results/parity/`.

## Honest timing

- Each frame is timed from simulation start to GPU completion. The sync is a 1-pixel `readPixels`, which waits for all submitted GPU work (Canvas 2D uses `createImageBitmap`). Without it, frames look as fast as the CPU can queue them.
- 20 warm-up frames first (JIT, texture upload, buffer growth, and any objects a retained-mode library creates), then 100 measured frames. Reported per count: the median frame, the p95 frame, and the median main-thread time before the sync.
- The canvas is 960×540 at device pixel ratio 1, so every device draws the same number of pixels.

## Noise and ordering

- Several rounds (default 3). Each round starts every adapter on a fresh page, in a rotated order, so thermal throttling and ordering spread evenly.
- Reported: the median across rounds, with min–max. Ratios between libraries within one run are the signal. Absolute times vary between days, even on the same machine.
- **Max at 60 fps** is the largest ladder step (1k, 2k, 5k, 10k, 20k, 50k, 100k, …) measured in every round whose median frame is at most 16.7 ms. Steps are up to 2× apart, so treat it as a lower bound.
- The **published counts** (10k, 50k, 200k) are measured for every adapter in every round, even once a frame exceeds 16.7 ms, so no cell mixes different numbers of rounds.

## Environment

Every result records the GPU (`WEBGL_debug_renderer_info`), browser version, OS, CPU, memory, power source and plan (detected on Windows; give it in `NOTE` elsewhere), library versions, and the 2dbench commit.

## Library setup

Each adapter documents its setup in `setup`, and that text is copied into every result. Choices made for fairness:

- **PixiJS** uses its WebGL renderer: on these scenes it measured faster than PixiJS's WebGPU renderer (2026-10-19, RTX 5060 laptop, Chrome 155). `roundPixels` is on, matching the whole-pixel rule (it made no measurable difference to speed). Antialiasing is off, and the ticker is off; `render()` is called directly.
- The `mixed` scene deliberately uses 4 separate textures rather than an atlas, to measure multi-texture batching. An atlas would help any library that batches per texture. Measured for PixiJS `Sprite`: about 11%, within noise.

## Known limits

- One process and one browser per run. Results from different machines aren't directly comparable; compare ratios.
- Desktop browsers are automated with Playwright. Phones run `mobile.html` by hand, or through a device cloud.
- GPU timing is end-to-end only. There are no GPU timer queries, because `EXT_disjoint_timer_query` is often unavailable.

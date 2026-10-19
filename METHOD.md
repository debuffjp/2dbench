# Method

Why 2dbench measures the way it does. Each rule exists because of a specific way renderer benchmarks go wrong.

## Same work, by construction

Scenes (`src/scenes.ts`) own a seeded simulation and write structure-of-arrays state each frame: `x`, `y`, `scale`, `rotation`, `color` (0xRRGGBBAA) and `texture`. Adapters only turn that state into draw calls. So:

- Simulation cost is identical for everyone, and it's included in the frame time, as in a real game.
- "Dynamic" scenes really are dynamic. Scale changes every 4 frames, alpha every 2, tint every 8 and rotation every frame, so no library can win by caching values that never change (an early version of this benchmark had that flaw).
- Adapters set only the properties a scene uses. A bulk API that can mark properties static is configured to match what the scene actually changes.

## Same output: the parity gate

Before timing, each adapter draws the same seeded frame (10 steps in, at 2,000 and at 50,000 sprites), and its pixels are compared with the reference's: **PixiJS `Sprite`**. It's the most widely used 2D web renderer, it supports every scene, and it isn't made by 2dbench's authors. (An earlier hand-written WebGL2 reference was dropped: it was close to spryte's own design, so it neither referees independently nor adds information as a contestant.)

- **Coverage:** the adapter's drawn area divided by the reference's. Skipped, culled or missing sprites show here. The run fails outside 99.5–100.5%.
- **Interior differences:** pixels that differ (any channel by more than 8 levels) where the 3×3 neighbourhood is a single flat colour in both frames. Any edge, even a sprite drawn over another sprite, breaks flatness, so different rounding rules for rotated edges don't count. A wrong tint, alpha, blend or texture inside a sprite does. The run fails above 0.5%. This metric was validated by deliberately giving one library a wrong tint: interior differences rose from 0% to 22%.
- **Differing pixels overall** are reported for transparency. Libraries legitimately differ at the edges of rotated sprites (for example PixiJS's `roundPixels` snaps rotated corners). `PARITY_DUMP=1` writes each frame and a diff image to `results/parity/`.

## Honest timing

- Each frame is timed from simulation start to GPU completion. The sync is a 1-pixel `readPixels`, which waits for all submitted GPU work (Canvas 2D uses `createImageBitmap`). Without it, frames look as fast as the CPU can queue them.
- 20 warm-up frames first (JIT, texture upload, buffer growth, and any objects a retained-mode library creates), then 100 measured frames. Reported per count: the median frame, the p95 frame, and the median main-thread time before the sync.
- The canvas is 960×540 at device pixel ratio 1, so every device draws the same number of pixels.

## Noise and ordering

- Several rounds (default 5; see Statistics). Each round starts every adapter on a fresh page, in a rotated order, so thermal throttling and ordering spread evenly.
- Reported: the median across rounds, with min–max. Ratios between libraries within one run are the signal. Absolute times vary between days, even on the same machine.
- **Max at 60 fps** is the largest ladder step (1k, 2k, 5k, 10k, 20k, 50k, 100k, …) measured in every round whose median frame is at most 16.7 ms. Steps are up to 2× apart, so treat it as a lower bound.
- The **published counts** (10k, 50k, 200k) are measured for every adapter in every round, even once a frame exceeds 16.7 ms, so no cell mixes different numbers of rounds.

## Environment

Every result records the GPU (`WEBGL_debug_renderer_info`), browser version, OS, CPU, memory, power source and plan (detected on Windows; give it in `NOTE` elsewhere), library versions, and the 2dbench commit.

## Library setup

Each adapter documents its setup in `setup`, and that text is copied into every result. Choices made for fairness:

- **PixiJS** uses its WebGL renderer: on these scenes it measured faster than PixiJS's WebGPU renderer (2026-10-19, RTX 5060 laptop, Chrome 155). `roundPixels` is on, matching the whole-pixel rule (it made no measurable difference to speed). Antialiasing is off, and the ticker is off; `render()` is called directly.
- The `mixed` scene deliberately uses 4 separate textures rather than an atlas, to measure multi-texture batching. An atlas would help any library that batches per texture. Measured for PixiJS `Sprite`: about 11%, within noise.

## Statistics

Choices here come from a variance study: the `bunny` and `particles` scenes, 7 rounds each, on the RTX 5060 laptop (`results/2026-10-19-win32-{bunny,particles}.json`). Reproduce it with `node variance.mjs <results files>`.

**Why medians.** A frame time distribution has a long right tail (GC pauses, OS interrupts). The median of 100 frames ignores the tail, which `p95FrameMs` reports separately. Across rounds, the median of the per-round medians resists a single bad round, such as a background task waking up.

**How noisy rounds are.** At the published counts (10k, 50k, 200k), one round's median frame differs from another's with a coefficient of variation of **9.2% (median cell)**, and up to 35.8%. The noisiest cells are the fastest ones: frames under about 2 ms, where the browser's timer resolution and scheduling jitter are a large share of the frame. At 10k sprites, the bulk APIs (about 0.5–1.5 ms per frame) varied by 24–36%.

**Why 5 rounds, not 3.** Taking every window of 3 consecutive rounds from the 7, the 3-round median missed the 7-round median by **9.8% (median cell), up to 28.6%**. The ratios between libraries, which is what the claims are about, missed by up to 15% at 50k and 200k, and up to 29% at 10k for the bulk APIs. So the default is now 5 rounds, and every result keeps `roundsFrameMs`, so anyone can compute their own intervals.

**How stable the ratios are.** Per-round ratios between libraries stay in a band. Examples at 7 rounds:

| Scene, pair | Count | Ratio (7-round medians) | Range of per-round ratios |
| --- | --- | --- | --- |
| particles, PixiJS `Sprite` / spryte `draw.sprite` | 50k | 3.82× | 3.18–4.07× |
| particles, PixiJS `ParticleContainer` / spryte `draw.sprites` | 200k | 4.74× | 4.03–5.19× |
| bunny, PixiJS `Sprite` / spryte `draw.sprite` | 50k | 2.72× | 2.31–3.24× |
| bunny, PixiJS `ParticleContainer` / spryte `draw.sprites` | 200k | 3.07× | 2.55–3.38× |
| bunny, PixiJS `ParticleContainer` / spryte `draw.sprites` | 10k | 2.33× | 1.00–4.00× (frames under 1 ms: not meaningful) |

**What we publish:** medians with min–max per count, and ratios at counts where frames are 2 ms or more. Cells under 2 ms are flagged `†` in the runner's table. They aren't wrong, but they're low precision.

**Benchmark design moves ratios.** Every frame includes the shared simulation, so a cheaper simulation leaves more of the frame to the renderer, and ratios grow. 2dbench's structure-of-arrays simulation is lighter than the object-based one in debuff's own bench, and the same two libraries come out further apart here (particles at 200k: about 4.7× here, against 3.8× there). Neither number is "the" ratio. Both are true of their benchmark, which is why every result states its method, and why ratios from different benchmarks shouldn't be mixed.

## Threats to validity

Each threat says what could make a result misleading, and what 2dbench does about it. These are the honest weak spots.

| Threat | Effect | Mitigation | Residual risk |
| --- | --- | --- | --- |
| **The sync costs time.** A 1-pixel `readPixels` stalls the pipeline. A real game never does this; it lets frames overlap. | Absolute frame times include one full CPU–GPU round trip, so they're higher than a pipelined game would see. | Every adapter pays the same stall, so ratios are fair. Without it, frames would look as fast as the CPU can queue them, which is far worse. | Renderers that lean on CPU–GPU overlap would do relatively better in a real game than here. |
| **Headless, automated Chrome.** | Background-tab throttling and compositor differences. | Headless Chrome uses the real GPU on Windows and macOS (the GPU string is recorded). On Linux it falls back to SwiftShader, so runs there use `HEADED=1` (a visible window), which gets the real GPU. Frames are timed directly, not through `requestAnimationFrame`, so throttling and vsync don't apply. `mobile.html` runs in a normal tab. | Compositing and presentation costs aren't measured. |
| **Garbage collection.** | GC pauses inflate some frames. | Medians resist outliers. `p95FrameMs` shows them. Adapters must not allocate per frame unless the library itself does, which is what's being measured. | A GC-heavy library looks better in the median than it feels in play. Read `p95FrameMs` too. |
| **Thermal throttling and background load.** | Later measurements run hotter. | Rounds rotate the adapter order. The power source and plan are recorded. Min–max is reported. | Long runs on fanless laptops and phones drift. Compare ratios within one file only. |
| **The simulation is in the timed frame.** | Absolute numbers include the shared simulation, which grows with the sprite count (not yet measured separately). | Identical for every adapter, as in a real game. | Ratios slightly understate differences between renderers. |
| **Scenes are synthetic.** | Real games mix workloads. | Several scenes, each stating its purpose, with more planned (tilemaps, text, churn). | No benchmark predicts a specific game. Profile your own (for example with myaku). |
| **One frame of parity.** | A renderer could differ only on frames that weren't checked. | Two counts (2k and 50k) after 10 seeded steps. Adapters draw from the same arrays, so there's no per-frame branching to hide in. | A library that culls only above 50k sprites wouldn't be caught. |
| **Library setup.** | A badly configured library looks slow. | `setup` is documented in every result. Maintainers are invited to correct it ([CONTRIBUTING](CONTRIBUTING.md)). Alternatives that were measured (WebGPU, atlases, `roundPixels`) are listed above. | Until a library's maintainers review its adapter, treat its numbers as provisional. |
| **Conflict of interest.** | The project was started by spryte's authors. | The incumbent library (PixiJS) as parity reference, public method and adapters, outside review for changes that help spryte, and maintainers welcome. | Trust has to be earned over time. Re-run it yourself. |

## Known limits

- One process and one browser per run. Results from different machines aren't directly comparable; compare ratios.
- Desktop browsers are automated with Playwright. Phones run `mobile.html` by hand, or through a device cloud.
- GPU timing is end-to-end only. There are no GPU timer queries, because `EXT_disjoint_timer_query` is often unavailable.

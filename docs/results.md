# Results format

`node run.mjs <scene>` writes `results/<date>-<platform>-<scene>.json`. One file holds one scene, run on one machine, at one time. Results from different files are only comparable as ratios between adapters within each file.

## Top level

| Field | Meaning |
| --- | --- |
| `date` | ISO timestamp when the run finished. |
| `scene` | Scene id (`bunny`, `mixed`, `particles`); see `src/scenes.ts`. |
| `rounds` | How many interleaved rounds were run. |
| `environment` | Where it ran (below). |
| `method` | The constants used, so a file stays interpretable if the defaults change (below). |
| `results` | One entry per adapter, in the order they were checked (the first is the parity reference). |

## `environment`

| Field | Meaning |
| --- | --- |
| `gpu` | `UNMASKED_RENDERER_WEBGL` from `WEBGL_debug_renderer_info`. On Windows it includes the ANGLE backend, such as Direct3D 11. |
| `browser` | Browser and version, as Playwright reports it. |
| `os` | `process.platform`, OS release and architecture. |
| `cpu` | The first CPU model string reported by Node. |
| `memoryGB` | RAM visible to the OS, rounded. |
| `power` | Power source and plan, detected on Windows; elsewhere it says it wasn't detected. Laptops throttle on battery. |
| `note` | Free text from the `NOTE` environment variable, for anything the runner can't detect (device model, battery saver, thermal state). |
| `commit` | The 2dbench commit that produced the file, or `uncommitted`. |

## `method`

| Field | Meaning |
| --- | --- |
| `budgetMs` | The 60 fps frame budget (16.67 ms) used for "max at 60 fps". |
| `framesPerCount` / `warmupFrames` | Measured and warm-up frames per count (100 and 20). |
| `publishedCounts` | Counts measured for every adapter in every round, even past the budget. |
| `timing` | How a frame is timed. |
| `parity` | `counts` checked, the per-channel `tolerance`, the `reference` adapter, and the `gate` thresholds. |

## `results[]`

| Field | Meaning |
| --- | --- |
| `adapter`, `label` | Adapter id and a human-readable library and API. |
| `package`, `version` | npm package and installed version (empty for hand-written adapters). |
| `setup` | How the library was configured, copied from the adapter, so readers can check it's idiomatic. |
| `maxAt60fps` | The largest ladder count measured in every round whose median frame is at most `budgetMs`. A lower bound: ladder steps are up to 2× apart. |
| `parity` | Per parity count: `coveragePercent` (drawn area relative to the reference), `differingPercent` (drawn pixels differing by more than the tolerance), `interiorDifferingPercent` (those inside sprites, where the 3×3 neighbourhood is flat in both frames) and `drawnPixels`. |
| `counts[]` | One entry per measured sprite count (below). |

## `counts[]`

| Field | Meaning |
| --- | --- |
| `count` | Number of sprites. |
| `runs` | Rounds that measured this count. Published counts always equal `rounds`. Ladder counts past the budget may have fewer. |
| `frameMs` | **The headline number.** Median across rounds of each round's median frame time, from simulation to GPU completion, in ms. |
| `minFrameMs`, `maxFrameMs` | Smallest and largest per-round median. |
| `roundsFrameMs` | Every round's median frame time, in round order, so anyone can redo the statistics (`node variance.mjs <files>`). |
| `p95FrameMs` | Median across rounds of each round's 95th-percentile frame: spikes such as garbage collection show here. |
| `submitMs` | Median across rounds of main-thread time before the GPU sync: the CPU part of the frame. `frameMs - submitMs` is roughly the GPU's share. |

## Submitting results

Run on your device, keep the JSON unedited apart from `note`, and open a pull request adding it under `results/`. Say anything unusual in the PR: an external display, a game running in the background, power saving. A result whose parity gate failed is never written, so every committed file has passed it.

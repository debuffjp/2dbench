# Results format

`node run.mjs <scene>` writes `results/<date>-<platform>-<scene>.json`. One file holds one scene, run on one machine, at one time. Results from different files are only comparable as ratios between adapters within each file.

## Top level

| Field | Meaning |
| --- | --- |
| `date` | ISO timestamp when the run finished. |
| `scene` | Scene id (`bunny`, `particles`, `mixed`, `raycaster`, `tilemap`, `churn`, `text`, `lowres`, `clip`, `upload`); see `src/scenes.ts`. |
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
| `headless` | Whether the browser ran without a window. `false` means `HEADED=1`, which Linux needs for real-GPU rendering. Missing in files made before this field existed. |
| `softwareRendering` | `true` if the GPU string is a software renderer (SwiftShader, llvmpipe). Timed runs refuse this unless `ALLOW_SOFTWARE=1`, and the dataset doesn't accept it. |
| `note` | Free text from the `NOTE` environment variable, for anything the runner can't detect (device model, battery saver, thermal state). |
| `commit` | The 2dbench commit that produced the file, or `uncommitted`. |

## `method`

| Field | Meaning |
| --- | --- |
| `budgetMs` | The 60 fps frame budget (16.67 ms) used for "max at 60 fps". |
| `framesPerCount` / `warmupFrames` | Measured and warm-up frames per count (100 and 20). |
| `publishedCounts` | Counts measured for every adapter in every round, even past the budget. 10k, 50k and 200k unless the scene declares its own. |
| `counts` | Present when the scene declares its own ladder: `ladder` (the counts timed), `published` and `why`. Only `text` does. |
| `timing` | How a frame is timed. |
| `parity` | `counts` checked, the per-channel `tolerance`, the `reference` adapter, and the `gate` thresholds. A scene that declares its own gate (`text`) replaces `gate` with its own, including its `counts` and `why`. |
| `startup` | How the startup numbers were taken. |

## `results[]`

| Field | Meaning |
| --- | --- |
| `adapter`, `label` | Adapter id and a human-readable library and API. |
| `package`, `version` | npm package and installed version (empty for hand-written adapters). |
| `setup` | How the library was configured, copied from the adapter, so readers can check it's idiomatic. |
| `maxAt60fps` | The largest ladder count measured in every round whose median frame is at most `budgetMs`. A lower bound: ladder steps are up to 2x apart. |
| `parity` | Per parity count: `coveragePercent` (drawn area relative to the reference), `differingPercent` (drawn pixels differing by more than the tolerance), `interiorDifferingPercent` (those inside sprites, where the 3x3 neighbourhood is flat in both frames) and `drawnPixels`. |
| `startup` | Medians over rounds, each on a fresh page: `readyMs` from navigation to the adapter being ready, `createMs` for the adapter's own setup (its library import included), `firstFrameMs` for the first 1,000-sprite frame through GPU completion; `rounds` holds every round's values. |
| `contextLoss` | For WebGL adapters: `recovered` and `ms` from the context being restored to the adapter drawing the same frame again, or `reason` when it never did. `null` for Canvas 2D. |
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
| `simMs` | Mean time per frame in the shared simulation, identical work for every adapter, so it can be subtracted to compare renderers alone. |
| `roundsHeapMB` | JS heap after this count's frames, per round (Chrome's coarse counter), to show growth over a run. Textures and canvases aren't in it. |

## Phone results (`mobile.html`)

Files from `mobile.html` hold every scene in one file, in a lighter format: `results[scene][adapter] = { maxAt60fps, counts: { "<count>": [one median frame time per round] } }`. `environment` adds `userAgent`, `devicePixelRatio`, `screen`, `cores`, `memoryGB`, `timerResolutionMs` (the smallest step of `performance.now()`: about 0.1 ms in desktop Chrome, 1 ms on iOS) and battery state where the browser exposes it. Each adapter's entry also has `parity`, in the same shape as a desktop file's (`{ "<count>": { coveragePercent, differingPercent, interiorDifferingPercent, drawnPixels } }`), computed on the phone against the reference. `method.parity` records the counts, tolerance, reference and gate. An adapter outside the gate isn't timed, so its `counts` is empty. Files made before mobile.html ran the gate have no `parity`; they're accepted and marked unchecked on the results page.

## `submission` (community results)

Files in `results/community/` come from GitHub issues, through the results-intake workflow, which adds `submission: { issue, device, conditions, submittedBy }` from the issue form. Everything else is as the tool wrote it.

## Submitting results

See the README's "Submit your results". In short: tap **Submit** (no account) or **Submit on GitHub** in `mobile.html`, or run `node submit.mjs <file>` for a desktop file. Either opens an issue, which a workflow validates (`scripts/validate-results.mjs`) and commits to `results/community/`. A desktop result whose parity gate failed is never written, so every desktop file has passed it. A phone file can include an adapter that failed, but that adapter has no timings.

## Charts

`npm run charts` redraws the README charts in `docs/charts/` from the files in `results/`. Pass result files to chart those instead, for example `node scripts/charts.mjs results/community/<file>.json`; each gets its own SVG. Charts show only current adapters.

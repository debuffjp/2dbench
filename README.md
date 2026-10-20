# 2dbench

**An open, fair benchmark for 2D web renderers.** Every library draws the same scenes from the same simulation. Nothing is timed until a pixel-parity gate confirms every library drew the same thing. Every result carries the full environment it ran in, and every number can be re-derived from raw per-round data.

Renderer benchmarks are easy to rig, usually by accident: a library left on a slow default, scenes that favour one design, timing that vsync hides, numbers from one lucky run. 2dbench is built so that's hard to do and easy to check.

> **Conflict of interest, in the open.** 2dbench was started by the [debuff](https://debuff.jp) project, whose renderer [spryte](https://github.com/debuffjp/spryte) is one of the contestants. The parity reference is PixiJS `Sprite`, the most widely used 2D web renderer, not spryte. Every library's setup is documented, and library maintainers are invited to review theirs ([CONTRIBUTING](CONTRIBUTING.md)). If your library is configured badly, please send a PR.

**Status: early.** Four scenes and five adapters, measured on one desktop and one iPhone so far. **Your device would help:** see [Submit your results](#submit-your-results), and the [community results](https://debuffjp.github.io/2dbench/results.html). Phone and other-browser results are the most wanted contribution.

## Results so far

![Most sprites at 60 fps in each scene, per library](docs/charts/max-at-60fps.svg)

Windows 11, Chrome 155, NVIDIA RTX 5060 Laptop GPU (ANGLE, Direct3D 11), AMD Ryzen 7 260, on AC power with power plan Turbo. The median frame (simulation through GPU completion) is in ms; lower is better. † marks frames under 2 ms, which are low precision ([why](METHOD.md#statistics)). Raw data, with every round's value, is in [`results/`](results).

### Across devices

`particles`, one draw call per sprite (spryte `draw.sprite` against PixiJS `Sprite`), every property changing. Most sprites held at 60 fps, and how much faster spryte's frame was at 50k sprites (10k on the Android phone):

| Device | GPU | Browser | spryte | PixiJS | spryte faster |
| --- | --- | --- | --- | --- | --- |
| Laptop (reference) | NVIDIA RTX 5060 | Chrome 155, Windows | 50,000 | 20,000 | 3.8× |
| Lenovo Legion Pro 7 | NVIDIA RTX 4080 | Chromium 156, Linux | 100,000 | 50,000 | 2.7× |
| Windows laptop | AMD Radeon 780M (integrated) | Chrome, Windows | 50,000 | 20,000 | 3.3× |
| iPhone | Apple GPU | Safari, iOS 18 | 100,000 | 20,000 | 3.7× |
| iPhone | Apple GPU | Chrome, iOS 26 (2 runs) | 50,000–100,000 | 20,000 | 3.5–3.8× |
| Android phone | Mali-T760 class | Firefox | 10,000 | 5,000 | 1.6× |

spryte's one-call-per-sprite path is ahead on every device so far. The bulk paths (spryte `draw.sprites` against `ParticleContainer`) are 2.5–4× apart on desktop GPUs, but on iPhones they finish level, because there the GPU's fill rate, not JavaScript, is the limit. Phone runs are one quick round each with coarse timers, so treat them as indicative. Every row is a file in [`results/`](results).

**`bunny`**: one texture, position only, 7 rounds

![bunny: frame time by count per library, with the 60 fps budget](docs/charts/bunny.svg)

| Adapter | Version | Max at 60 fps | 10k | 50k | 200k |
| --- | --- | --- | --- | --- | --- |
| spryte `draw.sprites` | 0.1.0 | 800,000 | 0.6 † | 1.1 † | 2.9 |
| PixiJS `ParticleContainer` | 8.22.0 | 200,000 | 1.4 † | 3.3 | 8.9 |
| spryte `draw.sprite` | 0.1.0 | 100,000 | 1.9 † | 6.1 | 21.5 |
| PixiJS `Sprite` | 8.22.0 | 50,000 | 4.1 | 16.6 | 71.4 |
| Canvas 2D `drawImage` | – | 5,000 | 30.1 | 146.0 | 611.2 |

**`particles`**: one texture; position, rotation, scale, tint and alpha all change, 7 rounds

![particles: frame time by count per library, with the 60 fps budget](docs/charts/particles.svg)

| Adapter | Version | Max at 60 fps | 10k | 50k | 200k |
| --- | --- | --- | --- | --- | --- |
| spryte `draw.sprites` | 0.1.0 | 400,000 | 0.8 † | 2.0 | 6.1 |
| PixiJS `ParticleContainer` | 8.22.0 | 100,000 | 2.4 | 8.1 | 28.9 |
| spryte `draw.sprite` | 0.1.0 | 50,000 | 2.5 | 8.9 | 37.1 |
| PixiJS `Sprite` | 8.22.0 | 20,000 | 6.8 | 34.0 | 137.2 |

**`mixed`**: 4 separate textures; rotation, scale, tint and alpha all change, 5 rounds

![mixed: frame time by count per library, with the 60 fps budget](docs/charts/mixed.svg)

| Adapter | Version | Max at 60 fps | 10k | 50k | 200k |
| --- | --- | --- | --- | --- | --- |
| spryte `draw.sprite` | 0.1.0 | 50,000 | 2.5 | 9.9 | 38.9 |
| PixiJS `Sprite` | 8.22.0 | 10,000 | 6.5 | 33.6 | 141.5 |

**`raycaster`**: enemies in a first-person maze, each visible one drawn as many texture slices, 3 rounds

![raycaster: frame time by count per library, with the 60 fps budget](docs/charts/raycaster.svg)

| Adapter | Version | Max enemies at 60 fps | 10k | 50k | 200k |
| --- | --- | --- | --- | --- | --- |
| spryte `draw.sprite` | 0.1.0 | 10,000 | 11.3 | 58.2 | 377.1 |
| PixiJS `Sprite` | 8.22.0 | 2,000 | 46.4 | 238.7 | 946.6 |

**iPhone** (iOS 26.6.2, Chrome, which uses WebKit on iOS; Apple GPU): `mobile.html`, 1 quick round, 60 frames per count. iOS timers have 1 ms resolution, so these are indicative ([raw](results/community/2026-10-19-iphone-ios-26-chrome.json)).

| Scene | Adapter | Max at 60 fps | 10k | 50k | 200k |
| --- | --- | --- | --- | --- | --- |
| bunny | spryte `draw.sprites` | 400,000 | 2 | 6 | 12 |
| bunny | PixiJS `ParticleContainer` | 200,000 | 2 | 7 | 13 |
| bunny | spryte `draw.sprite` | 100,000 | 4 | 9 | 18 |
| bunny | PixiJS `Sprite` | 20,000 | 4 | 17 | – |
| bunny | Canvas 2D `drawImage` | 10,000 | 10 | – | – |
| mixed | spryte `draw.sprite` | 100,000 | 4 | 9 | 22 |
| mixed | PixiJS `Sprite` | 20,000 | 7 | 32 | – |
| particles | spryte `draw.sprites` | 200,000 | 3 | 7 | 12 |
| particles | PixiJS `ParticleContainer` | 100,000 | 3 | 9 | 28 |
| particles | spryte `draw.sprite` | 100,000 | 5 | 9 | 22 |
| particles | PixiJS `Sprite` | 20,000 | 6 | 32 | – |

On this phone, the gap closes for position-only bulk drawing (spryte `draw.sprites` and PixiJS `ParticleContainer` are level at 200k). It stays wide for general sprites (about 3.6× in `mixed` at 50k) and for dynamic particles (about 2.3× at 200k). The phone's Canvas 2D does twice as well as the desktop's.

Parity passed in every scene (desktop; re-checked against PixiJS `Sprite` as the reference): coverage 99.8–100%, and 0% of pixels differ inside sprites. The rotated scenes differ at sprite edges (8–13% of drawn pixels), where libraries round rotated corners differently.

**How to read these.** Compare within a table, as ratios. Absolute times depend on the machine, the day and the benchmark design (see [Statistics](METHOD.md#statistics)). One desktop GPU says little about phones, where filling pixels often dominates.

## Contestants

| Adapter | Library and API | Scenes |
| --- | --- | --- |
| `canvas2d` | Canvas 2D `drawImage` | bunny, tilemap, churn (no per-draw tint) |
| `spryte` | spryte `draw.sprite` | all |
| `spryte-bulk` | spryte `draw.sprites` | bunny, particles, churn |
| `pixi-sprite` | PixiJS `Sprite` (the parity reference) | all |
| `pixi-particle` | PixiJS `ParticleContainer` | bunny, particles, churn |

`raycaster` needs a different texture region per sprite. spryte `draw.sprite` and PixiJS `Sprite` do that; the bulk paths (`draw.sprites`, `ParticleContainer`) share one region per call, and Canvas 2D can't tint for the shading, so they sit this one out.

Wanted: Phaser, KAPLAY, Excalibur, LittleJS, three.js, Babylon.js, melonJS, and Canvas 2D in an `OffscreenCanvas` worker. See [Adding a library](#adding-a-library).

## Scenes

| Scene | Every sprite | Measures |
| --- | --- | --- |
| `bunny` | Bounces under gravity. One texture, position only. | Raw sprite throughput: the classic bunnymark. |
| `mixed` | Also rotates, scales, and changes tint and alpha over time. Drawn from 4 separate textures. | General-purpose sprites, and multi-texture batching. |
| `particles` | Like `mixed`, from one texture. | Bulk and particle APIs with per-particle properties. |
| `tilemap` | Scrolling tile layers: an opaque ground layer with animated water, then sparse decoration layers, each scrolling at its own speed. The count is tiles drawn (2,135 per full layer). | The workload of nearly every platformer and top-down game: many small slices of one atlas, moving every frame. |
| `churn` | Every sprite lives 60 frames, so a sixtieth of them are destroyed and created each frame, and they grow as they age. | Bullets, pickups and effects. Retained-mode libraries pay for creating and destroying objects, as a game would. |
| `raycaster` | A retro first-person maze (the Wolfenstein 3D technique): 480 textured wall slices, distance shading, and squish-blob enemies billboarded and clipped column by column. The count is the number of enemies. | Thousands of thin quads per frame, each from a different region of one texture atlas: what raycasters, sprite-sheet animation and tile atlases do. |

Every property a scene uses changes over time, so no library can win by caching values that never change. In `raycaster`, the shared simulation does all the game work (casting rays, shading, projecting and depth-clipping enemies), and adapters only draw the resulting slices. Planned: text and UI, clipping, render targets and post-effects, texture uploads, and context loss.

## Run it

**On a desktop** (Chrome or Edge):

```bash
npm install
node run.mjs                        # bunny, every adapter, 5 rounds
node run.mjs particles
node run.mjs mixed spryte pixi-sprite rounds=7
node run.mjs bunny rounds=0         # parity gate only (fast)
NOTE="Surface Laptop 5, balanced power" node run.mjs particles
```

This writes `results/<date>-<platform>-<scene>.json` ([format](docs/results.md)) and prints a markdown table. `PARITY_DUMP=1` also writes each adapter's parity frame and a diff image to `results/parity/`.

On Linux, headless Chrome falls back to software rendering (the GPU string reads "SwiftShader"). Run with a visible window instead, and keep the machine idle while it runs: `HEADED=1 node run.mjs particles`. Under Wayland, add `BROWSER_ARGS="--ozone-platform=wayland"`.

**On a phone or tablet:**

- Open **[debuffjp.github.io/2dbench/mobile.html](https://debuffjp.github.io/2dbench/mobile.html)**, fill in the device note, keep the screen on, and tap Run. Then submit the copied JSON with the [results issue template](../../issues/new?template=results.yml).
- Or serve it from your computer: run `npm run phone` and open `http://<computer's LAN IP>:4800/mobile.html`. **Send to this computer** then saves the results straight into `results/`.

## Submit your results

The more varied the devices, the more useful the data. Phones, tablets, Chromebooks, integrated GPUs, older laptops, Safari and Firefox are all wanted: they're where renderers differ most, and where most players are.

- **From a phone or any browser:** open [mobile.html](https://debuffjp.github.io/2dbench/mobile.html), type your device model, tap **Run**, then **Submit on GitHub**. It opens a pre-filled issue, and nothing is sent until you press Submit there.
- **From a desktop run:** `node submit.mjs results/<file>.json`. It validates the file, shows exactly what will be public, asks for your device model, and opens the issue with the GitHub CLI (`gh`).
- **By hand:** open a [results issue](../../issues/new?template=results.yml) and paste the JSON.

**What happens next:** a workflow checks the JSON. If it can't be accepted, it says why on the issue, and editing the issue re-runs it. If it can, the workflow commits it to `results/community/`, closes your issue and rebuilds the [community results page](https://debuffjp.github.io/2dbench/results.html), so it appears there within a couple of minutes. Validation is the gate; a file that turns out to be wrong is reverted in the open. No server or database is involved: it's all in this repository, in the open.

**What's public:** the results file, which holds timings, the browser user agent, GPU string, CPU and OS where known, and your device note, plus your GitHub username on the issue. Nothing else is collected. Results data is released under [CC0](https://creativecommons.org/publicdomain/zero/1.0/), so anyone can reuse it.

## Method, in brief

1. **Same work.** Scenes own a seeded simulation and hand every adapter the same typed arrays each frame. Adapters only draw. Same textures, 960×540, nearest filtering, no antialiasing, unrotated sprites on whole pixels.
2. **Parity gate.** Before timing, each adapter draws the same frame at 2,000 and 50,000 sprites, compared with the reference. The run fails if drawn area differs by more than 0.5%, or if more than 0.5% of pixels differ inside sprites. The inside-sprite metric is validated: a deliberately wrong tint scores 22%.
3. **Honest timing.** Each frame is timed from simulation to GPU completion (a 1-pixel readback), so vsync can't hide cost. 20 warm-up frames, then 100 measured.
4. **Statistics from evidence.** 5 interleaved rounds by default, chosen from a variance study. Medians with min–max, and every round's value kept. Low-precision cells are flagged.
5. **Full environment,** recorded automatically: GPU, browser, CPU, OS, memory, power source and plan, library versions, and the 2dbench commit.

The reasons for each choice, and the threats to validity, are in **[METHOD.md](METHOD.md)**.

## Adding a library

1. Add it to `package.json` at an exact version.
2. Write `src/adapters/<library>.ts`, implementing `Adapter` from [`src/types.ts`](src/types.ts):
   - `supports(scene)`: decline what the library can't do honestly. For example, Canvas 2D has no per-draw tint.
   - `create(canvas, textures, scene)`: set the library up the way its docs recommend for performance, and describe it in `setup`.
   - `draw(state)`: draw `state.count` sprites from the arrays, setting only the properties the scene uses.
   - `sync()`: a 1-pixel `readPixels` on the library's context.
3. Register it in [`src/adapters/index.ts`](src/adapters/index.ts), run `node run.mjs <scene> <id> rounds=0` until parity passes, then open a PR.

The adapters in `src/adapters/` are short and worth reading as examples. If you maintain a library here, please review its adapter: corrections that keep parity are merged and results rerun ([CONTRIBUTING](CONTRIBUTING.md)).

## Project

- [METHOD.md](METHOD.md): how and why it measures the way it does, statistics, and threats to validity.
- [docs/results.md](docs/results.md): every field of a results file.
- [CONTRIBUTING.md](CONTRIBUTING.md): adapter rules, maintainer review, method changes, conflicts of interest.
- [AGENTS.md](AGENTS.md): for AI agents: JSON output, fairness rules, how to propose scenarios.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- CI runs the typecheck and the parity gate on every pull request (software WebGL, so correctness only).
- [Community results](https://debuffjp.github.io/2dbench/results.html): every submitted device, rebuilt on each merge.

## Licence

Code: MIT. Results data (`results/`): CC0. Library adapters use each library under its own licence.

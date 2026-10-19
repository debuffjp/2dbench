# 2dbench

**An open, fair benchmark for 2D web renderers.** Every library draws the same scenes from the same simulation. Nothing is timed until a pixel-parity gate confirms every library drew the same thing. Every result carries the full environment it ran in, and every number can be re-derived from raw per-round data.

Renderer benchmarks are easy to rig, usually by accident: a library left on a slow default, scenes that favour one design, timing that vsync hides, numbers from one lucky run. 2dbench is built so that's hard to do and easy to check.

> **Conflict of interest, in the open.** 2dbench was started by the [debuff](https://debuff.jp) project, whose renderer [spryte](https://github.com/debuffjp/spryte) is one of the contestants. The parity reference is a hand-written WebGL2 renderer, not spryte. Every library's setup is documented, and its maintainers have the final say on it ([CONTRIBUTING](CONTRIBUTING.md)). Changes that help spryte need outside review. If your library is configured badly, please send a PR.

**Status: early.** Three scenes and six adapters, measured on one desktop so far. Phone and other-browser results are the most wanted contribution.

## Results so far

Windows 11, Chrome 155, NVIDIA RTX 5060 Laptop GPU (ANGLE, Direct3D 11), AMD Ryzen 7 260, on AC power with power plan Turbo. The median frame (simulation through GPU completion) is in ms; lower is better. † marks frames under 2 ms, which are low precision ([why](METHOD.md#statistics)). Raw data, with every round's value, is in [`results/`](results).

**`bunny`**: one texture, position only, 7 rounds

| Adapter | Version | Max at 60 fps | 10k | 50k | 200k |
| --- | --- | --- | --- | --- | --- |
| Hand-written WebGL2 (reference) | – | 800,000 | 0.7 † | 1.4 † | 4.0 |
| spryte `draw.sprites` | 0.1.0 | 800,000 | 0.6 † | 1.1 † | 2.9 |
| PixiJS `ParticleContainer` | 8.22.0 | 200,000 | 1.4 † | 3.3 | 8.9 |
| spryte `draw.sprite` | 0.1.0 | 100,000 | 1.9 † | 6.1 | 21.5 |
| PixiJS `Sprite` | 8.22.0 | 50,000 | 4.1 | 16.6 | 71.4 |
| Canvas 2D `drawImage` | – | 5,000 | 30.1 | 146.0 | 611.2 |

**`particles`**: one texture; position, rotation, scale, tint and alpha all change, 7 rounds

| Adapter | Version | Max at 60 fps | 10k | 50k | 200k |
| --- | --- | --- | --- | --- | --- |
| Hand-written WebGL2 (reference) | – | 400,000 | 0.8 † | 2.5 | 6.6 |
| spryte `draw.sprites` | 0.1.0 | 400,000 | 0.8 † | 2.0 | 6.1 |
| PixiJS `ParticleContainer` | 8.22.0 | 100,000 | 2.4 | 8.1 | 28.9 |
| spryte `draw.sprite` | 0.1.0 | 50,000 | 2.5 | 8.9 | 37.1 |
| PixiJS `Sprite` | 8.22.0 | 20,000 | 6.8 | 34.0 | 137.2 |

**`mixed`**: 4 separate textures; rotation, scale, tint and alpha all change, 5 rounds

| Adapter | Version | Max at 60 fps | 10k | 50k | 200k |
| --- | --- | --- | --- | --- | --- |
| Hand-written WebGL2 (reference) | – | 400,000 | 0.8 † | 2.0 | 6.7 |
| spryte `draw.sprite` | 0.1.0 | 50,000 | 2.5 | 9.9 | 38.9 |
| PixiJS `Sprite` | 8.22.0 | 10,000 | 6.5 | 33.6 | 141.5 |

Parity passed in every scene: coverage 99.8–100%, and 0% of pixels differ inside sprites. The rotated scenes differ at sprite edges (8–13% of drawn pixels), where libraries round rotated corners differently.

**How to read these.** Compare within a table, as ratios. Absolute times depend on the machine, the day and the benchmark design (see [Statistics](METHOD.md#statistics)). One desktop GPU says little about phones, where filling pixels often dominates.

## Contestants

| Adapter | Library and API | Scenes |
| --- | --- | --- |
| `webgl2-baseline` | Hand-written WebGL2, instanced: the parity reference, and a simple baseline. Not an upper bound: tuned libraries can beat it. | all |
| `canvas2d` | Canvas 2D `drawImage` | bunny (no per-draw tint) |
| `spryte` | spryte `draw.sprite` | all |
| `spryte-bulk` | spryte `draw.sprites` | bunny, particles |
| `pixi-sprite` | PixiJS `Sprite` | all |
| `pixi-particle` | PixiJS `ParticleContainer` | bunny, particles |

Wanted: Phaser, KAPLAY, Excalibur, LittleJS, three.js, Babylon.js, melonJS, and Canvas 2D in an `OffscreenCanvas` worker. See [Adding a library](#adding-a-library).

## Scenes

| Scene | Every sprite | Measures |
| --- | --- | --- |
| `bunny` | Bounces under gravity. One texture, position only. | Raw sprite throughput: the classic bunnymark. |
| `mixed` | Also rotates, scales, and changes tint and alpha over time. Drawn from 4 separate textures. | General-purpose sprites, and multi-texture batching. |
| `particles` | Like `mixed`, from one texture. | Bulk and particle APIs with per-particle properties. |

Every property a scene uses changes over time, so no library can win by caching values that never change. Planned: tilemaps, text and UI, clipping, render targets and post-effects, object churn (spawn and destroy), texture uploads, startup time and time to first frame, memory over time, and context loss.

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

**On a phone or tablet:**

- Open **[debuffjp.github.io/2dbench/mobile.html](https://debuffjp.github.io/2dbench/mobile.html)**, fill in the device note, keep the screen on, and tap Run. Then submit the copied JSON with the [results issue template](../../issues/new?template=results.yml).
- Or serve it from your computer: run `npm run phone` and open `http://<computer's LAN IP>:4800/mobile.html`. **Send to this computer** then saves the results straight into `results/`.

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

The adapters in `src/adapters/` are short and worth reading as examples. If you maintain a library here, please review its adapter: you have the final say ([CONTRIBUTING](CONTRIBUTING.md)).

## Project

- [METHOD.md](METHOD.md): how and why it measures the way it does, statistics, and threats to validity.
- [docs/results.md](docs/results.md): every field of a results file.
- [CONTRIBUTING.md](CONTRIBUTING.md): adapter rules, maintainer review, method changes, conflicts of interest.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- CI runs the typecheck and the parity gate on every pull request (software WebGL, so correctness only).

## Licence

MIT. Library adapters use each library under its own licence.

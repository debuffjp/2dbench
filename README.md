# 2dbench

An open, fair benchmark for 2D web renderers. Every library draws the **same scenes from the same simulation**, results are only published once a **pixel-parity check** has confirmed that every library drew the same thing, and every result carries the **full environment** it ran in.

Renderer benchmarks are easy to rig, usually by accident: a library left on a slow default, scenes that favour one design, timing that vsync hides, numbers from one lucky run. 2dbench is built so that's hard to do and easy to check.

> Started by the [debuff](https://debuff.jp) project, whose renderer [spryte](https://github.com/debuffjp/spryte) is one of the contestants. That's a conflict of interest, so it's out in the open. The parity reference is a hand-written WebGL2 renderer, not spryte. Every library's setup is documented and open to its maintainers. If yours is configured badly, please send a PR.

## Contestants

| Adapter | Library and API | Scenes |
| --- | --- | --- |
| `webgl2-baseline` | Hand-written WebGL2, instanced: the parity reference, and a simple baseline (not an upper bound; tuned libraries can beat it) | all |
| `canvas2d` | Canvas 2D `drawImage` | bunny |
| `spryte` | spryte `draw.sprite` | all |
| `spryte-bulk` | spryte `draw.sprites` | bunny, particles |
| `pixi-sprite` | PixiJS `Sprite` | all |
| `pixi-particle` | PixiJS `ParticleContainer` | bunny, particles |

Wanted: Phaser, KAPLAY, Excalibur, LittleJS, three.js, Babylon.js 2D, and Canvas 2D with `OffscreenCanvas` workers. See [Adding a library](#adding-a-library).

## Scenes

| Scene | Every sprite |
| --- | --- |
| `bunny` | Bounces under gravity. One texture, position only. |
| `mixed` | Also rotates, scales, and changes tint and alpha over time. Drawn from 4 separate textures. |
| `particles` | Like `mixed`, but from one texture: the bulk-API case. |

Planned: tilemaps, text and UI, clipping, render targets and post-effects, object churn (spawn and destroy), texture uploads, startup time and time to first frame, memory over time, and context loss.

## Run it

```bash
npm install
node run.mjs                        # bunny, every adapter, 3 rounds
node run.mjs particles rounds=5
node run.mjs mixed spryte pixi-sprite
```

It uses your installed Chrome (or set `BROWSER_CHANNEL=msedge`). Results go to `results/<date>-<platform>-<scene>.json`, and a markdown table is printed.

**On a phone or tablet:** run `npm run phone`, open `http://<your computer's LAN IP>:4800/mobile.html` on the device, and tap Run. *(Coming in the next commit.)*

## Method, in brief

1. **Same work.** Scenes own the simulation and hand every adapter the same typed arrays each frame. Adapters only draw. Same textures, 960×540, nearest filtering, no antialiasing, unrotated sprites on whole pixels.
2. **Parity gate.** Before any timing, each adapter draws the same seeded frame at 2,000 and at 50,000 sprites, and it's compared with the reference. The run fails if an adapter's drawn area differs by more than 0.5%, or if more than 0.5% of pixels differ *inside* sprites. Edge pixels (rounding rules) are reported but don't fail the run.
3. **Honest timing.** A frame is timed from simulation through GPU completion (a 1-pixel readback), so vsync can't hide cost. 20 warm-up frames, then 100 measured frames per count.
4. **Noise control.** Several rounds with the adapter order rotated. Reported as the median with min–max. The published counts (10k, 50k, 200k) are measured for every adapter in every round, even past 60 fps.
5. **Full environment.** GPU, browser, CPU, OS, memory, power source and plan (detected on Windows), library versions and the 2dbench commit, recorded automatically.

Details and the reasoning behind each choice are in [METHOD.md](METHOD.md).

## Adding a library

1. Add the library to `package.json` at an exact version.
2. Write `src/adapters/<library>.ts`, implementing `Adapter` from `src/types.ts`:
   - `supports(scene)`: say no to what the library can't do honestly. For example, Canvas 2D has no per-draw tint.
   - `create(canvas, textures, scene)`: set the library up the way its docs recommend for performance, and describe it in `setup`.
   - `draw(state)`: draw `state.count` sprites from the arrays. Set only the properties the scene uses.
   - `sync()`: a 1-pixel `readPixels` on the library's context.
3. Register it in `src/adapters/index.ts`, run `node run.mjs <scene> <id> rounds=1`, check that parity passes, and open a PR.

If you maintain a library here, we'd especially like your review of its adapter.

## Results

Results are committed to `results/`, one file per scene per run, with its environment. Results from other devices are very welcome as PRs, especially phones, tablets, integrated GPUs, Safari and Firefox.

## Licence

MIT

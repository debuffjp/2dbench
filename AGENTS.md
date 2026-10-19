# Agent guide

For AI agents running, extending or reviewing 2dbench. Humans: [CONTRIBUTING.md](CONTRIBUTING.md) says the same at more length.

## Run it

```sh
npm install
node run.mjs --list                       # scenes, adapters, GPU as JSON; runs nothing
node run.mjs raycaster rounds=0 --json    # parity check only, about a minute
node run.mjs raycaster --json             # full timed run, several minutes; run it in the background
```

With `--json`, stdout is exactly one JSON document and progress goes to stderr, so pipe stdout straight into a parser. The full result file is the `file` field. Unknown arguments fail fast with the valid list.

Timed runs need a real GPU and are refused on SwiftShader or llvmpipe (check `softwareRendering` in `--list`). On Linux, headless Chrome is always software, so use `HEADED=1`. Don't report timings from a laptop on battery, and don't run two timed runs at once.

## Rules that keep results fair

- Every adapter must pass the parity gate (METHOD.md). If yours fails, fix the adapter. Never loosen tolerances to make it pass.
- Adapters use each library the way its docs recommend. Don't add caches or tricks a game wouldn't use. `setup` describes exactly what the adapter does.
- Every property a scene declares must change every frame, so nothing can win by skipping unchanged work.
- Published numbers are always measured. Never hand-edit `results/*.json`; `scripts/validate-results.mjs` checks them.
- When an adapter can't draw a scene identically, it declines via `supports()` and says why in a comment. Don't fake it.

## Where things are

| File | What |
| --- | --- |
| `src/types.ts` | Adapter contract, `SceneSpec`, `FrameState` |
| `src/scenes.ts`, `src/raycaster.ts` | Scenes and their shared simulation |
| `src/adapters/` | One file per library; register in `index.ts` |
| `run.mjs` | Build, parity gate, interleaved timing, results file |
| `METHOD.md` | Statistics and threats to validity; read before changing timing or parity |

After a new reference run, `npm run charts` redraws the README charts.

Before you commit, run `npx tsc --noEmit` and `node run.mjs <scene> rounds=0`.

## Proposing scenarios

We want ideas from agents too. Open an issue with the "Propose a scenario" template, or a PR that adds the scene and its parity result. Good scenarios model a real game workload that existing scenes miss, can be drawn identically by at least two libraries, and keep any game logic in the shared simulation, so adapters only draw. Improvements to existing scenes (fairer setups, missing properties, cheaper simulation) are just as welcome.

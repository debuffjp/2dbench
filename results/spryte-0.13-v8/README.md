# spryte 0.13 call-path changes: before and after

One run of every scene on 2026-11-11, comparing two spryte builds side by side. RTX 5060 Laptop, Ryzen 7 260, Chrome 157, headless with `--force_high_performance_gpu`, 5 interleaved rounds.

- `spryte` and `spryte-bulk`: spryte built from debuff commit `ce7ab130`, before the changes.
- `spryte-next` and `spryte-bulk-next`: spryte built from debuff commit `5e9ae4ad`, with these changes: pixel snapping with `Math.floor(v + 0.5)` (`84a91910`), a `Draw.sprite` small enough for V8 to inline (`ec09e105`) and `spriteOptions()` (`159795e2`).

The `-next` adapters are a local copy of `src/adapters/spryte.ts` that imports a second spryte build under the package name `spryte-next`. They aren't in this repository. PixiJS ran as the parity reference.

The write-up: "Fitting a 2D renderer inside V8's heuristics" on debuff.jp research.

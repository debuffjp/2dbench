# Contributing to 2dbench

2dbench is only useful if every library's maintainers and users trust it. These rules make that trust earnable.

## Ways to help

- **Run it on your devices** and submit the results (see [docs/results.md](docs/results.md)). Phones, tablets, Chromebooks, integrated GPUs, Safari and Firefox are the most wanted.
- **Add a library** (see the README's "Adding a library").
- **Review your library's adapter.** If you maintain or know a library here well, the most valuable contribution is telling us its adapter isn't how you'd write it.
- **Add a scene** that measures something real games do and the current scenes don't.
- **Challenge the method.** Open an issue saying what's unfair and why, ideally with a measurement.

## Adapter rules

An adapter must:

1. **Draw what the scene describes, and only that.** Parity has to pass: drawn area within 0.5% of the reference, and no more than 0.5% of pixels differing inside sprites.
2. **Be idiomatic.** Use the library the way its own documentation recommends for performance: its batching, particle or instancing APIs where they exist, and settings its docs suggest for many sprites. If a library offers two reasonable paths (PixiJS's `Sprite` and `ParticleContainer`), add both as separate adapters, so readers can compare general with general and specialised with specialised.
3. **Not depend on knowing the simulation.** Read the per-frame arrays; don't precompute the scene. Setting only the properties a scene uses is fine (every adapter does it), and so is marking properties a scene never changes as static. Today's scenes change every property they use.
4. **Describe itself honestly** in `setup`. That text is copied into every result.
5. **Pin its library** to an exact version in `package.json`.

## When a maintainer disagrees with their adapter

Maintainers of a library get the final say on how their library is set up, within the rules above. Open an issue or PR. If the change keeps parity and is idiomatic, it's merged, and published results are re-run. If someone else contests it, the discussion happens in the open on the PR, and the maintainer's documented recommendation wins.

## Changes to the method

Changes to timing, parity or statistics (`run.mjs`, `METHOD.md`) need:

- a rationale in the PR, ideally with before and after measurements;
- an update to `METHOD.md` in the same PR;
- a note in the changelog, because results made before and after the change aren't comparable.

## Conflicts of interest

2dbench was started by the debuff project, whose renderer spryte is a contestant. So:

- spryte's adapters get no special treatment and follow the same rules.
- The parity reference is the hand-written `webgl2-baseline`, not any library.
- Any change that helps spryte's results specifically must be reviewed by someone outside the debuff project before it's merged.
- PRs from library maintainers for their own adapters are especially welcome.

## Development

```bash
npm install
npm run typecheck
node run.mjs bunny rounds=0            # parity gate only: quick, and what CI runs
node run.mjs particles <adapter-id> rounds=1
```

Please follow the [code of conduct](CODE_OF_CONDUCT.md).

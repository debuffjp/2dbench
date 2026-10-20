// The parity gate, shared by run.mjs (desktop, in Node) and mobile.html (in the phone's browser), so both
// judge frames by exactly the same rules. Plain TypeScript with nothing to compile away: Node runs it as is.
import { HEIGHT, WIDTH } from "./types.ts";

/** Sprite counts whose seeded frame is compared with the reference's. */
export const PARITY_COUNTS = [2_000, 50_000];
/** A channel may differ by this many levels before a pixel counts as different. */
export const PARITY_TOLERANCE = 8;
/** Drawn area relative to the reference, in percent. */
export const COVERAGE_RANGE = [99.5, 100.5];
/** Most differing pixels allowed inside sprites, in percent of drawn pixels. */
export const MAX_INTERIOR_PERCENT = 0.5;

export interface Parity {
  drawnPixels: number;
  differingPercent: number;
  coveragePercent: number;
  interiorDifferingPercent: number;
}

/** The constants a results file records, so it stays interpretable if the defaults change. */
export const GATE = {
  counts: PARITY_COUNTS,
  tolerance: PARITY_TOLERANCE,
  gate: { coveragePercent: COVERAGE_RANGE, maxInteriorDifferingPercent: MAX_INTERIOR_PERCENT },
};

/** A scene's own gate, when it declares one (text), replacing the default limits. */
export interface SceneGate {
  coveragePercent: [number, number];
  maxInteriorDifferingPercent: number;
  /** Counts to check instead of PARITY_COUNTS. */
  counts?: number[];
}

export function passes(p: Parity, gate?: SceneGate): boolean {
  const [lo, hi] = gate?.coveragePercent ?? COVERAGE_RANGE;
  const interior = gate?.maxInteriorDifferingPercent ?? MAX_INTERIOR_PERCENT;
  return p.coveragePercent >= (lo as number) && p.coveragePercent <= (hi as number) && p.interiorDifferingPercent <= interior;
}

type Pixels = ArrayLike<number>;

/**
 * Compare a frame with the reference's (RGBA, top row first, WIDTH × HEIGHT). Coverage: drawn area relative
 * to the reference (skipped or culled sprites show here). Interior: differing pixels whose 3×3 neighbourhood
 * is flat in both frames. Any edge, even a sprite over another sprite, breaks flatness, so rounding rules that
 * move edges don't count; a wrong tint, alpha or texture inside a sprite does.
 */
export function compare(ref: Pixels, px: Pixels): Parity {
  const W = WIDTH;
  const H = HEIGHT;
  const at = (b: Pixels, i: number) => b[i] as number;
  const diff = (a: Pixels, b: Pixels, i: number, j = i) =>
    Math.max(Math.abs(at(a, i) - at(b, j)), Math.abs(at(a, i + 1) - at(b, j + 1)), Math.abs(at(a, i + 2) - at(b, j + 2)));
  const flat = (b: Pixels, x: number, y: number) => {
    const c = (y * W + x) * 4;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (diff(b, b, ((y + dy) * W + x + dx) * 4, c) > PARITY_TOLERANCE) return false;
    return true;
  };
  // Every scene clears to #11140d.
  const bg = (b: Pixels, i: number) => at(b, i) === 0x11 && at(b, i + 1) === 0x14 && at(b, i + 2) === 0x0d;
  let differ = 0;
  let drawn = 0;
  let own = 0;
  let refOwn = 0;
  let interior = 0;
  for (let i = 0; i < ref.length; i += 4) {
    const a = bg(ref, i);
    const b = bg(px, i);
    if (!b) own++;
    if (!a) refOwn++;
    if (a && b) continue;
    drawn++;
    if (diff(ref, px, i) > PARITY_TOLERANCE) {
      differ++;
      const x = (i / 4) % W;
      const y = (i / 4 / W) | 0;
      if (x > 0 && y > 0 && x < W - 1 && y < H - 1 && flat(ref, x, y) && flat(px, x, y)) interior++;
    }
  }
  const pct = (n: number, d: number) => (d ? +((100 * n) / d).toFixed(2) : 0);
  return {
    drawnPixels: drawn,
    differingPercent: pct(differ, drawn),
    coveragePercent: refOwn ? +((100 * own) / refOwn).toFixed(1) : 0,
    interiorDifferingPercent: pct(interior, drawn),
  };
}

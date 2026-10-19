// Variance study: how much do results move between rounds and between runs, and how many rounds does a
// stable median need? Reads results JSON files (each with roundsFrameMs) and prints, per adapter and count:
// the coefficient of variation across rounds, and how far the median of the first k rounds is from the
// median of all of them.
//   node variance.mjs results/2026-10-19-win32-bunny.json [more files...]
import { readFileSync } from "node:fs";

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const rows = [];
for (const file of process.argv.slice(2)) {
  const report = JSON.parse(readFileSync(file, "utf8"));
  for (const r of report.results)
    for (const c of r.counts) {
      const xs = c.roundsFrameMs;
      if (!xs || xs.length < 3) continue;
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
      const all = median(xs);
      const err = (k) => Math.abs(median(xs.slice(0, k)) - all) / all;
      rows.push({ scene: report.scene, adapter: r.adapter, count: c.count, rounds: xs.length, cv: sd / mean, err1: err(1), err3: err(3) });
    }
}
const pct = (x) => `${(100 * x).toFixed(1)}%`;
console.log("| Scene | Adapter | Count | Rounds | CV across rounds | Median of 1 round vs all | Median of 3 vs all |");
console.log("| --- | --- | --- | --- | --- | --- | --- |");
for (const r of rows) console.log(`| ${r.scene} | ${r.adapter} | ${r.count / 1000}k | ${r.rounds} | ${pct(r.cv)} | ${pct(r.err1)} | ${pct(r.err3)} |`);
const q = (k) => {
  const xs = rows.map((r) => r[k]).sort((a, b) => a - b);
  return `median ${pct(xs[Math.floor(xs.length / 2)] ?? 0)}, 90th percentile ${pct(xs[Math.floor(xs.length * 0.9)] ?? 0)}, max ${pct(xs.at(-1) ?? 0)}`;
};
console.log(`\nCV across rounds: ${q("cv")}`);
console.log(`1-round median error: ${q("err1")}`);
console.log(`3-round median error: ${q("err3")}`);

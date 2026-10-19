// Renders SVG charts from results files into docs/charts/, for the README and docs.
//   node scripts/charts.mjs                 the reference machine's results in results/
//   node scripts/charts.mjs results/community/<file>.json ...   any runner files (one chart each)
// The drawing code is src/charts.ts, shared with the website; Node runs it directly (type stripping).
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { SCENE_ORDER, frameChart, fromRunner, maxChart } from "../src/charts.ts";

const root = join(import.meta.dirname, "..");
const outDir = join(root, "docs", "charts");
mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const files = args.length ? args : readdirSync(join(root, "results")).filter((f) => f.endsWith(".json")).map((f) => join(root, "results", f));
const scenes = files.map((f) => ({ file: f, chart: fromRunner(JSON.parse(readFileSync(f, "utf8"))) }));
for (const { file, chart } of scenes) {
  const name = args.length ? basename(file, ".json") : chart.scene;
  writeFileSync(join(outDir, `${name}.svg`), `${frameChart(chart)}\n`);
  console.log(`docs/charts/${name}.svg`);
}
if (!args.length) {
  const ordered = scenes.map((s) => s.chart).sort((a, b) => SCENE_ORDER.indexOf(a.scene) - SCENE_ORDER.indexOf(b.scene));
  writeFileSync(join(outDir, "max-at-60fps.svg"), `${maxChart(ordered)}\n`);
  console.log("docs/charts/max-at-60fps.svg");
}

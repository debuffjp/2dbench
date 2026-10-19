// Renders SVG charts from results files into docs/charts/, for the README and docs.
//   node scripts/charts.mjs                 the reference machine's results in results/
//   node scripts/charts.mjs results/community/<file>.json ...   any files (one chart each)
// Charts are plain SVG with their own background, so they read the same in GitHub's light and dark themes.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const root = join(import.meta.dirname, "..");
const outDir = join(root, "docs", "charts");
mkdirSync(outDir, { recursive: true });

// One fixed colour per adapter, the same in every chart.
const COLOURS = { spryte: "#4ade80", "spryte-bulk": "#22d3ee", "pixi-sprite": "#f472b6", "pixi-particle": "#fbbf24", canvas2d: "#a78bfa" };
const colour = (id) => COLOURS[id] ?? "#94a3b8";
// Only current adapters: older result files also hold the retired hand-written WebGL2 reference.
const current = (report) => ({ ...report, results: report.results.filter((r) => r.adapter in COLOURS) });
const BG = "#0f1115";
const GRID = "#262a33";
const TEXT = "#d4d7dd";
const MUTED = "#8b909a";
const BUDGET = 1000 / 60;
const FONT = `font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const kfmt = (n) => (n >= 1e6 ? `${n / 1e6}M` : n >= 1e3 ? `${n / 1e3}k` : String(n));

/** Frame time against count, both log scale, one line per adapter with its min–max band across rounds. */
function frameChart(report) {
  const W = 760;
  const H = 400;
  const L = 64;
  const R = 180;
  const T = 56;
  const B = 52;
  const pw = W - L - R;
  const ph = H - T - B;
  const all = report.results.flatMap((r) => r.counts);
  const xMin = Math.min(...all.map((c) => c.count));
  const xMax = Math.max(...all.map((c) => c.count));
  const yMin = Math.max(0.5, Math.min(...all.map((c) => c.minFrameMs)) * 0.8);
  const yMax = Math.max(BUDGET * 2, ...all.map((c) => c.maxFrameMs)) * 1.1;
  const lx = (v) => L + ((Math.log10(v) - Math.log10(xMin)) / (Math.log10(xMax) - Math.log10(xMin))) * pw;
  const ly = (v) => T + ph - ((Math.log10(v) - Math.log10(yMin)) / (Math.log10(yMax) - Math.log10(yMin))) * ph;
  const s = [];
  s.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ${FONT}>`);
  s.push(`<rect width="${W}" height="${H}" rx="10" fill="${BG}"/>`);
  s.push(`<text x="${L}" y="26" fill="${TEXT}" font-size="15" font-weight="600">${esc(report.scene)}: frame time by sprite count</text>`);
  const env = report.environment;
  s.push(`<text x="${L}" y="44" fill="${MUTED}" font-size="11">${esc(`${env.gpu.replace(/^ANGLE \((.*)\)$/, "$1").split(",").slice(0, 2).join(",")} · ${env.browser} · ${report.rounds} rounds · lower is better`)}</text>`);
  // Grid: decades and halves on y, decades on x.
  for (const v of [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]) {
    if (v < yMin || v > yMax) continue;
    s.push(`<line x1="${L}" x2="${L + pw}" y1="${ly(v)}" y2="${ly(v)}" stroke="${GRID}"/>`);
    s.push(`<text x="${L - 8}" y="${ly(v) + 4}" fill="${MUTED}" font-size="11" text-anchor="end">${v} ms</text>`);
  }
  for (const v of [1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 2e6]) {
    if (v < xMin || v > xMax) continue;
    s.push(`<line x1="${lx(v)}" x2="${lx(v)}" y1="${T}" y2="${T + ph}" stroke="${GRID}"/>`);
    s.push(`<text x="${lx(v)}" y="${T + ph + 18}" fill="${MUTED}" font-size="11" text-anchor="middle">${kfmt(v)}</text>`);
  }
  s.push(`<text x="${L + pw / 2}" y="${H - 12}" fill="${MUTED}" font-size="11" text-anchor="middle">${report.scene === "raycaster" ? "enemies" : "sprites"} (log scale)</text>`);
  // The 60 fps budget.
  s.push(`<line x1="${L}" x2="${L + pw}" y1="${ly(BUDGET)}" y2="${ly(BUDGET)}" stroke="${TEXT}" stroke-dasharray="5 4" opacity="0.7"/>`);
  s.push(`<text x="${L + 6}" y="${ly(BUDGET) - 6}" fill="${TEXT}" font-size="11" opacity="0.8">60 fps budget (16.7 ms)</text>`);
  const sorted = [...report.results].sort((a, b) => b.maxAt60fps - a.maxAt60fps);
  for (const r of sorted) {
    const c = colour(r.adapter);
    const pts = r.counts.filter((p) => p.frameMs > 0);
    const band = [...pts.map((p) => `${lx(p.count)},${ly(Math.max(yMin, p.minFrameMs))}`), ...pts.reverse().map((p) => `${lx(p.count)},${ly(Math.min(yMax, p.maxFrameMs))}`)];
    pts.reverse();
    s.push(`<polygon points="${band.join(" ")}" fill="${c}" opacity="0.15"/>`);
    s.push(`<polyline points="${pts.map((p) => `${lx(p.count)},${ly(p.frameMs)}`).join(" ")}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round"/>`);
    for (const p of pts) s.push(`<circle cx="${lx(p.count)}" cy="${ly(p.frameMs)}" r="3" fill="${c}"/>`);
  }
  // Legend, best first, with each adapter's max count at 60 fps.
  sorted.forEach((r, i) => {
    const y = T + 8 + i * 40;
    s.push(`<rect x="${L + pw + 18}" y="${y}" width="12" height="12" rx="3" fill="${colour(r.adapter)}"/>`);
    s.push(`<text x="${L + pw + 36}" y="${y + 10}" fill="${TEXT}" font-size="12">${esc(r.label)}</text>`);
    s.push(`<text x="${L + pw + 36}" y="${y + 26}" fill="${MUTED}" font-size="11">${r.maxAt60fps.toLocaleString("en")} at 60 fps</text>`);
  });
  s.push("</svg>");
  return s.join("\n");
}

/** Most sprites at 60 fps, one group of bars per scene. */
function maxChart(reports) {
  const ids = [...new Set(reports.flatMap((r) => r.results.map((x) => x.adapter)))];
  const labels = Object.fromEntries(reports.flatMap((r) => r.results.map((x) => [x.adapter, x.label])));
  const W = 760;
  const rowH = 18;
  const groupGap = 26;
  const L = 190;
  const R = 90;
  const T = 50;
  const rows = reports.reduce((n, r) => n + r.results.length, 0);
  const H = T + rows * rowH + reports.length * groupGap + 20;
  const max = Math.max(...reports.flatMap((r) => r.results.map((x) => x.maxAt60fps)));
  const lx = (v) => (Math.log10(Math.max(v, 1)) / Math.log10(max * 1.5)) * (W - L - R);
  const s = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ${FONT}>`, `<rect width="${W}" height="${H}" rx="10" fill="${BG}"/>`];
  s.push(`<text x="20" y="28" fill="${TEXT}" font-size="15" font-weight="600">Most sprites at 60 fps, by scene (log scale, higher is better)</text>`);
  let y = T;
  for (const rep of reports) {
    s.push(`<text x="20" y="${y + 12}" fill="${TEXT}" font-size="12" font-weight="600">${esc(rep.scene)}</text>`);
    y += 18;
    for (const r of [...rep.results].sort((a, b) => b.maxAt60fps - a.maxAt60fps)) {
      s.push(`<text x="${L - 10}" y="${y + 12}" fill="${MUTED}" font-size="11" text-anchor="end">${esc(r.label)}</text>`);
      s.push(`<rect x="${L}" y="${y + 2}" width="${Math.max(2, lx(r.maxAt60fps))}" height="${rowH - 5}" rx="3" fill="${colour(r.adapter)}"/>`);
      s.push(`<text x="${L + lx(r.maxAt60fps) + 6}" y="${y + 12}" fill="${TEXT}" font-size="11">${r.maxAt60fps.toLocaleString("en")}</text>`);
      y += rowH;
    }
    y += groupGap - 18;
  }
  void ids;
  void labels;
  s.push("</svg>");
  return s.join("\n");
}

const args = process.argv.slice(2);
const files = args.length ? args : readdirSync(join(root, "results")).filter((f) => f.endsWith(".json")).map((f) => join(root, "results", f));
const reports = files.map((f) => current({ file: f, ...JSON.parse(readFileSync(f, "utf8")) }));
for (const r of reports) {
  const name = args.length ? basename(r.file, ".json") : r.scene;
  writeFileSync(join(outDir, `${name}.svg`), `${frameChart(r)}\n`);
  console.log(`docs/charts/${name}.svg`);
}
if (!args.length) {
  const order = ["bunny", "particles", "mixed", "raycaster"];
  reports.sort((a, b) => order.indexOf(a.scene) - order.indexOf(b.scene));
  writeFileSync(join(outDir, "max-at-60fps.svg"), `${maxChart(reports)}\n`);
  console.log("docs/charts/max-at-60fps.svg");
}

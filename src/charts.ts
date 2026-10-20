// SVG charts, shared by the site (results.html, mobile.html) and scripts/charts.mjs (the README's charts).
// No imports and no DOM: plain strings in, an SVG string out, so Node can run this file directly.
// Charts carry their own background, so they read the same on GitHub's light and dark themes.

export interface Point {
  count: number;
  ms: number;
  /** Fastest and slowest round, for the band. Omitted with one round. */
  min?: number;
  max?: number;
}
export interface Series {
  adapter: string;
  label: string;
  maxAt60fps: number;
  points: Point[];
}
export interface ChartScene {
  scene: string;
  /** Device, browser, rounds: shown under the title. */
  subtitle: string;
  series: Series[];
}

// One fixed colour per adapter, the same in every chart.
const COLOURS: Record<string, string> = { spryte: "#4ade80", "spryte-bulk": "#22d3ee", "pixi-sprite": "#f472b6", "pixi-particle": "#fbbf24", canvas2d: "#a78bfa" };
export const colour = (id: string) => COLOURS[id] ?? "#94a3b8";

const BG = "#0f1115";
const GRID = "#262a33";
const TEXT = "#d4d7dd";
const MUTED = "#8b909a";
const BUDGET = 1000 / 60;
const FONT = `font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"`;
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
const kfmt = (n: number) => (n >= 1e6 ? `${n / 1e6}M` : n >= 1e3 ? `${n / 1e3}k` : String(n));
export const SCENE_ORDER = ["bunny", "particles", "mixed", "raycaster", "tilemap", "churn", "text", "lowres", "clip", "upload"];
/** What a scene's count counts, for axis labels. */
const UNIT: Record<string, [string, string]> = { raycaster: ["enemy", "enemies"], tilemap: ["tile", "tiles"], text: ["label", "labels"] };

/** Frame time against count, both log scale (counts double; times span 1–1000 ms), one line per adapter with its min–max band. */
export function frameChart({ scene, subtitle, series }: ChartScene): string {
  const W = 760;
  const H = 400;
  const L = 64;
  const R = 180;
  const T = 56;
  const B = 52;
  const pw = W - L - R;
  const ph = H - T - B;
  const all = series.flatMap((r) => r.points).filter((p) => p.ms > 0);
  if (!all.length) return "";
  const xMin = Math.min(...all.map((c) => c.count));
  const xMax = Math.max(xMin * 2, ...all.map((c) => c.count));
  const yMin = Math.max(0.5, Math.min(...all.map((c) => c.min ?? c.ms)) * 0.8);
  const yMax = Math.max(BUDGET * 2, ...all.map((c) => c.max ?? c.ms)) * 1.1;
  const lx = (v: number) => L + ((Math.log10(v) - Math.log10(xMin)) / (Math.log10(xMax) - Math.log10(xMin))) * pw;
  const ly = (v: number) => T + ph - ((Math.log10(v) - Math.log10(yMin)) / (Math.log10(yMax) - Math.log10(yMin))) * ph;
  const s: string[] = [];
  s.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ${FONT} role="img" aria-label="${esc(scene)}: frame time by count">`);
  s.push(`<rect width="${W}" height="${H}" rx="10" fill="${BG}"/>`);
  s.push(`<text x="${L}" y="26" fill="${TEXT}" font-size="15" font-weight="600">${esc(scene)}: frame time by ${UNIT[scene]?.[0] ?? "sprite"} count</text>`);
  s.push(`<text x="${L}" y="44" fill="${MUTED}" font-size="11">${esc(`${subtitle} · lower is better`)}</text>`);
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
  s.push(`<text x="${L + pw / 2}" y="${H - 12}" fill="${MUTED}" font-size="11" text-anchor="middle">${UNIT[scene]?.[1] ?? "sprites"} (log scale)</text>`);
  s.push(`<line x1="${L}" x2="${L + pw}" y1="${ly(BUDGET)}" y2="${ly(BUDGET)}" stroke="${TEXT}" stroke-dasharray="5 4" opacity="0.7"/>`);
  s.push(`<text x="${L + 6}" y="${ly(BUDGET) - 6}" fill="${TEXT}" font-size="11" opacity="0.8">60 fps budget (16.7 ms)</text>`);
  const sorted = [...series].sort((a, b) => b.maxAt60fps - a.maxAt60fps);
  for (const r of sorted) {
    const c = colour(r.adapter);
    const pts = r.points.filter((p) => p.ms > 0);
    if (pts.some((p) => p.min !== undefined)) {
      const lo = pts.map((p) => `${lx(p.count)},${ly(Math.max(yMin, p.min ?? p.ms))}`);
      const hi = [...pts].reverse().map((p) => `${lx(p.count)},${ly(Math.min(yMax, p.max ?? p.ms))}`);
      s.push(`<polygon points="${[...lo, ...hi].join(" ")}" fill="${c}" opacity="0.15"/>`);
    }
    s.push(`<polyline points="${pts.map((p) => `${lx(p.count)},${ly(p.ms)}`).join(" ")}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round"/>`);
    for (const p of pts) s.push(`<circle cx="${lx(p.count)}" cy="${ly(p.ms)}" r="3" fill="${c}"/>`);
  }
  sorted.forEach((r, i) => {
    const y = T + 8 + i * 40;
    s.push(`<rect x="${L + pw + 18}" y="${y}" width="12" height="12" rx="3" fill="${colour(r.adapter)}"/>`);
    s.push(`<text x="${L + pw + 36}" y="${y + 10}" fill="${TEXT}" font-size="12">${esc(r.label)}</text>`);
    s.push(`<text x="${L + pw + 36}" y="${y + 26}" fill="${MUTED}" font-size="11">${r.maxAt60fps.toLocaleString("en")} at 60 fps</text>`);
  });
  s.push("</svg>");
  return s.join("\n");
}

/** Most sprites at 60 fps, one group of bars per scene. Linear and scaled per scene, so 2× the sprites is 2× the bar. */
export function maxChart(scenes: ChartScene[], title = "Most sprites at 60 fps"): string {
  const W = 760;
  const rowH = 18;
  const groupGap = 26;
  const L = 190;
  const R = 90;
  const T = 50;
  const rows = scenes.reduce((n, r) => n + r.series.length, 0);
  const H = T + rows * rowH + scenes.length * groupGap + 34;
  const s = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ${FONT} role="img" aria-label="${esc(title)}">`,
    `<rect width="${W}" height="${H}" rx="10" fill="${BG}"/>`,
    `<text x="20" y="28" fill="${TEXT}" font-size="15" font-weight="600">${esc(title)} (higher is better; each scene on its own scale)</text>`,
  ];
  let y = T;
  for (const sc of scenes) {
    // Scenes differ in cost by orders of magnitude, so each gets its own scale and they aren't compared.
    const top = Math.max(1, ...sc.series.map((x) => x.maxAt60fps));
    const lx = (v: number) => (v / top) * (W - L - R);
    s.push(`<text x="20" y="${y + 12}" fill="${TEXT}" font-size="12" font-weight="600">${esc(sc.scene)}</text>`);
    y += 18;
    for (const r of [...sc.series].sort((a, b) => b.maxAt60fps - a.maxAt60fps)) {
      s.push(`<text x="${L - 10}" y="${y + 12}" fill="${MUTED}" font-size="11" text-anchor="end">${esc(r.label)}</text>`);
      s.push(`<rect x="${L}" y="${y + 2}" width="${Math.max(2, lx(r.maxAt60fps))}" height="${rowH - 5}" rx="3" fill="${colour(r.adapter)}"/>`);
      s.push(`<text x="${L + lx(r.maxAt60fps) + 6}" y="${y + 12}" fill="${TEXT}" font-size="11">${r.maxAt60fps ? r.maxAt60fps.toLocaleString("en") : "under 1k"}</text>`);
      y += rowH;
    }
    y += groupGap - 18;
  }
  s.push(`<text x="20" y="${H - 12}" fill="${MUTED}" font-size="11">Counts are tested in steps (1k, 2k, 5k, 10k, 20k, 50k…): each bar is the last step that held 60 fps.</text>`);
  s.push("</svg>");
  return s.join("\n");
}

// ---- results files → chart data ----

interface RunnerReport {
  scene: string;
  rounds: number;
  environment: { gpu?: string; browser?: string };
  results: { adapter: string; label: string; maxAt60fps: number; counts: { count: number; frameMs: number; minFrameMs?: number; maxFrameMs?: number }[] }[];
}
type MobileResults = Record<string, Record<string, { maxAt60fps: number; counts: Record<string, number[]> }>>;

/** "ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Laptop GPU (0x2D59) Direct3D11 vs_5_0 ps_5_0, D3D11)" → "NVIDIA GeForce RTX 5060 Laptop GPU" */
export const shortGpu = (gpu = "") =>
  gpu
    .replace(/^ANGLE \([^,]+, /, "")
    .replace(/ \(0x[0-9A-Fa-f]+\)/, "")
    .replace(/ Direct3D\S* vs_\S+ ps_\S+/, "")
    .replace(/,? ?D3D\d+\)?$/, "")
    .replace(/, [^,]*\)$/, "")
    .replace(/\)$/, "");

/** A run.mjs results file (one scene). */
export function fromRunner(r: RunnerReport): ChartScene {
  return {
    scene: r.scene,
    subtitle: `${shortGpu(r.environment.gpu)} · ${r.environment.browser ?? ""} · ${r.rounds} rounds`,
    series: r.results.map((a) => ({
      adapter: a.adapter,
      label: a.label,
      maxAt60fps: a.maxAt60fps,
      points: a.counts.map((c) => ({ count: c.count, ms: c.frameMs, min: c.minFrameMs, max: c.maxFrameMs })),
    })),
  };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? (s[(s.length - 1) / 2] as number) : ((s[s.length / 2 - 1] as number) + (s[s.length / 2] as number)) / 2;
};

/** A mobile.html results file (every scene), with adapter labels by id. */
export function fromMobile(results: MobileResults, labels: Record<string, string>, subtitle: string): ChartScene[] {
  return Object.entries(results)
    .sort(([a], [b]) => SCENE_ORDER.indexOf(a) - SCENE_ORDER.indexOf(b))
    .map(([scene, byAdapter]) => ({
      scene,
      subtitle,
      series: Object.entries(byAdapter).map(([adapter, e]) => ({
        adapter,
        label: labels[adapter] ?? adapter,
        maxAt60fps: e.maxAt60fps,
        points: Object.entries(e.counts)
          .map(([count, ms]) => ({ count: Number(count), ms: median(ms), ...(ms.length > 1 ? { min: Math.min(...ms), max: Math.max(...ms) } : {}) }))
          .sort((a, b) => a.count - b.count),
      })),
    }));
}

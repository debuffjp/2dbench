// Community results page: every results file in the repo, bundled at build time, one table per scene.
// A merged pull request rebuilds GitHub Pages, so new submissions appear without anything else running.

interface RunnerResult {
  date: string;
  scene: string;
  rounds: number;
  environment: { gpu?: string; browser?: string; note?: string };
  submission?: { device?: string };
  results: { adapter: string; maxAt60fps: number; counts: { count: number; frameMs: number }[] }[];
}
interface MobileResult {
  date: string;
  rounds: number;
  environment: { gpu?: string; userAgent?: string; note?: string };
  submission?: { device?: string };
  results: Record<string, Record<string, { maxAt60fps: number; counts: Record<string, number[]> }>>;
}

/** One device's numbers for one scene, from either file format. */
interface Row {
  device: string;
  platform: string;
  date: string;
  rounds: number;
  file: string;
  byAdapter: Record<string, { max: number; at50k?: number }>;
}

const files = import.meta.glob("../results/**/*.json", { eager: true, import: "default" }) as Record<string, RunnerResult | MobileResult>;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? (s[(s.length - 1) / 2] as number) : ((s[s.length / 2 - 1] as number) + (s[s.length / 2] as number)) / 2;
};
const browserOf = (ua = "") =>
  /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "browser";
const deviceOf = (r: RunnerResult | MobileResult) =>
  r.submission?.device || r.environment.note?.split(",")[0] || ("gpu" in r.environment ? r.environment.gpu : "") || "unknown";

const byScene: Record<string, Row[]> = {};
for (const [path, r] of Object.entries(files)) {
  const file = path.replace("../", "");
  if (Array.isArray(r.results)) {
    const rr = r as RunnerResult;
    // "ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Laptop GPU (0x2D59) Direct3D11 vs_5_0 ps_5_0, D3D11)" → "NVIDIA GeForce RTX 5060 Laptop GPU, D3D11"
    const gpu = (rr.environment.gpu ?? "")
      .replace(/^ANGLE \([^,]+, /, "")
      .replace(/ \(0x[0-9A-Fa-f]+\)/, "")
      .replace(/ Direct3D\S* vs_\S+ ps_\S+/, "")
      .replace(/\)$/, "");
    (byScene[rr.scene] ??= []).push({
      device: deviceOf(rr),
      platform: `${rr.environment.browser ?? ""} · ${gpu}`,
      date: rr.date.slice(0, 10),
      rounds: rr.rounds,
      file,
      byAdapter: Object.fromEntries(rr.results.map((a) => [a.adapter, { max: a.maxAt60fps, at50k: a.counts.find((c) => c.count === 50_000)?.frameMs }])),
    });
  } else {
    const mr = r as MobileResult;
    for (const [scene, adapters] of Object.entries(mr.results)) {
      (byScene[scene] ??= []).push({
        device: deviceOf(mr),
        platform: `${browserOf(mr.environment.userAgent)} · ${mr.environment.gpu ?? ""}`,
        date: mr.date.slice(0, 10),
        rounds: mr.rounds,
        file,
        byAdapter: Object.fromEntries(
          Object.entries(adapters).map(([id, e]) => [id, { max: e.maxAt60fps, at50k: e.counts["50000"] ? median(e.counts["50000"]) : undefined }]),
        ),
      });
    }
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
let html = "";
for (const scene of ["bunny", "mixed", "particles", "raycaster"]) {
  const rows = byScene[scene] ?? [];
  if (!rows.length) continue;
  const adapters = [...new Set(rows.flatMap((r) => Object.keys(r.byAdapter)))].sort();
  html += `<h2>${scene}</h2><p class="dim">Most sprites at 60 fps, then the median frame at 50k sprites (ms). Higher count, lower ms is better. ${rows.length} device${rows.length === 1 ? "" : "s"}.</p>`;
  html += `<div class="scroll"><table><tr><th>Device</th><th>Browser · GPU</th>${adapters.map((a) => `<th>${esc(a)}</th>`).join("")}<th>Rounds</th><th>Data</th></tr>`;
  for (const r of rows.sort((a, b) => a.device.localeCompare(b.device))) {
    html += `<tr><td>${esc(r.device)}</td><td class="dim">${esc(r.platform)}</td>`;
    for (const a of adapters) {
      const e = r.byAdapter[a];
      html += e ? `<td>${e.max.toLocaleString("en")}<br><small>${e.at50k === undefined ? "–" : `${e.at50k.toFixed(1)} ms`}</small></td>` : "<td>–</td>";
    }
    html += `<td>${r.rounds}</td><td><a href="https://github.com/debuffjp/2dbench/blob/main/${esc(r.file)}">json</a></td></tr>`;
  }
  html += "</table></div>";
}
(document.getElementById("tables") as HTMLElement).innerHTML = html || "<p>No results yet.</p>";

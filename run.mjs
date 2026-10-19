// 2dbench runner: builds the page, checks every adapter draws the same pixels as the reference, then times
// each adapter over interleaved rounds and saves results/<date>-<platform>-<scene>.json.
//   node run.mjs                         bunny scene, every adapter that supports it, 3 rounds
//   node run.mjs particles rounds=5      another scene, more rounds
//   node run.mjs mixed spryte pixi-sprite
//   NOTE="Pixel 7, battery saver off" node run.mjs     anything the runner can't detect
//   PARITY_DUMP=1 node run.mjs particles               write parity frames and diffs to results/parity/
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, release, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { build, preview } from "vite";

const root = dirname(fileURLToPath(import.meta.url));
const SCENE_IDS = ["bunny", "mixed", "particles"];
const scene = SCENE_IDS.find((s) => process.argv.includes(s)) ?? "bunny";
// 5 rounds by default: the variance study (METHOD.md, Statistics) found 3 can miss the ratio by 10–15%.
const rounds = Number(process.argv.find((a) => a.startsWith("rounds="))?.slice(7) ?? 5);
const COUNTS = [1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 200_000, 400_000, 800_000, 1_600_000];
// Every adapter is measured at these counts in every round, even past the 60 fps budget.
const PUBLISHED = [10_000, 50_000, 200_000];
const BUDGET_MS = 1000 / 60;
const PARITY_COUNTS = [2_000, 50_000];
const PARITY_TOLERANCE = 8;
const COVERAGE_RANGE = [99.5, 100.5];
const MAX_INTERIOR_PERCENT = 0.5;
const W = 960;
const H = 540;

const version = (pkg) => {
  try {
    return JSON.parse(readFileSync(join(root, "node_modules", pkg, "package.json"), "utf8")).version;
  } catch {
    return "unknown";
  }
};
const sh = (cmd) => {
  try {
    return execSync(cmd, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};

/** Power source and plan, read from the OS where we know how (Windows), since laptops throttle on battery. */
function power() {
  if (process.platform !== "win32") return "not detected on this OS; add it to NOTE";
  const status = sh('powershell -NoProfile -Command "(Get-CimInstance Win32_Battery).BatteryStatus"');
  const source = status === "" ? "no battery (desktop)" : status === "2" ? "AC power" : `battery (status ${status})`;
  const plan = sh("powercfg /getactivescheme").match(/\(([^)]+)\)/)?.[1] ?? "unknown plan";
  return `${source}, power plan ${plan}`;
}

/**
 * Compare a frame with the reference's. Coverage: drawn area relative to the reference (skipped or culled
 * sprites show here). Interior: differing pixels whose 3×3 neighbourhood is flat in both frames. Any edge,
 * even a sprite over another sprite, breaks flatness, so rounding rules that move edges don't count; a wrong
 * tint, alpha or texture inside a sprite does.
 */
function compare(ref, px) {
  const diff = (a, b, i, j = i) => Math.max(Math.abs(a[i] - b[j]), Math.abs(a[i + 1] - b[j + 1]), Math.abs(a[i + 2] - b[j + 2]));
  const flat = (b, x, y) => {
    const c = (y * W + x) * 4;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (diff(b, b, ((y + dy) * W + x + dx) * 4, c) > PARITY_TOLERANCE) return false;
    return true;
  };
  const bg = (b, i) => b[i] === 0x11 && b[i + 1] === 0x14 && b[i + 2] === 0x0d;
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
  const pct = (n, d) => (d ? +((100 * n) / d).toFixed(2) : 0);
  return {
    drawnPixels: drawn,
    differingPercent: pct(differ, drawn),
    coveragePercent: refOwn ? +((100 * own) / refOwn).toFixed(1) : 0,
    interiorDifferingPercent: pct(interior, drawn),
  };
}

await build({ root, logLevel: "error" });
const server = await preview({ root, preview: { port: 0 }, logLevel: "error" });
const base = server.resolvedUrls.local[0];
// BROWSER_ARGS: extra Chrome flags, e.g. software WebGL in CI ("--enable-unsafe-swiftshader").
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "chrome", args: process.env.BROWSER_ARGS?.split(" ").filter(Boolean) ?? [] });

async function dump(name, px, ref) {
  const dir = join(root, "results", "parity");
  mkdirSync(dir, { recursive: true });
  const marked = Buffer.from(px);
  for (let i = 0; i < px.length; i += 4) {
    const d = Math.max(Math.abs(ref[i] - px[i]), Math.abs(ref[i + 1] - px[i + 1]), Math.abs(ref[i + 2] - px[i + 2]));
    marked.set(d > PARITY_TOLERANCE ? [255, 0, 0, 255] : [px[i] >> 2, px[i + 1] >> 2, px[i + 2] >> 2, 255], i);
  }
  const page = await browser.newPage();
  for (const [file, data] of [
    [name, px],
    [`${name}-diff`, marked],
  ]) {
    const url = await page.evaluate(
      ({ b64 }) => {
        const c = document.createElement("canvas");
        c.width = 960;
        c.height = 540;
        c.getContext("2d").putImageData(new ImageData(Uint8ClampedArray.from(atob(b64), (ch) => ch.charCodeAt(0)), 960, 540), 0, 0);
        return c.toDataURL("image/png");
      },
      { b64: data.toString("base64") },
    );
    writeFileSync(join(dir, `${scene}-${file}.png`), Buffer.from(url.split(",")[1], "base64"));
  }
  await page.close();
}

const open = async (adapter) => {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on("pageerror", (e) => console.error(`  ${adapter}: ${e.message}`));
  await page.goto(`${base}?adapter=${adapter}&scene=${scene}`);
  await page.waitForFunction(() => window.__bench?.ready === true, undefined, { timeout: 30_000 });
  return page;
};

let list;
let gpu = "unknown";
const parity = {};
const samples = {};
let adapters = [];
try {
  // Which adapters exist and what they support comes from the page, so adding one never touches this file.
  const lister = await browser.newPage();
  await lister.goto(`${base}?list`);
  list = await lister.waitForFunction(() => window.__list).then((h) => h.jsonValue());
  gpu = await lister.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
  });
  await lister.close();
  const chosen = process.argv.slice(2).filter((a) => list.some((x) => x.id === a));
  const reference = list[0].id;
  adapters = list.filter((a) => a.scenes.includes(scene) && (!chosen.length || chosen.includes(a.id) || a.id === reference)).map((a) => a.id);
  for (const a of adapters) samples[a] = {};

  // 1. Parity gate: every adapter draws the same seeded frames as the reference.
  const snaps = {};
  for (const a of adapters) {
    snaps[a] = {};
    for (const count of PARITY_COUNTS) {
      const page = await open(a);
      const snap = await page.evaluate((n) => window.__bench.snapshot(n), count);
      snaps[a][count] = Buffer.from(snap.rgba, "base64");
      await page.close();
    }
  }
  const failures = [];
  for (const a of adapters) {
    parity[a] = {};
    for (const count of PARITY_COUNTS) {
      const p = compare(snaps[reference][count], snaps[a][count]);
      parity[a][count] = p;
      if (process.env.PARITY_DUMP) await dump(`${a}-${count}`, snaps[a][count], snaps[reference][count]);
      const ok = p.coveragePercent >= COVERAGE_RANGE[0] && p.coveragePercent <= COVERAGE_RANGE[1] && p.interiorDifferingPercent <= MAX_INTERIOR_PERCENT;
      if (!ok) failures.push(`${a} at ${count}`);
      console.log(
        `parity ${ok ? "ok  " : "FAIL"} ${a.padEnd(16)} ${String(count).padStart(6)}: coverage ${p.coveragePercent}%, ${p.differingPercent}% of drawn pixels differ (${p.interiorDifferingPercent}% inside sprites)`,
      );
    }
  }
  if (failures.length) throw new Error(`Parity failed (${failures.join(", ")}): these adapters don't draw the same scene, so timings aren't comparable.`);

  // 2. Timing, interleaved: each round rotates the order so heat and ordering spread evenly.
  const lastPublished = Math.max(...PUBLISHED);
  for (let round = 0; round < rounds; round++) {
    const order = adapters.map((_, i) => adapters[(i + round) % adapters.length]);
    for (const a of order) {
      const page = await open(a);
      let over = false;
      for (const count of COUNTS) {
        if (over && (count > lastPublished || !PUBLISHED.includes(count))) {
          if (count > lastPublished) break;
          continue;
        }
        const r = await page.evaluate((n) => window.__bench.measure(n), count);
        samples[a][count] ??= [];
        samples[a][count].push(r);
        if (r.frameMs > BUDGET_MS) over = true;
      }
      await page.close();
      console.log(`  round ${round + 1}/${rounds} ${a}`);
    }
  }
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}

if (rounds === 0) {
  // Parity only (CI, or a quick check while writing an adapter): nothing timed, so nothing to save.
  console.log("\nParity passed for every adapter. rounds=0, so no timing and no results file.");
  process.exit(0);
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const results = adapters.map((id) => {
  const meta = list.find((a) => a.id === id);
  const counts = Object.entries(samples[id])
    .map(([count, runs]) => {
      const frame = runs.map((r) => r.frameMs);
      return {
        count: Number(count),
        runs: runs.length,
        frameMs: median(frame),
        minFrameMs: Math.min(...frame),
        maxFrameMs: Math.max(...frame),
        p95FrameMs: median(runs.map((r) => r.p95FrameMs)),
        submitMs: median(runs.map((r) => r.submitMs)),
        // Every round's median frame, in round order, so anyone can redo the statistics.
        roundsFrameMs: frame.map((v) => +v.toFixed(3)),
      };
    })
    .sort((a, b) => a.count - b.count);
  // Largest ladder step measured in every round whose median frame fits the budget (steps are up to 2× apart).
  let maxAt60fps = 0;
  for (const c of counts) if (c.runs === rounds && c.frameMs <= BUDGET_MS) maxAt60fps = c.count;
  return { adapter: id, label: meta.label, package: meta.package, version: meta.package ? version(meta.package) : "", setup: meta.setup, maxAt60fps, parity: parity[id], counts };
});

const report = {
  date: new Date().toISOString(),
  scene,
  rounds,
  environment: {
    gpu,
    browser: `Chrome ${browser.version()}`,
    os: `${process.platform} ${release()} ${process.arch}`,
    cpu: cpus()[0]?.model.trim() ?? "unknown",
    memoryGB: Math.round(totalmem() / 2 ** 30),
    power: power(),
    note: process.env.NOTE ?? "",
    // "modified": the run used uncommitted changes, so the commit alone doesn't reproduce it.
    commit: `${sh("git rev-parse --short HEAD") || "uncommitted"}${sh("git status --porcelain -- run.mjs src index.html package.json") ? ", modified" : ""}`,
  },
  method: {
    budgetMs: BUDGET_MS,
    framesPerCount: 100,
    warmupFrames: 20,
    publishedCounts: PUBLISHED,
    timing: "simulation through GPU completion (1-pixel readback); median per count per round, then median across rounds",
    parity: { counts: PARITY_COUNTS, tolerance: PARITY_TOLERANCE, reference: adapters[0], gate: { coveragePercent: COVERAGE_RANGE, maxInteriorDifferingPercent: MAX_INTERIOR_PERCENT } },
  },
  results,
};
mkdirSync(join(root, "results"), { recursive: true });
const file = join(root, "results", `${report.date.slice(0, 10)}-${process.platform}-${scene}.json`);
writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);

const cell = (r, n) => {
  const c = r.counts.find((x) => x.count === n);
  // † marks frames under 2 ms, where browser timer resolution makes rounds vary by 20–35% (METHOD.md, Statistics).
  return c ? `${c.frameMs.toFixed(1)} ms (${c.minFrameMs.toFixed(1)}–${c.maxFrameMs.toFixed(1)})${c.frameMs < 2 ? " †" : ""}` : "n/a";
};
console.log(`\n${scene}: ${rounds} rounds · ${gpu} · ${report.environment.browser} · ${report.environment.cpu} · ${report.environment.power}\n`);
console.log(`| Adapter | Version | Max @60fps | ${PUBLISHED.map((n) => `${n / 1000}k`).join(" | ")} |`);
console.log(`| --- | --- | --- | ${PUBLISHED.map(() => "---").join(" | ")} |`);
for (const r of results) console.log(`| ${r.label} | ${r.version || "-"} | ${r.maxAt60fps.toLocaleString("en")} | ${PUBLISHED.map((n) => cell(r, n)).join(" | ")} |`);
console.log("\n† under 2 ms per frame: low precision, compare with care.");
console.log(`Saved ${file}`);

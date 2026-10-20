// 2dbench runner: builds the page, checks every adapter draws the same pixels as the reference, then times
// each adapter over interleaved rounds and saves results/<date>-<platform>-<scene>.json.
//   node run.mjs                         bunny scene, every adapter that supports it, 5 rounds
//   node run.mjs particles rounds=5      another scene, more rounds
//   node run.mjs mixed spryte pixi-sprite
//   NOTE="Pixel 7, battery saver off" node run.mjs     anything the runner can't detect
//   PARITY_DUMP=1 node run.mjs particles               write parity frames and diffs to results/parity/
//   HEADED=1 node run.mjs                              visible browser window (Linux: headless falls back to SwiftShader)
//   node run.mjs --list                                scenes, adapters and GPU as JSON; nothing is run
//   node run.mjs raycaster rounds=0 --json             parity only; progress on stderr, one JSON summary on stdout
//   node run.mjs --help
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, release, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { build, preview } from "vite";
// The gate itself is shared with mobile.html, so phones and desktops judge frames by the same rules.
import { compare, GATE, PARITY_COUNTS, PARITY_TOLERANCE, passes } from "./src/parity.ts";

const root = dirname(fileURLToPath(import.meta.url));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
if (flags.has("--help")) {
  // The usage lines at the top of this file are the help text.
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n");
  console.log(lines.slice(2, lines.findIndex((l) => l.startsWith("import"))).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(0);
}
// --json: stdout carries exactly one JSON document (for agents and scripts); progress goes to stderr.
const JSON_OUT = flags.has("--json");
const out = console.log;
if (JSON_OUT) console.log = (...a) => console.error(...a);
const SCENE_IDS = ["bunny", "mixed", "particles", "raycaster", "tilemap", "churn", "text", "lowres", "clip", "upload"];
const scene = SCENE_IDS.find((s) => process.argv.includes(s)) ?? "bunny";
// 5 rounds by default: the variance study (METHOD.md, Statistics) found 3 can miss the ratio by 10–15%.
const rounds = Number(process.argv.find((a) => a.startsWith("rounds="))?.slice(7) ?? 5);
const COUNTS = [1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 200_000, 400_000, 800_000, 1_600_000];
// Every adapter is measured at these counts in every round, even past the 60 fps budget.
const PUBLISHED = [10_000, 50_000, 200_000];
const BUDGET_MS = 1000 / 60;
/** GPU strings of software renderers. */
const SOFTWARE = /SwiftShader|llvmpipe|softpipe|Microsoft Basic Render/i;
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

await build({ root, logLevel: "error" });
const server = await preview({ root, preview: { port: 0 }, logLevel: "error" });
const base = server.resolvedUrls.local[0];
// BROWSER_ARGS: extra Chrome flags, e.g. software WebGL in CI ("--enable-unsafe-swiftshader").
// HEADED: launch a visible window. On Linux, headless Chrome renders with SwiftShader whatever the GPU flags,
// so the GPU string reads "SwiftShader" and timings are software; a visible window gets the real GPU.
const browser = await chromium.launch({ headless: !process.env.HEADED, channel: process.env.BROWSER_CHANNEL ?? "chrome", args: process.env.BROWSER_ARGS?.split(" ").filter(Boolean) ?? [] });

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
let sceneGate = null;
const parity = {};
const samples = {};
const startups = {};
const contextLoss = {};
let adapters = [];
try {
  // Which adapters exist and what they support comes from the page, so adding one never touches this file.
  const lister = await browser.newPage();
  await lister.goto(`${base}?list`);
  list = await lister.waitForFunction(() => window.__list).then((h) => h.jsonValue());
  // A scene may declare its own gate (text: glyph rasterisation differs by library). It's recorded with results.
  sceneGate = (await lister.evaluate(() => window.__gates))[scene] ?? null;
  gpu = await lister.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
  });
  await lister.close();
  const known = (a) => a.startsWith("--") || a.startsWith("rounds=") || SCENE_IDS.includes(a) || list.some((x) => x.id === a);
  const unknown = process.argv.slice(2).filter((a) => !known(a));
  if (unknown.length)
    throw new Error(`Unknown argument: ${unknown.join(", ")}. Scenes: ${SCENE_IDS.join(", ")}. Adapters: ${list.map((x) => x.id).join(", ")}. Try --help.`);
  if (flags.has("--list")) {
    out(JSON.stringify({ scenes: SCENE_IDS, adapters: list, gpu, softwareRendering: SOFTWARE.test(gpu) }, null, 2));
    await browser.close();
    await new Promise((r) => server.httpServer.close(r));
    process.exit(0);
  }
  const chosen = process.argv.slice(2).filter((a) => list.some((x) => x.id === a));
  const reference = list[0].id;
  adapters = list.filter((a) => a.scenes.includes(scene) && (!chosen.length || chosen.includes(a.id) || a.id === reference)).map((a) => a.id);
  for (const a of adapters) {
    samples[a] = {};
    startups[a] = [];
  }

  // Software rendering (SwiftShader, llvmpipe) makes timings meaningless. Parity still checks fine on it (CI
  // does exactly that), but a timed run is refused unless explicitly allowed. On Linux, try HEADED=1.
  if (rounds > 0 && SOFTWARE.test(gpu) && !process.env.ALLOW_SOFTWARE)
    throw new Error(
      `The GPU is software-rendered (${gpu}), so timings would measure the CPU emulating a GPU. On Linux, run with HEADED=1 (headless Chromium falls back to SwiftShader). To time it anyway, set ALLOW_SOFTWARE=1; the result is marked as software.`,
    );

  // 1. Parity gate: every adapter draws the same seeded frames as the reference.
  const snaps = {};
  for (const a of adapters) {
    snaps[a] = {};
    for (const count of sceneGate?.counts ?? PARITY_COUNTS) {
      const page = await open(a);
      const snap = await page.evaluate((n) => window.__bench.snapshot(n), count);
      snaps[a][count] = Buffer.from(snap.rgba, "base64");
      await page.close();
    }
  }
  const failures = [];
  for (const a of adapters) {
    parity[a] = {};
    for (const count of sceneGate?.counts ?? PARITY_COUNTS) {
      const p = compare(snaps[reference][count], snaps[a][count]);
      parity[a][count] = p;
      if (process.env.PARITY_DUMP) await dump(`${a}-${count}`, snaps[a][count], snaps[reference][count]);
      const ok = passes(p, sceneGate ?? undefined);
      if (!ok) failures.push(`${a} at ${count}`);
      console.log(
        `parity ${ok ? "ok  " : "FAIL"} ${a.padEnd(16)} ${String(count).padStart(6)}: coverage ${p.coveragePercent}%, ${p.differingPercent}% of drawn pixels differ (${p.interiorDifferingPercent}% inside sprites)`,
      );
    }
  }
  // Context loss: does each adapter draw the same frame again after the WebGL context is lost and restored?
  for (const a of adapters) {
    const page = await open(a);
    contextLoss[a] = await page.evaluate(() => window.__bench.contextLoss());
    await page.close();
    const c = contextLoss[a];
    console.log(`context  ${a.padEnd(16)} ${c === null ? "n/a (not WebGL)" : c.recovered ? `recovered in ${c.ms} ms` : `NOT recovered: ${c.reason}`}`);
  }
  if (failures.length) throw new Error(`Parity failed (${failures.join(", ")}): these adapters don't draw the same scene, so timings aren't comparable.`);

  // 2. Timing, interleaved: each round rotates the order so heat and ordering spread evenly.
  const lastPublished = Math.max(...PUBLISHED);
  for (let round = 0; round < rounds; round++) {
    const order = adapters.map((_, i) => adapters[(i + round) % adapters.length]);
    for (const a of order) {
      const page = await open(a);
      // Fresh page, so the first frame here is the adapter's real first frame.
      startups[a].push(await page.evaluate(() => window.__bench.startup()));
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
  if (JSON_OUT) out(JSON.stringify({ scene, gpu, parity: "passed", adapters, details: parity, contextLoss }, null, 2));
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
        // The shared simulation's part of frameMs: identical work for every adapter.
        simMs: median(runs.map((r) => r.simMs)),
        // JS heap after this count's frames, per round (Chrome's coarse counter), to show growth over a run.
        roundsHeapMB: runs.map((r) => r.heapMB),
        // Every round's median frame, in round order, so anyone can redo the statistics.
        roundsFrameMs: frame.map((v) => +v.toFixed(3)),
      };
    })
    .sort((a, b) => a.count - b.count);
  // Largest ladder step measured in every round whose median frame fits the budget (steps are up to 2× apart).
  let maxAt60fps = 0;
  for (const c of counts) if (c.runs === rounds && c.frameMs <= BUDGET_MS) maxAt60fps = c.count;
  const st = startups[id];
  const startup = { readyMs: median(st.map((s) => s.readyMs)), createMs: median(st.map((s) => s.createMs)), firstFrameMs: median(st.map((s) => s.firstFrameMs)), rounds: st };
  return { adapter: id, label: meta.label, package: meta.package, version: meta.package ? version(meta.package) : "", setup: meta.setup, maxAt60fps, startup, contextLoss: contextLoss[id] ?? null, parity: parity[id], counts };
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
    // Headed runs show a browser window; on Linux that's what gets the real GPU.
    headless: !process.env.HEADED,
    softwareRendering: SOFTWARE.test(gpu),
    note: process.env.NOTE ?? "",
    // "modified": the run used uncommitted changes, so the commit alone doesn't reproduce it.
    commit: `${sh("git rev-parse --short HEAD") || "uncommitted"}${sh("git status --porcelain -- run.mjs src index.html package.json") ? ", modified" : ""}`,
  },
  method: {
    budgetMs: BUDGET_MS,
    framesPerCount: 100,
    warmupFrames: 20,
    publishedCounts: PUBLISHED,
    timing: "simulation through GPU completion (1-pixel readback); median per count per round, then median across rounds. simMs is the shared simulation's part.",
    startup: "fresh page per round: readyMs since navigation, createMs for adapter setup (lazy library import included), firstFrameMs for the first 1,000-sprite frame through GPU completion",
    parity: { ...GATE, ...(sceneGate ? { gate: sceneGate } : {}), reference: adapters[0] },
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
console.log(`| Adapter | Version | Max @60fps | ${PUBLISHED.map((n) => `${n / 1000}k`).join(" | ")} | Ready | First frame |`);
console.log(`| --- | --- | --- | ${PUBLISHED.map(() => "---").join(" | ")} | --- | --- |`);
for (const r of results)
  console.log(
    `| ${r.label} | ${r.version || "-"} | ${r.maxAt60fps.toLocaleString("en")} | ${PUBLISHED.map((n) => cell(r, n)).join(" | ")} | ${r.startup.readyMs.toFixed(0)} ms | ${r.startup.firstFrameMs.toFixed(1)} ms |`,
  );
console.log("\n† under 2 ms per frame: low precision, compare with care.");
console.log(`Saved ${file}`);
if (JSON_OUT) {
  const ms = (r) => Object.fromEntries(PUBLISHED.map((n) => [n, r.counts.find((c) => c.count === n)?.frameMs ?? null]));
  const summary = results.map((r) => ({ adapter: r.adapter, label: r.label, version: r.version, maxAt60fps: r.maxAt60fps, ms: ms(r), startup: { readyMs: r.startup.readyMs, firstFrameMs: r.startup.firstFrameMs } }));
  out(JSON.stringify({ file, scene, rounds, gpu, parity: "passed", results: summary }, null, 2));
}

// Self-running benchmark for phones and tablets: the same page run.mjs drives, run from inside the browser.
// Each adapter runs in a fresh iframe (a fresh GPU context); results show in a table and copy as JSON.
// There's no parity check here (phones can't easily ship frames back); desktop runs carry the parity gate.
import "./site.css";
import { ADAPTERS } from "./adapters/index.js";
import { fromMobile, frameChart, maxChart, shortGpu } from "./charts.js";
import { SCENES as SCENE_SPECS } from "./scenes.js";

/** Every scene, with the adapters that support it. */
const SCENES: Record<string, string[]> = Object.fromEntries(
  Object.values(SCENE_SPECS).map((scene) => [
    scene.id,
    ADAPTERS.filter((a) => a.supports(scene)).map((a) => a.id),
  ]),
);
const LABELS: Record<string, string> = Object.fromEntries(ADAPTERS.map((a) => [a.id, a.label]));
const COUNTS = [1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 200_000, 400_000, 800_000];
const BUDGET = 1000 / 60;
const FRAMES = 60;

interface Measure {
  count: number;
  frameMs: number;
  p95FrameMs: number;
  submitMs: number;
}
interface Bench {
  ready: boolean;
  measure(count: number, frames?: number): Promise<Measure>;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const say = (text: string) => {
  $("status").textContent = text;
};

/**
 * The smallest step performance.now() takes here. Browsers coarsen timers against fingerprinting:
 * Chrome on desktop about 0.1 ms; WebKit (every iOS browser) 1 ms. Frames near the step are imprecise.
 */
function timerResolutionMs(): number {
  let smallest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 50; i++) {
    const t0 = performance.now();
    let t1 = t0;
    while (t1 === t0) t1 = performance.now();
    smallest = Math.min(smallest, t1 - t0);
  }
  return +smallest.toFixed(4);
}

function environment() {
  const gl = document.createElement("canvas").getContext("webgl2");
  const ext = gl?.getExtension("WEBGL_debug_renderer_info");
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: navigator.userAgent,
    gpu: ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : gl ? "webgl2 (renderer hidden)" : "no webgl2",
    devicePixelRatio,
    screen: `${screen.width}×${screen.height}`,
    cores: navigator.hardwareConcurrency,
    timerResolutionMs: timerResolutionMs(),
    memoryGB: nav.deviceMemory ?? null,
    note: $<HTMLInputElement>("note").value,
  };
}

async function battery(): Promise<string> {
  const nav = navigator as Navigator & { getBattery?: () => Promise<{ charging: boolean; level: number }> };
  if (!nav.getBattery) return "not exposed by this browser";
  const b = await nav.getBattery();
  return `${b.charging ? "charging" : "on battery"}, ${Math.round(b.level * 100)}%`;
}

/** Load the bench page for one renderer in a fresh iframe and return its bench API. */
async function open(renderer: string, scene: string): Promise<{ bench: Bench; close: () => void }> {
  const frame = document.createElement("iframe");
  frame.src = `./index.html?adapter=${renderer}&scene=${scene}`;
  $("stage").append(frame);
  const started = performance.now();
  for (;;) {
    const bench = (frame.contentWindow as (Window & { __bench?: Bench }) | null)?.__bench;
    if (bench?.ready) return { bench, close: () => frame.remove() };
    if (performance.now() - started > 30_000) throw new Error(`${renderer} didn't load (no WebGL2?)`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? (s[(s.length - 1) / 2] as number) : ((s[s.length / 2 - 1] as number) + (s[s.length / 2] as number)) / 2;
};

let report: unknown;

async function run(): Promise<void> {
  const rounds = $<HTMLInputElement>("quick").checked ? 1 : 3;
  $<HTMLButtonElement>("run").disabled = true;
  $<HTMLButtonElement>("copy").disabled = true;
  $<HTMLButtonElement>("send").disabled = true;
  $<HTMLButtonElement>("submit").disabled = true;
  $<HTMLButtonElement>("anon").disabled = true;
  $("results").innerHTML = "";
  $("charts").innerHTML = "";
  $("done").hidden = true;
  const bar = $("bar");
  (bar.parentElement as HTMLElement).hidden = false;
  const total = Object.values(SCENES).reduce((n, r) => n + r.length * rounds, 0);
  let step = 0;
  const startBattery = await battery();
  const results: Record<string, Record<string, { maxAt60fps: number; counts: Record<number, number[]> }>> = {};
  try {
    for (const [scene, renderers] of Object.entries(SCENES)) {
      results[scene] = {};
      for (let round = 0; round < rounds; round++) {
        // Rotate the order each round so heat and ordering spread evenly.
        const order = renderers.map((_, i) => renderers[(i + round) % renderers.length] as string);
        for (const renderer of order) {
          say(`${scene} · ${LABELS[renderer] ?? renderer} · round ${round + 1}/${rounds}`);
          bar.style.width = `${(100 * step++) / total}%`;
          results[scene][renderer] ??= { maxAt60fps: 0, counts: {} };
          const entry = results[scene][renderer];
          let page: Awaited<ReturnType<typeof open>>;
          try {
            page = await open(renderer, scene);
          } catch (e) {
            say(String(e));
            continue;
          }
          for (const count of COUNTS) {
            const m = await page.bench.measure(count, FRAMES);
            entry.counts[count] ??= [];
            entry.counts[count].push(m.frameMs);
            if (m.frameMs > BUDGET) break;
          }
          page.close();
        }
      }
      for (const entry of Object.values(results[scene])) {
        for (const [count, frames] of Object.entries(entry.counts))
          if (frames.length === rounds && median(frames) <= BUDGET) entry.maxAt60fps = Math.max(entry.maxAt60fps, Number(count));
      }
      show(results);
    }
    report = {
      date: new Date().toISOString(),
      rounds,
      framesPerCount: FRAMES,
      environment: { ...environment(), battery: { start: startBattery, end: await battery() } },
      results,
    };
    bar.style.width = "100%";
    say("Done. Your charts are below; tap Submit to add them to the public dataset.");
    const env = environment();
    const subtitle = `${$<HTMLInputElement>("note").value || "this device"} · ${shortGpu(env.gpu)} · ${rounds} round${rounds === 1 ? "" : "s"}`;
    const scenes = fromMobile(results, LABELS, subtitle);
    $("charts").innerHTML = [maxChart(scenes, "Most sprites at 60 fps on this device"), ...scenes.map(frameChart)]
      .filter(Boolean)
      .map((svg) => `<div class="chart">${svg}</div>`)
      .join("");
    $("summary").textContent = subtitle;
    $("done").hidden = false;
    $("done").scrollIntoView({ behavior: "smooth" });
    $<HTMLButtonElement>("copy").disabled = false;
    $<HTMLButtonElement>("send").disabled = false;
    $<HTMLButtonElement>("submit").disabled = false;
    $<HTMLButtonElement>("anon").disabled = false;
  } finally {
    $<HTMLButtonElement>("run").disabled = false;
  }
}

function show(results: Record<string, Record<string, { maxAt60fps: number; counts: Record<number, number[]> }>>): void {
  const at = (e: { counts: Record<number, number[]> }, n: number) => (e.counts[n] ? `${median(e.counts[n]).toFixed(1)} ms` : "n/a");
  let html = "<tr><th>Scene</th><th>Renderer</th><th>Max @60fps</th><th>10k</th><th>50k</th></tr>";
  for (const [scene, byRenderer] of Object.entries(results))
    for (const [renderer, e] of Object.entries(byRenderer))
      html += `<tr><td>${scene}</td><td>${LABELS[renderer] ?? renderer}</td><td>${e.maxAt60fps.toLocaleString("en")}</td><td>${at(e, 10_000)}</td><td>${at(e, 50_000)}</td></tr>`;
  $("results").innerHTML = html;
}

/** A best guess at the device from the user agent, so the note starts filled in (people can correct it). */
function guessDevice(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "browser";
  const model = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad|Macintosh.*Mobile/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
      ? "iPad"
      : (/Android [\d.]+; ([^;)]+)/.exec(ua)?.[1]?.trim() ?? (/Windows/.test(ua) ? "Windows PC" : /Mac OS X/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "Chromebook" : /Linux/.test(ua) ? "Linux PC" : "device"));
  return `${model}, ${browser}`;
}
const noteInput = $<HTMLInputElement>("note");
if (!noteInput.value) noteInput.value = guessDevice();

$("run").addEventListener("click", () => {
  run().catch((e) => say(`Failed: ${e}`));
});
// No account needed: debuff.jp files the results issue for you (the same issue the GitHub form makes),
// and the intake workflow validates it and opens a pull request.
const ANON = "https://debuff.jp/api/2dbench/submit";
$("anon").addEventListener("click", async () => {
  const button = $<HTMLButtonElement>("anon");
  button.disabled = true;
  say("Submitting…");
  try {
    const res = await fetch(ANON, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device: $<HTMLInputElement>("note").value.trim(), report }) });
    const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !body.url) throw new Error(body.error ?? `HTTP ${res.status}`);
    $("status").innerHTML = `Thanks! Submitted: <a href="${body.url}" target="_blank" rel="noopener">${body.url.replace("https://github.com/", "")}</a>. It joins the dataset once checked.`;
  } catch (e) {
    button.disabled = false;
    say(`Couldn't submit (${e instanceof Error ? e.message : e}). Try Submit on GitHub instead.`);
  }
});

// Opens the results issue form, pre-filled. GitHub turns the issue into a pull request that adds the
// results to the dataset (.github/workflows/results-intake.yml). Long JSON doesn't fit in a URL, so then
// it's copied to the clipboard and the form opens for pasting.
const NEW_ISSUE = "https://github.com/debuffjp/2dbench/issues/new";
$("submit").addEventListener("click", async () => {
  const note = $<HTMLInputElement>("note").value.trim();
  const json = JSON.stringify(report);
  const params = new URLSearchParams({
    template: "results.yml",
    title: `Results: ${note || "my device"}`,
    device: note,
    conditions: navigator.userAgent,
  });
  const withJson = `${NEW_ISSUE}?${params}&json=${encodeURIComponent(json)}`;
  if (withJson.length <= 7500) {
    window.open(withJson, "_blank");
    say("Opened GitHub with your results filled in: check it and press Submit new issue.");
    return;
  }
  try {
    await navigator.clipboard.writeText(json);
    say("Your results are copied. GitHub is opening: paste them into Results JSON, then press Submit new issue.");
  } catch {
    say("Copy your results with Copy results below, then paste them into Results JSON on GitHub.");
  }
  window.open(`${NEW_ISSUE}?${params}`, "_blank");
});

// Served by `npm run phone`, the computer saves posted results to results/. Elsewhere there's no receiver,
// so the button only shows on a local or LAN address (the phone reaches the computer by its LAN IP).
const LOCAL = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\]$)|\.local$/.test(location.hostname);
if (!LOCAL) $("send").hidden = true;
$("send").addEventListener("click", async () => {
  try {
    const res = await fetch("./api/results", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(report) });
    if (!res.ok) throw new Error(String(res.status));
    const { saved } = (await res.json()) as { saved: string };
    say(`Saved on the computer: ${saved}`);
  } catch {
    say("No computer to send to here (this only works when the page is served by npm run phone). Use Copy results instead.");
  }
});

$("copy").addEventListener("click", async () => {
  const text = JSON.stringify(report, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    say("Copied.");
  } catch {
    // Some mobile browsers block the clipboard API; show the text to copy by hand instead.
    const area = document.createElement("textarea");
    area.value = text;
    area.style.width = "100%";
    area.rows = 12;
    document.body.append(area);
    area.select();
    say("Select and copy the text below.");
  }
});

// One adapter, one scene, on a fresh page: ?adapter=<id>&scene=<id>. Exposes window.__bench for the
// runner (node, run.mjs) and for mobile.html (in an iframe).
import { ADAPTERS } from "./adapters/index.js";
import { ChurnSim } from "./churn.js";
import { makeRaycasterAtlas, RaycasterSim } from "./raycaster.js";
import { makeTextures, SCENES, Simulation } from "./scenes.js";
import { ClipSim } from "./panels.js";
import { TextSim } from "./text.js";
import { UploadSim } from "./upload.js";
import { makeTilemapAtlas, TilemapSim } from "./tilemap.js";
import { HEIGHT, type Sim, WIDTH } from "./types.js";

const params = new URLSearchParams(location.search);
// The bare address (someone opened the shared link) goes to the self-running page.
if (!params.has("adapter") && !params.has("list")) {
  location.replace("mobile.html");
  throw new Error("redirecting to mobile.html");
}
// ?list: describe every adapter and what it supports, for the runner and reports.
if (params.has("list")) {
  (window as unknown as { __list: unknown }).__list = ADAPTERS.map((a) => ({
    id: a.id,
    label: a.label,
    package: a.package,
    setup: a.setup,
    scenes: Object.values(SCENES)
      .filter((s) => a.supports(s))
      .map((s) => s.id),
  }));
  (window as unknown as { __gates: unknown }).__gates = Object.fromEntries(Object.values(SCENES).map((s) => [s.id, s.gate ?? null]));
  throw new Error("listed");
}
const adapter = ADAPTERS.find((a) => a.id === params.get("adapter"));
const scene = SCENES[params.get("scene") ?? "bunny"];
if (!adapter || !scene) throw new Error(`Unknown adapter or scene: ${location.search}`);
if (!adapter.supports(scene)) throw new Error(`${adapter.id} doesn't support ${scene.id}`);

const canvas = document.querySelector("canvas") as HTMLCanvasElement;
canvas.width = WIDTH;
canvas.height = HEIGHT;
// Each scene brings its own simulation and textures; adapters see only the frame state and textures.
const sim: Sim =
  scene.id === "raycaster"
    ? new RaycasterSim()
    : scene.id === "tilemap"
      ? new TilemapSim()
      : scene.id === "churn"
        ? new ChurnSim()
        : scene.id === "text"
          ? new TextSim()
          : scene.clip
            ? new ClipSim(scene)
            : scene.upload
              ? new UploadSim(scene)
              : new Simulation(scene);
const textures = scene.id === "raycaster" ? [makeRaycasterAtlas()] : scene.id === "tilemap" ? [makeTilemapAtlas()] : makeTextures(scene);
// Upload scenes: the layer the simulation repaints goes last.
if (sim instanceof UploadSim) textures.push(sim.layer);
const createStart = performance.now();
const instance = await adapter.create(canvas, textures, scene);
const readyAt = performance.now();
const createMs = readyAt - createStart;

export interface Measure {
  count: number;
  /** Median frame, simulation through GPU completion. */
  frameMs: number;
  p95FrameMs: number;
  /** Median main-thread time before the GPU sync. */
  submitMs: number;
  /** Mean time in the shared simulation alone (a mean, since one step is often below timer resolution) (identical work for every adapter), inside frameMs. */
  simMs: number;
  /** JS heap in use after the frames, in MB (Chrome only; null elsewhere). */
  heapMB: number | null;
}

/** Chrome's non-standard heap counter. Coarse (bucketed) but enough to see growth over a run. */
const heapMB = () => {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? +(m.usedJSHeapSize / 2 ** 20).toFixed(1) : null;
};

/**
 * Render `frames` frames back to back at `count` sprites, after 20 warm-up frames. Each frame is timed
 * from simulation through GPU completion, so vsync and rAF pacing can't hide cost.
 */
async function measure(count: number, frames = 100): Promise<Measure> {
  sim.resize(count);
  for (let i = 0; i < 20; i++) {
    sim.step();
    instance.draw(sim.state);
    await instance.sync();
  }
  // Yield a task (not an animation frame: a hidden or background tab may never deliver one, which hung web runs).
  await new Promise((r) => setTimeout(r, 0));
  const total: number[] = [];
  const submit: number[] = [];
  const simulate: number[] = [];
  for (let i = 0; i < frames; i++) {
    const t0 = performance.now();
    sim.step();
    simulate.push(performance.now() - t0);
    instance.draw(sim.state);
    const t1 = performance.now();
    await instance.sync();
    total.push(performance.now() - t0);
    submit.push(t1 - t0);
  }
  const at = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))] ?? 0;
  return { count, frameMs: at(total, 0.5), p95FrameMs: at(total, 0.95), submitMs: at(submit, 0.5), simMs: +(simulate.reduce((a, b) => a + b, 0) / frames).toFixed(3), heapMB: heapMB() };
}

export interface Startup {
  /** Time since navigation when the adapter was ready (page load, library import and setup). */
  readyMs: number;
  /** adapter.create alone: library import (adapters import lazily), context and texture setup. */
  createMs: number;
  /** The first frame at 1,000 sprites, simulation through GPU completion: shader compiles, first texture uploads. */
  firstFrameMs: number;
}

/** Startup on a fresh page: call before anything else draws. */
async function startup(): Promise<Startup> {
  if (sim.state.count) throw new Error("startup() needs a fresh page");
  const readyMs = readyAt;
  const t0 = performance.now();
  sim.resize(1_000);
  sim.step();
  instance.draw(sim.state);
  await instance.sync();
  return { readyMs: +readyMs.toFixed(1), createMs: +createMs.toFixed(1), firstFrameMs: +(performance.now() - t0).toFixed(2) };
}

/**
 * Parity: on a fresh page, step the seeded scene `steps` times at `count` sprites, draw one frame and return
 * its pixels (RGBA, top row first, base64).
 */
function snapshot(count: number, steps = 10): { width: number; height: number; rgba: string } {
  if (sim.state.count) throw new Error("snapshot() needs a fresh page");
  sim.resize(count);
  for (let i = 0; i < steps; i++) sim.step();
  instance.draw(sim.state);
  const out = new Uint8Array(WIDTH * HEIGHT * 4);
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl"); // Phaser 4 uses WebGL1
  if (gl) {
    // Same task as the draw, so the drawing buffer hasn't been presented and cleared yet.
    const raw = new Uint8Array(out.length);
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    for (let y = 0; y < HEIGHT; y++) out.set(raw.subarray((HEIGHT - 1 - y) * WIDTH * 4, (HEIGHT - y) * WIDTH * 4), y * WIDTH * 4);
  } else out.set((canvas.getContext("2d") as CanvasRenderingContext2D).getImageData(0, 0, WIDTH, HEIGHT).data);
  let bin = "";
  for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode(...out.subarray(i, i + 0x8000));
  return { width: WIDTH, height: HEIGHT, rgba: btoa(bin) };
}

export interface ContextLoss {
  /** The adapter drew the same frame again after the context came back. */
  recovered: boolean;
  /** From restoreContext() to the first correct frame, polling once per animation frame. */
  ms: number | null;
  /** Why not, when it didn't. */
  reason?: string;
}

/**
 * Context loss (a backgrounded phone tab, a GPU reset): on a fresh page, draw a frame, lose and restore the
 * WebGL context, then redraw the same state each animation frame until the pixels match again (2 s cap).
 * Null for adapters that don't use WebGL.
 */
async function contextLoss(count = 2_000): Promise<ContextLoss | null> {
  if (sim.state.count) throw new Error("contextLoss() needs a fresh page");
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl"); // Phaser 4 uses WebGL1
  const ext = gl?.getExtension("WEBGL_lose_context");
  if (!gl || !ext) return null;
  sim.resize(count);
  sim.step();
  const read = () => {
    const px = new Uint8Array(WIDTH * HEIGHT * 4);
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  instance.draw(sim.state);
  const ref = read();
  // Restoring only works if someone called preventDefault on "webglcontextlost" (the library's job), so
  // each wait gives up after 2 s.
  const event = (name: string) =>
    Promise.race([new Promise<boolean>((r) => canvas.addEventListener(name, () => r(true), { once: true })), new Promise<boolean>((r) => setTimeout(() => r(false), 2_000))]);
  const lost = event("webglcontextlost");
  ext.loseContext();
  await lost;
  // Restoring during the lost event's dispatch is ignored; wait a task.
  await new Promise((r) => setTimeout(r, 0));
  const restored = event("webglcontextrestored");
  const t0 = performance.now();
  ext.restoreContext();
  if (!(await restored)) return { recovered: false, ms: null, reason: "context never restored (nobody called preventDefault on webglcontextlost)" };
  let last = "";
  while (performance.now() - t0 < 2_000) {
    // Yield a task (not an animation frame: a hidden or background tab may never deliver one, which hung web runs).
  await new Promise((r) => setTimeout(r, 0));
    try {
      instance.draw(sim.state);
    } catch (e) {
      last = `draw threw: ${(e as Error).message}`;
      continue;
    }
    const px = read();
    let differ = 0;
    for (let i = 0; i < px.length; i += 4) if (Math.abs((px[i] as number) - (ref[i] as number)) > 8 || Math.abs((px[i + 1] as number) - (ref[i + 1] as number)) > 8) differ++;
    if (differ / (WIDTH * HEIGHT) < 0.001) return { recovered: true, ms: +(performance.now() - t0).toFixed(1) };
    last = `${((100 * differ) / (WIDTH * HEIGHT)).toFixed(1)}% of pixels still differ`;
  }
  return { recovered: false, ms: null, reason: last };
}

(window as unknown as { __bench: unknown }).__bench = { adapter: adapter.id, scene: scene.id, measure, snapshot, startup, contextLoss, ready: true };

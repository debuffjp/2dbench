// One adapter, one scene, on a fresh page: ?adapter=<id>&scene=<id>. Exposes window.__bench for the
// runner (node, run.mjs) and for mobile.html (in an iframe).
import { ADAPTERS } from "./adapters/index.js";
import { makeTextures, SCENES, Simulation } from "./scenes.js";
import { HEIGHT, WIDTH } from "./types.js";

const params = new URLSearchParams(location.search);
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
  throw new Error("listed");
}
const adapter = ADAPTERS.find((a) => a.id === params.get("adapter"));
const scene = SCENES[params.get("scene") ?? "bunny"];
if (!adapter || !scene) throw new Error(`Unknown adapter or scene: ${location.search}`);
if (!adapter.supports(scene)) throw new Error(`${adapter.id} doesn't support ${scene.id}`);

const canvas = document.querySelector("canvas") as HTMLCanvasElement;
canvas.width = WIDTH;
canvas.height = HEIGHT;
const sim = new Simulation(scene);
const instance = await adapter.create(canvas, makeTextures(scene), scene);

export interface Measure {
  count: number;
  /** Median frame, simulation through GPU completion. */
  frameMs: number;
  p95FrameMs: number;
  /** Median main-thread time before the GPU sync. */
  submitMs: number;
}

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
  await new Promise(requestAnimationFrame);
  const total: number[] = [];
  const submit: number[] = [];
  for (let i = 0; i < frames; i++) {
    const t0 = performance.now();
    sim.step();
    instance.draw(sim.state);
    const t1 = performance.now();
    await instance.sync();
    total.push(performance.now() - t0);
    submit.push(t1 - t0);
  }
  const at = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))] ?? 0;
  return { count, frameMs: at(total, 0.5), p95FrameMs: at(total, 0.95), submitMs: at(submit, 0.5) };
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
  const gl = canvas.getContext("webgl2");
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

(window as unknown as { __bench: unknown }).__bench = { adapter: adapter.id, scene: scene.id, measure, snapshot, ready: true };

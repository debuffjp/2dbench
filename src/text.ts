// The text scene: a screen full of changing numbers (scores, timers, damage numbers) on a grid that
// scrolls up and wraps. Each label's number changes every 8 frames, staggered, so 1/8 of labels need new
// glyphs each frame, and its colour every 16.
// Adapters draw with each library's native text API, so glyph rasterisation differs between libraries and
// the scene declares its own, looser parity gate (see SceneSpec.gate).
import { emptyState, type FrameState, HEIGHT, type Sim, WIDTH } from "./types.js";

/** The CSS font every adapter uses. Fonts differ between machines, but not between adapters in one run. */
export const TEXT_FONT = "bold 16px monospace";
export const TEXT_SIZE = 16;
const CELL_W = 48;
const CELL_H = 20;
const GRID_COLS = WIDTH / CELL_W;
const CELLS = GRID_COLS * (HEIGHT / CELL_H);
/** Label colours, 0xRRGGBBAA, opaque; each label's colour changes every 16 frames. */
const COLOURS = [0xffffffff, 0xcffb2dff, 0xff6b6bff, 0xffd36bff];

export class TextSim implements Sim {
  readonly state: FrameState = emptyState();

  resize(count: number): void {
    const s = this.state;
    if (count > s.x.length) {
      s.x = new Float32Array(count);
      s.y = new Float32Array(count);
      s.color = new Uint32Array(count);
      s.scale = new Float32Array(count).fill(1);
      s.rotation = new Float32Array(count);
      s.texture = new Uint8Array(count);
    }
    s.count = count;
    this.layout();
  }

  step(): void {
    this.state.frame++;
    this.layout();
  }

  private layout(): void {
    const s = this.state;
    const f = s.frame;
    const text = (s.text ??= []);
    for (let i = 0; i < s.count; i++) {
      // A grid of CELL_W × CELL_H cells (540 fill the screen; more overlap), scrolling up a pixel a frame.
      const cell = i % CELLS;
      const col = cell % GRID_COLS;
      const row = (cell / GRID_COLS) | 0;
      s.x[i] = col * CELL_W + 2 + ((i / CELLS) | 0) * 7;
      s.y[i] = (((row * CELL_H - f) % HEIGHT) + HEIGHT) % HEIGHT;
      s.color[i] = COLOURS[(i + (f >> 4)) & 3] as number;
      text[i] = String(((i * 7919) % 1000) + ((f + i) >> 3) * 13);
    }
    text.length = s.count;
  }
}

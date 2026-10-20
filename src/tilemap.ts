// The tilemap scene: scrolling tile layers, the workload of almost every 2D platformer and top-down game.
// Layer 0 is opaque ground with animated water; layers above are sparse decoration with transparent gaps,
// each scrolling at its own speed (parallax). The simulation works out every tile's position and atlas
// frame; adapters only draw the resulting slices.
import { emptyState, type FrameState, HEIGHT, type Sim, WIDTH } from "./types.js";

const TILE = 16;
/** Atlas: 8 columns × 2 rows. Row 0: four ground tiles, then four water frames. Row 1: eight decorations. */
const ATLAS_COLS = 8;
/** One layer covers the screen plus one tile in each direction it scrolls. */
const COLS = WIDTH / TILE + 1;
const ROWS = Math.ceil(HEIGHT / TILE) + 1;
export const TILES_PER_LAYER = COLS * ROWS;

/** The atlas, drawn in code so it's identical everywhere. */
export function makeTilemapAtlas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TILE * ATLAS_COLS;
  c.height = TILE * 2;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  const rect = (col: number, row: number, x: number, y: number, w: number, h: number, fill: string) => {
    g.fillStyle = fill;
    g.fillRect(col * TILE + x, row * TILE + y, w, h);
  };
  // Ground: grass, dirt, stone, path.
  const grounds = [
    ["#2f5d27", "#3f7a32"],
    ["#5b4027", "#6e5033"],
    ["#3a3f36", "#4b5145"],
    ["#7a6a45", "#8c7b52"],
  ];
  grounds.forEach(([base, speck], i) => {
    rect(i, 0, 0, 0, TILE, TILE, base as string);
    rect(i, 0, 3, 4, 2, 2, speck as string);
    rect(i, 0, 10, 9, 2, 2, speck as string);
    rect(i, 0, 6, 12, 2, 1, speck as string);
  });
  // Water: a wave line that moves down the tile over four frames.
  for (let f = 0; f < 4; f++) {
    rect(4 + f, 0, 0, 0, TILE, TILE, "#1f4e6b");
    rect(4 + f, 0, 0, 2 + f * 4, TILE, 2, "#6bc5ff");
    rect(4 + f, 0, (f * 5) % 12, (9 + f * 4) % TILE, 4, 1, "#a8e0ff");
  }
  // Decorations, mostly transparent: tufts, flowers, rocks, a crate, leaves, a sign, a mushroom, a blob.
  rect(0, 1, 3, 10, 2, 6, "#cffb2d");
  rect(0, 1, 7, 8, 2, 8, "#cffb2d");
  rect(0, 1, 11, 11, 2, 5, "#cffb2d");
  rect(1, 1, 6, 6, 4, 4, "#ff6b6b");
  rect(1, 1, 7, 7, 2, 2, "#ffd36b");
  rect(1, 1, 7, 10, 2, 6, "#3f7a32");
  rect(2, 1, 2, 9, 12, 7, "#6b7066");
  rect(2, 1, 4, 9, 4, 2, "#8a9084");
  rect(3, 1, 1, 1, 14, 14, "#8c5a2b");
  rect(3, 1, 3, 3, 10, 10, "#a8713a");
  rect(3, 1, 7, 1, 2, 14, "#8c5a2b");
  rect(4, 1, 2, 2, 5, 5, "#3f7a32");
  rect(4, 1, 9, 6, 5, 5, "#2f5d27");
  rect(4, 1, 4, 10, 5, 4, "#4f9a3e");
  rect(5, 1, 7, 8, 2, 8, "#6e5033");
  rect(5, 1, 2, 2, 12, 7, "#a8713a");
  rect(6, 1, 3, 3, 10, 6, "#ff6b6b");
  rect(6, 1, 6, 9, 4, 7, "#f4ead2");
  rect(7, 1, 2, 4, 12, 11, "#cffb2d");
  rect(7, 1, 5, 7, 2, 2, "#11140d");
  rect(7, 1, 9, 7, 2, 2, "#11140d");
  return c;
}

/** Deterministic per-cell hash, so the map is infinite and identical everywhere. */
const hash = (x: number, y: number, layer: number) => {
  let h = (x * 374761393 + y * 668265263 + layer * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};

export class TilemapSim implements Sim {
  readonly state: FrameState = emptyState();

  /** `count` is tiles per frame: full layers of TILES_PER_LAYER, then part of one more. */
  resize(count: number): void {
    const s = this.state;
    if (count > s.x.length) {
      const f = () => new Float32Array(count);
      s.x = f();
      s.y = f();
      s.sx = f();
      s.sy = f();
      s.sw = f().fill(TILE);
      s.sh = f().fill(TILE);
      s.w = f().fill(TILE);
      s.h = f().fill(TILE);
      s.color = new Uint32Array(count).fill(0xffffffff);
      s.scale = f().fill(1);
      s.rotation = f();
      s.texture = new Uint8Array(count);
    }
    s.count = count;
    this.layout();
  }

  step(): void {
    this.state.frame++;
    this.layout();
  }

  /** Every tile's position and atlas frame for this frame. Positions are whole pixels. */
  private layout(): void {
    const s = this.state;
    const f = s.frame;
    for (let i = 0; i < s.count; i++) {
      const layer = (i / TILES_PER_LAYER) | 0;
      const cell = i - layer * TILES_PER_LAYER;
      const col = cell % COLS;
      const row = (cell / COLS) | 0;
      // Each layer scrolls right at its own speed, and odd layers drift down slowly.
      const ox = f * (layer + 1);
      const oy = layer % 2 ? f >> 1 : 0;
      const tx = col + Math.floor(ox / TILE);
      const ty = row + Math.floor(oy / TILE);
      s.x[i] = col * TILE - (ox % TILE);
      s.y[i] = row * TILE - (oy % TILE);
      const h = hash(tx, ty, layer);
      let frame: number;
      if (layer === 0) frame = h % 5 === 0 ? 4 + (((f >> 3) + tx) & 3) : h % 4;
      else frame = ATLAS_COLS + (h % ATLAS_COLS);
      s.sx[i] = (frame % ATLAS_COLS) * TILE;
      s.sy[i] = ((frame / ATLAS_COLS) | 0) * TILE;
    }
  }
}

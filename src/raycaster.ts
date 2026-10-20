// The raycaster scene: a retro first-person maze (the technique behind Wolfenstein 3D), rendered as texture
// slices. All the game work (casting rays, shading, projecting and depth-clipping enemies) happens here, in
// the shared simulation, identically for every library. Adapters only draw the resulting slices.
import { emptyState, type FrameState, HEIGHT, type Sim, WIDTH } from "./types.js";

/** Atlas tiles, 64×64 each: four wall styles, four enemy colours, and a white tile for flat floor and ceiling. */
const TILE = 64;
const WALLS = 4;
const ENEMY_TILE = 4;
const ENEMY_COLOURS = ["#f472b6", "#38bdf8", "#fbbf24", "#a78bfa"];
const WHITE_TILE = 8;
/** Each wall and enemy slice is this many screen pixels wide: 480 rays across 960 pixels. */
const STRIP = 2;
const RAYS = WIDTH / STRIP;
const BANDS = 12;

/** One canvas holding every texture the scene uses, drawn in code so it's identical everywhere. */
export function makeRaycasterAtlas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TILE * 9;
  c.height = TILE;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  const wall = (i: number, base: string, line: string, draw: (x: number) => void) => {
    const x = i * TILE;
    g.fillStyle = base;
    g.fillRect(x, 0, TILE, TILE);
    g.fillStyle = line;
    draw(x);
  };
  // Bricks.
  wall(0, "#3d4a30", "#1b2014", (x) => {
    for (let row = 0; row < 8; row++) {
      g.fillRect(x, row * 8, TILE, 1);
      for (let col = 0; col < 4; col++) g.fillRect(x + ((col * 16 + (row % 2) * 8) % TILE), row * 8, 1, 8);
    }
  });
  // Big stone blocks with a lime trim.
  wall(1, "#323d29", "#11140d", (x) => {
    g.fillRect(x, 31, TILE, 2);
    g.fillRect(x + 31, 0, 2, TILE);
    g.fillStyle = "#cffb2d";
    g.fillRect(x, 0, TILE, 2);
  });
  // Mossy panel.
  wall(2, "#235c45", "#34d399", (x) => {
    // Moss speckle, scattered by a small hash so it doesn't line up.
    let h = 7;
    for (let i = 0; i < 26; i++) {
      h = (h * 1103515245 + 12345) & 0x7fffffff;
      g.fillRect(x + 2 + (h % 58), 2 + ((h >> 8) % 58), 3, 3);
    }
  });
  // Lilac tiles.
  wall(3, "#3b3358", "#a78bfa", (x) => {
    for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) if ((tx + ty) % 2) g.fillRect(x + tx * 16 + 2, ty * 16 + 2, 12, 12);
  });
  // The enemies: squish blobs with two dot eyes, on transparency, one per accent colour.
  ENEMY_COLOURS.forEach((colour, k) => {
    const ex = (ENEMY_TILE + k) * TILE;
    g.fillStyle = colour;
    g.beginPath();
    g.roundRect(ex + 10, 18, 44, 42, 19);
    g.fill();
    g.fillStyle = "#11140d";
    for (const dx of [24, 40]) {
      g.beginPath();
      g.arc(ex + dx, 36, 3.5, 0, Math.PI * 2);
      g.fill();
    }
  });
  g.fillStyle = "#ffffff";
  g.fillRect(WHITE_TILE * TILE, 0, TILE, TILE);
  return c;
}

/**
 * A fixed 24×24 maze: solid rock with a circular corridor the camera walks, a central room, and radial side
 * passages, so walls are close (tall on screen) and there's depth to look down.
 */
function makeMap(): Uint8Array {
  const N = 24;
  const m = new Uint8Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = x + 0.5 - 12;
      const dy = y + 0.5 - 12;
      const d = Math.hypot(dx, dy);
      const angle = (Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2);
      const corridor = d > 5.1 && d < 6.9;
      const room = d < 3.2;
      // Eight radial passages, alternately leading in to the room and out towards the edge.
      const spoke = Math.abs(((angle * 8) % 1) - 0.5) < 0.09 && d < 10.5 && d > 2;
      const edge = x === 0 || y === 0 || x === N - 1 || y === N - 1;
      if (edge || !(corridor || room || spoke)) m[y * N + x] = 1 + ((x * 7 + y * 3) % WALLS);
    }
  return m;
}

export class RaycasterSim implements Sim {
  readonly state: FrameState;
  private readonly map = makeMap();
  private readonly zBuffer = new Float32Array(RAYS);
  private enemies = new Float32Array(0); // x, y, phase per enemy
  private enemyCount = 0;
  private seed = 1;

  constructor() {
    this.state = emptyState();
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** `count` is the number of enemies. New ones are placed in empty cells by the seeded random sequence. */
  resize(count: number): void {
    if (count * 3 > this.enemies.length) {
      const grown = new Float32Array(Math.max(count, 64) * 3);
      grown.set(this.enemies);
      this.enemies = grown;
    }
    for (let i = this.enemyCount; i < count; i++) {
      let x = 0;
      let y = 0;
      do {
        x = 1 + this.rand() * 22;
        y = 1 + this.rand() * 22;
      } while (this.map[Math.floor(y) * 24 + Math.floor(x)] !== 0);
      this.enemies[i * 3] = x;
      this.enemies[i * 3 + 1] = y;
      this.enemies[i * 3 + 2] = this.rand() * Math.PI * 2;
    }
    this.enemyCount = count;
    this.ensureWander();
    this.render();
  }

  step(): void {
    this.state.frame++;
    this.render();
  }

  /** Make sure the slice arrays can hold `n` slices. */
  private capacity(n: number): void {
    const s = this.state;
    if (s.x.length >= n) return;
    const cap = Math.max(n, s.x.length * 2);
    const grow = <T extends Float32Array | Uint32Array | Uint8Array>(a: T, make: (k: number) => T) => {
      const b = make(cap);
      b.set(a);
      return b;
    };
    const f = (k: number) => new Float32Array(k);
    s.x = grow(s.x, f);
    s.y = grow(s.y, f);
    s.sx = grow(s.sx, f);
    s.sy = grow(s.sy, f);
    s.sw = grow(s.sw, f);
    s.sh = grow(s.sh, f);
    s.w = grow(s.w, f);
    s.h = grow(s.h, f);
    s.scale = grow(s.scale, f);
    s.rotation = grow(s.rotation, f);
    s.color = grow(s.color, (k) => new Uint32Array(k));
    s.texture = grow(s.texture, (k) => new Uint8Array(k));
  }

  private emit(i: number, x: number, y: number, w: number, h: number, sx: number, sy: number, sw: number, sh: number, shade: number, tint = 0xffffff): void {
    const s = this.state;
    const r = Math.round(((tint >>> 16) & 0xff) * shade);
    const g = Math.round(((tint >>> 8) & 0xff) * shade);
    const b = Math.round((tint & 0xff) * shade);
    s.x[i] = x;
    s.y[i] = y;
    s.w[i] = w;
    s.h[i] = h;
    s.sx[i] = sx;
    s.sy[i] = sy;
    s.sw[i] = sw;
    s.sh[i] = sh;
    s.color[i] = ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;
    s.scale[i] = 1;
    s.rotation[i] = 0;
    s.texture[i] = 0;
  }

  /** Cast the frame: floor and ceiling bands, 480 wall slices, then enemy slices clipped by the z-buffer. */
  private render(): void {
    const f = this.state.frame;
    // The camera circles the ring, looking along its path and slightly inwards.
    const t = f * 0.01;
    const px = 12 + Math.cos(t) * 6;
    const py = 12 + Math.sin(t) * 6; // the middle of the corridor
    const look = t + Math.PI / 2 + 0.12;
    const dirX = Math.cos(look);
    const dirY = Math.sin(look);
    const planeX = -dirY * 0.66;
    const planeY = dirX * 0.66;
    this.capacity(BANDS * 2 + RAYS + this.enemyCount * 64);
    let n = 0;

    // Ceiling and floor: bands darker towards the horizon (white tile, tinted).
    const half = HEIGHT / 2;
    const bandH = half / BANDS;
    for (let b = 0; b < BANDS; b++) {
      const fade = 0.25 + 0.55 * (1 - b / BANDS);
      this.emit(n++, 0, b * bandH, WIDTH, bandH, WHITE_TILE * TILE + 8, 8, 4, 4, fade, 0x1b2014);
      this.emit(n++, 0, HEIGHT - (b + 1) * bandH, WIDTH, bandH, WHITE_TILE * TILE + 8, 8, 4, 4, fade, 0x2a3320);
    }

    // Walls: one ray per 2-pixel column (DDA through the grid).
    for (let col = 0; col < RAYS; col++) {
      const camX = (2 * (col + 0.5)) / RAYS - 1;
      const rx = dirX + planeX * camX;
      const ry = dirY + planeY * camX;
      let mx = Math.floor(px);
      let my = Math.floor(py);
      const ddx = Math.abs(1 / rx);
      const ddy = Math.abs(1 / ry);
      const stepX = rx < 0 ? -1 : 1;
      const stepY = ry < 0 ? -1 : 1;
      let sideX = rx < 0 ? (px - mx) * ddx : (mx + 1 - px) * ddx;
      let sideY = ry < 0 ? (py - my) * ddy : (my + 1 - py) * ddy;
      let side = 0;
      let cell = 0;
      for (let guard = 0; guard < 64 && cell === 0; guard++) {
        if (sideX < sideY) {
          sideX += ddx;
          mx += stepX;
          side = 0;
        } else {
          sideY += ddy;
          my += stepY;
          side = 1;
        }
        cell = this.map[my * 24 + mx] ?? 1;
      }
      const dist = Math.max(0.05, side === 0 ? sideX - ddx : sideY - ddy);
      this.zBuffer[col] = dist;
      let wallX = side === 0 ? py + dist * ry : px + dist * rx;
      wallX -= Math.floor(wallX);
      let texX = Math.floor(wallX * TILE);
      if ((side === 0 && rx > 0) || (side === 1 && ry < 0)) texX = TILE - texX - 1;
      const lineH = HEIGHT / dist;
      const shade = Math.min(1, 2.2 / (1 + dist * 0.3)) * (side === 1 ? 0.8 : 1);
      this.emit(n++, col * STRIP, half - lineH / 2, STRIP, lineH, (cell - 1) * TILE + texX, 0, 1, TILE, shade);
    }

    // Enemies: wander a little, project, sort far to near, and draw each visible column as a slice.
    const order: { d: number; i: number }[] = [];
    for (let i = 0; i < this.enemyCount; i++) {
      const e = this.enemies;
      const ex = (e[i * 3] as number) + Math.sin(f * 0.02 + (e[i * 3 + 2] as number)) * 0.25;
      const ey = (e[i * 3 + 1] as number) + Math.cos(f * 0.017 + (e[i * 3 + 2] as number)) * 0.25;
      const d = (ex - px) ** 2 + (ey - py) ** 2;
      order.push({ d, i });
      this.wander[i * 2] = ex;
      this.wander[i * 2 + 1] = ey;
    }
    order.sort((a, b) => b.d - a.d || a.i - b.i);
    const invDet = 1 / (planeX * dirY - dirX * planeY);
    for (const { i } of order) {
      const sx = (this.wander[i * 2] as number) - px;
      const sy = (this.wander[i * 2 + 1] as number) - py;
      const tx = invDet * (dirY * sx - dirX * sy);
      const ty = invDet * (-planeY * sx + planeX * sy);
      if (ty <= 0.2) continue;
      const screenX = (WIDTH / 2) * (1 + tx / ty);
      const size = (HEIGHT / ty) * 0.5;
      const top = half + (HEIGHT / ty) * 0.5 - size;
      const left = screenX - size / 2;
      const first = Math.max(0, Math.floor(left / STRIP));
      const last = Math.min(RAYS - 1, Math.floor((left + size) / STRIP));
      const shade = Math.min(1, 2.2 / (1 + ty * 0.3));
      const tile = ENEMY_TILE + (i % ENEMY_COLOURS.length);
      for (let col = first; col <= last; col++) {
        if (ty >= (this.zBuffer[col] as number)) continue;
        const texX = Math.floor(((col * STRIP + 1 - left) / size) * TILE);
        if (texX < 0 || texX >= TILE) continue;
        this.capacity(n + 1);
        this.emit(n++, col * STRIP, top, STRIP, size, tile * TILE + texX, 0, 1, TILE, shade);
      }
    }
    this.state.count = n;
  }

  private wander = new Float32Array(0);

  /** The wander buffer grows with the enemy count. */
  private ensureWander(): void {
    if (this.wander.length < this.enemyCount * 2) this.wander = new Float32Array(this.enemyCount * 2);
  }
}

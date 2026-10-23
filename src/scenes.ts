import { emptyState, type FrameState, HEIGHT, SPRITE, type SceneSpec, type Sim, WIDTH } from "./types.js";

export const SCENES: Record<string, SceneSpec> = {
  bunny: {
    id: "bunny",
    description: "Bunnymark: one texture, position only",
    rotation: false,
    scale: false,
    color: false,
    textures: 1,
    slices: false,
  },
  mixed: {
    id: "mixed",
    description: "4 separate textures; rotation, scale, tint and alpha per sprite, all changing over time",
    rotation: true,
    scale: true,
    color: true,
    textures: 4,
    slices: false,
  },
  particles: {
    id: "particles",
    description: "Particles: one texture; position, rotation, scale, tint and alpha per sprite, all changing over time",
    rotation: true,
    scale: true,
    color: true,
    textures: 1,
    slices: false,
  },
  raycaster: {
    id: "raycaster",
    description: "Retro first-person maze: 480 textured wall slices, distance shading and billboarded enemies, all as texture slices",
    rotation: false,
    scale: false,
    color: true,
    textures: 1,
    slices: true,
    countMeans: "enemies in the maze (each visible one is drawn as many thin slices)",
  },
  tilemap: {
    id: "tilemap",
    description: "Scrolling tile layers: 16×16 tiles from one atlas, parallax layers at different speeds, animated water tiles",
    rotation: false,
    scale: false,
    color: false,
    textures: 1,
    slices: true,
    countMeans: "tiles drawn per frame (a full-screen layer is 2,135 tiles)",
  },
  churn: {
    id: "churn",
    description: "Spawn and despawn: every sprite lives 60 frames, so 1/60 of them are destroyed and created each frame; they grow as they age",
    rotation: false,
    scale: true,
    color: false,
    textures: 1,
    slices: false,
    churn: true,
  },
  lowres: {
    id: "lowres",
    description: "Low-resolution render target: bunnies drawn into a 480×270 offscreen image, which is then drawn at 2× to fill the canvas",
    rotation: false,
    scale: false,
    color: false,
    textures: 1,
    slices: false,
    world: [480, 270],
    target: { width: 480, height: 270, scale: 2 },
  },
  clip: {
    id: "clip",
    description: "Clipped panels: a 4×3 grid of UI panels, each clipping the bunnies bouncing through it",
    rotation: false,
    scale: false,
    color: false,
    textures: 1,
    slices: false,
    clip: true,
  },
  upload: {
    id: "upload",
    description: "Texture upload: a 960×540 layer repainted on the CPU every frame (like destructible terrain or a paint canvas) and re-uploaded, under bunnies",
    rotation: false,
    scale: false,
    color: false,
    textures: 1,
    slices: false,
    upload: true,
  },
  text: {
    id: "text",
    description: "Text: a grid of numbers scrolling up, each changing every 8 frames and colour every 16, drawn with each library's native text API",
    rotation: false,
    scale: false,
    color: true,
    textures: 0,
    slices: false,
    text: true,
    countMeans: "text labels (2–4 characters each)",
    gate: {
      coveragePercent: [90, 110],
      maxInteriorDifferingPercent: 5,
      counts: [100, 540],
      why: "glyph rasterisation and text box metrics differ between libraries, so pixels rarely match exactly; coverage still catches missing or extra labels. Checked at counts where labels don't overlap (540 fill the screen).",
    },
    counts: {
      ladder: [100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000],
      published: [500, 2_000, 5_000],
      why: "540 labels fill the screen, so 5,000 is already nine layers of text; a HUD or a burst of damage numbers is hundreds. A library that keeps a texture per label (PixiJS Text: 1.2 GB at 10,000 labels) would need tens of gigabytes for the default ladder's 200,000.",
    },
  },
};

const TINTS = [0xffffff, 0xff8080, 0x80ff80, 0x8080ff];
const FILLS = ["#cffb2d", "#ff6b6b", "#6bc5ff", "#ffd36b"];

/** The scene's textures: 16×16 canvases with a 12×12 body and two dark "eyes", identical for every adapter. */
export function makeTextures(scene: SceneSpec): HTMLCanvasElement[] {
  return FILLS.slice(0, scene.textures).map((fill) => {
    const t = document.createElement("canvas");
    t.width = t.height = SPRITE;
    const ctx = t.getContext("2d") as CanvasRenderingContext2D;
    ctx.fillStyle = fill;
    ctx.fillRect(2, 2, SPRITE - 4, SPRITE - 4);
    ctx.fillStyle = "#11140d";
    ctx.fillRect(5, 5, 2, 2);
    ctx.fillRect(9, 5, 2, 2);
    return t;
  });
}

/**
 * The deterministic simulation. Seeded, so every adapter on every device draws the same frames.
 * Bunnies bounce under gravity; looks change over time (scale every 4 frames, alpha every 2, tint every 8,
 * rotation every frame), so "dynamic" is honest: no renderer can win by caching values that never change.
 */
export class Simulation implements Sim {
  readonly state: FrameState;
  private vx = new Float32Array(0);
  private vy = new Float32Array(0);
  private seed = 1;
  /** The box sprites bounce in: the canvas, or the scene's `world`. */
  private readonly w: number;
  private readonly h: number;

  constructor(private readonly scene: SceneSpec) {
    [this.w, this.h] = scene.world ?? [WIDTH, HEIGHT];
    this.state = emptyState();
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** Grow or shrink to `count` sprites. New sprites continue the same random sequence. */
  resize(count: number): void {
    const s = this.state;
    if (count > s.x.length) {
      const cap = Math.max(count, s.x.length * 2);
      const grow = <T extends Float32Array | Uint32Array | Uint8Array>(a: T, make: (n: number) => T): T => {
        const b = make(cap);
        b.set(a);
        return b;
      };
      s.x = grow(s.x, (n) => new Float32Array(n));
      s.y = grow(s.y, (n) => new Float32Array(n));
      s.scale = grow(s.scale, (n) => new Float32Array(n));
      s.rotation = grow(s.rotation, (n) => new Float32Array(n));
      s.color = grow(s.color, (n) => new Uint32Array(n));
      s.texture = grow(s.texture, (n) => new Uint8Array(n));
      this.vx = grow(this.vx, (n) => new Float32Array(n));
      this.vy = grow(this.vy, (n) => new Float32Array(n));
    }
    for (let i = s.count; i < count; i++) {
      s.x[i] = this.rand() * this.w;
      s.y[i] = this.rand() * this.h * 0.5;
      this.vx[i] = this.rand() * 10 - 5;
      this.vy[i] = this.rand() * 10 - 5;
      s.texture[i] = this.scene.textures > 1 ? i % this.scene.textures : 0;
    }
    s.count = count;
    this.look();
  }

  step(): void {
    const s = this.state;
    s.frame++;
    const { x, y, vx, vy } = { x: s.x, y: s.y, vx: this.vx, vy: this.vy };
    for (let i = 0; i < s.count; i++) {
      x[i] = (x[i] as number) + (vx[i] as number);
      y[i] = (y[i] as number) + (vy[i] as number);
      vy[i] = (vy[i] as number) + 0.75;
      if ((x[i] as number) > this.w || (x[i] as number) < 0) vx[i] = -(vx[i] as number);
      if ((y[i] as number) > this.h) {
        vy[i] = (vy[i] as number) * -0.85;
        y[i] = this.h;
      } else if ((y[i] as number) < 0) {
        vy[i] = 0;
        y[i] = 0;
      }
    }
    this.look();
  }

  /** Per-sprite look for this frame, from index and frame only. */
  private look(): void {
    const s = this.state;
    const sc = this.scene;
    const f = s.frame;
    for (let i = 0; i < s.count; i++) {
      s.rotation[i] = sc.rotation ? (i * 0.1 + f * 0.02) % (Math.PI * 2) : 0;
      s.scale[i] = sc.scale ? 0.75 + ((i + (f >> 2)) % 5) * 0.125 : 1;
      if (sc.color) {
        const tint = TINTS[((i >> 2) + (f >> 3)) & 3] as number;
        const alpha = Math.round((0.5 + ((i + (f >> 1)) % 3) * 0.25) * 255);
        s.color[i] = ((tint << 8) | alpha) >>> 0;
      } else s.color[i] = 0xffffffff;
    }
  }
}

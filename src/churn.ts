// The churn scene: bullets, pickups and effects are born and die all the time. Every sprite lives LIFE
// frames; each frame the oldest drop off the front of the arrays and as many new ones are appended, so
// draw order is spawn order and `id` tells retained-mode libraries which objects to destroy and create.
import { emptyState, type FrameState, HEIGHT, SPRITE, type Sim, WIDTH } from "./types.js";

const LIFE = 60;

export class ChurnSim implements Sim {
  readonly state: FrameState = emptyState();
  private vx = new Float32Array(0);
  private vy = new Float32Array(0);
  private age = new Uint16Array(0);
  private nextId = 1;
  private seed = 1;

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private ensure(n: number): void {
    const s = this.state;
    if (n <= s.x.length) return;
    const cap = Math.max(n, s.x.length * 2);
    const grow = <T extends Float32Array | Uint32Array | Uint16Array | Uint8Array>(a: T, make: (n: number) => T): T => {
      const b = make(cap);
      b.set(a);
      return b;
    };
    s.x = grow(s.x, (k) => new Float32Array(k));
    s.y = grow(s.y, (k) => new Float32Array(k));
    s.scale = grow(s.scale, (k) => new Float32Array(k));
    s.rotation = grow(s.rotation, (k) => new Float32Array(k));
    s.color = grow(s.color, (k) => new Uint32Array(k)).fill(0xffffffff);
    s.texture = grow(s.texture, (k) => new Uint8Array(k));
    s.id = grow(s.id, (k) => new Uint32Array(k));
    this.vx = grow(this.vx, (k) => new Float32Array(k));
    this.vy = grow(this.vy, (k) => new Float32Array(k));
    this.age = grow(this.age, (k) => new Uint16Array(k));
  }

  /** A new sprite at index i, launched from a spawner that sweeps across the screen. */
  private spawn(i: number, age: number): void {
    const s = this.state;
    const id = this.nextId++;
    s.id[i] = id;
    s.x[i] = ((id * 37) % (WIDTH - SPRITE * 2)) + SPRITE;
    s.y[i] = HEIGHT * (0.3 + this.rand() * 0.4);
    this.vx[i] = this.rand() * 6 - 3;
    this.vy[i] = this.rand() * 6 - 3;
    this.age[i] = age;
  }

  /** Grow to `count` live sprites. Ages are spread evenly, so a steady 1/LIFE of them die each frame. */
  resize(count: number): void {
    const s = this.state;
    this.ensure(count);
    for (let i = s.count; i < count; i++) this.spawn(i, (LIFE - 1) - (i % LIFE));
    // Keep oldest first: sort the newly added tail into age order with the rest (stable, by age desc).
    const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => (this.age[b] as number) - (this.age[a] as number) || (s.id[a] as number) - (s.id[b] as number));
    const pick = <T extends Float32Array | Uint32Array | Uint16Array>(a: T) => {
      const copy = a.slice(0, count) as T;
      for (let i = 0; i < count; i++) a[i] = copy[order[i] as number] as number;
    };
    pick(s.x);
    pick(s.y);
    pick(s.id);
    pick(this.vx);
    pick(this.vy);
    pick(this.age);
    s.count = count;
    this.look();
  }

  step(): void {
    const s = this.state;
    s.frame++;
    const n = s.count;
    // Age everything; the ones reaching LIFE are at the front (oldest first).
    let dead = 0;
    for (let i = 0; i < n; i++) {
      const a = (this.age[i] as number) + 1;
      this.age[i] = a;
      if (a >= LIFE) dead = i + 1;
    }
    if (dead) {
      for (const a of [s.x, s.y, s.id, this.vx, this.vy, this.age] as (Float32Array | Uint32Array | Uint16Array)[]) a.copyWithin(0, dead, n);
      for (let i = n - dead; i < n; i++) this.spawn(i, 0);
    }
    const { x, y, vx, vy } = { x: s.x, y: s.y, vx: this.vx, vy: this.vy };
    for (let i = 0; i < n; i++) {
      x[i] = (x[i] as number) + (vx[i] as number);
      y[i] = (y[i] as number) + (vy[i] as number);
      vy[i] = (vy[i] as number) + 0.1;
    }
    this.look();
  }

  /** Sprites grow as they age, in steps of 1/8. */
  private look(): void {
    const s = this.state;
    for (let i = 0; i < s.count; i++) s.scale[i] = 0.5 + ((this.age[i] as number) >> 3) * 0.125;
  }
}

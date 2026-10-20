// The clip scene: UI panels (inventories, scrolling lists, minimaps), each clipping its own contents. Each
// panel's bunnies bounce in a box 24 pixels larger than the panel on every side, so many are partly or
// wholly outside it and must be clipped. Sprite i belongs to panel i % PANELS.length.
import { Simulation } from "./scenes.js";
import { emptyState, type FrameState, PANELS, type SceneSpec, type Sim } from "./types.js";

const MARGIN = 24;

export class ClipSim implements Sim {
  readonly state: FrameState = emptyState();
  private readonly inner: Simulation;

  constructor(scene: SceneSpec) {
    const [, , w, h] = PANELS[0] as [number, number, number, number];
    this.inner = new Simulation({ ...scene, world: [w + MARGIN * 2, h + MARGIN * 2] });
  }

  resize(count: number): void {
    this.inner.resize(count);
    this.place();
  }

  step(): void {
    this.inner.step();
    this.place();
  }

  /** Inner state, moved into each sprite's panel. */
  private place(): void {
    const from = this.inner.state;
    const s = this.state;
    if (s.x.length < from.x.length) {
      s.x = new Float32Array(from.x.length);
      s.y = new Float32Array(from.x.length);
    }
    Object.assign(s, { count: from.count, frame: from.frame, scale: from.scale, rotation: from.rotation, color: from.color, texture: from.texture });
    for (let i = 0; i < from.count; i++) {
      const [px, py] = PANELS[i % PANELS.length] as [number, number, number, number];
      s.x[i] = (from.x[i] as number) + px - MARGIN;
      s.y[i] = (from.y[i] as number) + py - MARGIN;
    }
  }
}

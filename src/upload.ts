// The upload scene: a full-screen layer the game paints on the CPU every frame (destructible terrain, a
// paint canvas, a software-rendered effect), so the library must re-upload it every frame. The layer is
// repainted from a pixel buffer with putImageData; that's simulation work, the same for every adapter.
import { Simulation } from "./scenes.js";
import { HEIGHT, type SceneSpec, type Sim, WIDTH } from "./types.js";

export class UploadSim implements Sim {
  private readonly inner: Simulation;
  readonly layer: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly px: Uint32Array;

  constructor(scene: SceneSpec) {
    this.inner = new Simulation(scene);
    this.layer = document.createElement("canvas");
    this.layer.width = WIDTH;
    this.layer.height = HEIGHT;
    // CPU-backed, as a canvas the game writes pixels into would be.
    this.ctx = this.layer.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    this.image = this.ctx.createImageData(WIDTH, HEIGHT);
    this.px = new Uint32Array(this.image.data.buffer);
    this.paint();
  }

  get state() {
    return this.inner.state;
  }

  resize(count: number): void {
    this.inner.resize(count);
  }

  step(): void {
    this.inner.step();
    this.paint();
  }

  /** Moving diagonal bands, opaque, so every pixel changes over time. Little-endian ABGR words. */
  private paint(): void {
    const f = this.inner.state.frame;
    const px = this.px;
    for (let y = 0; y < HEIGHT; y++) {
      const row = y * WIDTH;
      for (let x = 0; x < WIDTH; x++) {
        const band = ((x + y + f * 2) >> 5) & 3;
        px[row + x] = band === 0 ? 0xff1d2a1a : band === 1 ? 0xff16200f : band === 2 ? 0xff2a3320 : 0xff0d140b;
      }
    }
    this.ctx.putImageData(this.image, 0, 0);
  }
}

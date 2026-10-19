import { syncCanvas } from "../gl.js";
import { type Adapter, BACKGROUND_CSS, HEIGHT, SPRITE, WIDTH } from "../types.js";

/** Plain Canvas 2D `drawImage`. Canvas 2D has no per-draw tint, so scenes that need colour are not supported. */
export const canvas2d: Adapter = {
  id: "canvas2d",
  label: "Canvas 2D drawImage",
  package: "",
  setup: "getContext('2d', { alpha: false }), imageSmoothingEnabled = false, one drawImage per sprite.",
  supports: (scene) => !scene.color,
  async create(canvas, textures) {
    const ctx = canvas.getContext("2d", { alpha: false }) as CanvasRenderingContext2D;
    ctx.imageSmoothingEnabled = false;
    return {
      draw(s) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = BACKGROUND_CSS;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        for (let i = 0; i < s.count; i++) {
          const image = textures[s.texture[i] as number] as HTMLCanvasElement;
          const k = s.scale[i] as number;
          const r = s.rotation[i] as number;
          const x = s.x[i] as number;
          const y = s.y[i] as number;
          if (r === 0) {
            // Whole-pixel origin for unrotated sprites, like every other adapter.
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.drawImage(image, Math.round(x - (SPRITE / 2) * k), Math.round(y - (SPRITE / 2) * k), SPRITE * k, SPRITE * k);
          } else {
            const c = Math.cos(r) * k;
            const sn = Math.sin(r) * k;
            ctx.setTransform(c, sn, -sn, c, x, y);
            ctx.drawImage(image, -SPRITE / 2, -SPRITE / 2);
          }
        }
      },
      sync: () => syncCanvas(canvas),
    };
  },
};

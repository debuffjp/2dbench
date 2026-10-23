import { syncCanvas } from "../gl.js";
import { TEXT_FONT } from "../text.js";
import { type Adapter, BACKGROUND_CSS, type FrameState, HEIGHT, PANELS, SPRITE, WIDTH } from "../types.js";

/** CSS colour per 0xRRGGBB, so text doesn't build a string per label per frame. */
const CSS: Record<number, string> = {};

/** Plain Canvas 2D `drawImage`. Canvas 2D has no per-draw tint, so scenes that need colour are not supported. */
export const canvas2d: Adapter = {
  id: "canvas2d",
  label: "Canvas 2D drawImage",
  package: "",
  setup: "getContext('2d', { alpha: false }), imageSmoothingEnabled = false, one drawImage per sprite (the nine-argument form for slices). Text: fillText with textBaseline top, on an alpha: true context so glyphs get grayscale antialiasing like every other library's offscreen rasterisation (an opaque canvas gets LCD subpixel antialiasing on Linux, which lights extra pixels). Render target: an offscreen canvas drawn scaled. Clip: save, rect, clip, restore per panel. Upload: the layer canvas drawn directly.",
  // fillText takes any colour, so text scenes are supported.
  supports: (scene) => !scene.color || !!scene.text,
  async create(canvas, textures, scene) {
    // Text: a transparent context, so Chrome antialiases glyphs in grayscale as the other libraries' offscreen
    // canvases do. On an opaque canvas Linux uses LCD subpixel antialiasing, which fails the coverage gate (130%).
    const ctx = canvas.getContext("2d", { alpha: !!scene.text }) as CanvasRenderingContext2D;
    ctx.imageSmoothingEnabled = false;
    const layer = scene.upload ? (textures[textures.length - 1] as HTMLCanvasElement) : null;
    // Render target: an offscreen canvas of the target's size, drawn scaled.
    const target = scene.target ? Object.assign(document.createElement("canvas"), { width: scene.target.width, height: scene.target.height }) : null;
    const tctx = target?.getContext("2d", { alpha: false }) ?? null;
    if (tctx) tctx.imageSmoothingEnabled = false;
    const sprites = (g: CanvasRenderingContext2D, s: FrameState, first: number, stride: number) => {
      for (let i = first; i < s.count; i += stride) {
        const image = textures[s.texture[i] as number] as HTMLCanvasElement;
        const k = s.scale[i] as number;
        const r = s.rotation[i] as number;
        const x = s.x[i] as number;
        const y = s.y[i] as number;
        if (r === 0) {
          // Whole-pixel origin for unrotated sprites, like every other adapter.
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.drawImage(image, Math.round(x - (SPRITE / 2) * k), Math.round(y - (SPRITE / 2) * k), SPRITE * k, SPRITE * k);
        } else {
          const c = Math.cos(r) * k;
          const sn = Math.sin(r) * k;
          g.setTransform(c, sn, -sn, c, x, y);
          g.drawImage(image, -SPRITE / 2, -SPRITE / 2);
        }
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
    };
    return {
      draw(s) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = BACKGROUND_CSS;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        if (scene.text) {
          const text = s.text as string[];
          ctx.font = TEXT_FONT;
          ctx.textBaseline = "top";
          for (let i = 0; i < s.count; i++) {
            ctx.fillStyle = CSS[(s.color[i] as number) >>> 8] ??= `#${((s.color[i] as number) >>> 8).toString(16).padStart(6, "0")}`;
            ctx.fillText(text[i] as string, s.x[i] as number, s.y[i] as number);
          }
          return;
        }
        if (scene.slices) {
          // Slices: part of the texture at x, y (top-left), one nine-argument drawImage each.
          const image = textures[0] as HTMLCanvasElement;
          for (let i = 0; i < s.count; i++)
            ctx.drawImage(image, s.sx[i] as number, s.sy[i] as number, s.sw[i] as number, s.sh[i] as number, s.x[i] as number, s.y[i] as number, s.w[i] as number, s.h[i] as number);
          return;
        }
        if (layer) ctx.drawImage(layer, 0, 0);
        if (target && tctx) {
          tctx.fillStyle = BACKGROUND_CSS;
          tctx.fillRect(0, 0, target.width, target.height);
          sprites(tctx, s, 0, 1);
          ctx.drawImage(target, 0, 0, target.width * (scene.target?.scale ?? 1), target.height * (scene.target?.scale ?? 1));
        } else if (scene.clip)
          PANELS.forEach(([x, y, w, h], p) => {
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y, w, h);
            ctx.clip();
            sprites(ctx, s, p, PANELS.length);
            ctx.restore();
          });
        else sprites(ctx, s, 0, 1);
      },
      sync: () => syncCanvas(canvas),
    };
  },
};

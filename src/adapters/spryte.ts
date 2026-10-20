import { readPixel } from "../gl.js";
import { TEXT_FONT } from "../text.js";
import { type Adapter, BACKGROUND, type FrameState, HEIGHT, PANELS, type SceneSpec, WIDTH } from "../types.js";

// Imported when the adapter is created, as PixiJS is, so startup timings count each library's own load.
const setup = async (canvas: HTMLCanvasElement) => {
  const { createRenderer } = await import("spryte");
  const draw = createRenderer(canvas, { backend: "webgl2", smooth: false });
  draw.resize(WIDTH, HEIGHT);
  const raw = draw.raw;
  if (raw.kind !== "webgl2") throw new Error("WebGL2 unavailable");
  return { draw, gl: raw.gl };
};

type Draw = Awaited<ReturnType<typeof setup>>["draw"];

/**
 * The scene's framing around the sprites: an uploaded layer underneath, a low-resolution target, or clipped
 * panels. `body(first, stride)` draws sprites first, first + stride, … (clip scenes draw one panel at a time).
 */
function framed(draw: Draw, scene: SceneSpec, textures: HTMLCanvasElement[], body: (first: number, stride: number) => void) {
  const layer = scene.upload ? (textures[textures.length - 1] as HTMLCanvasElement) : null;
  const target = scene.target ? draw.createTarget(scene.target.width, scene.target.height) : null;
  const atOrigin = { origin: [0, 0] as const, scaleX: scene.target?.scale ?? 1, scaleY: scene.target?.scale ?? 1 };
  const plain = { origin: [0, 0] as const };
  return () => {
    if (layer) {
      // The game repainted it: tell spryte, which re-uploads it on the next draw.
      draw.invalidate(layer);
      draw.sprite(layer, 0, 0, plain);
    }
    if (target) {
      draw.into(target, () => body(0, 1), BACKGROUND);
      draw.sprite(target, 0, 0, atOrigin);
    } else if (scene.clip) {
      PANELS.forEach(([x, y, w, h], p) => draw.clip(x, y, w, h, () => body(p, PANELS.length)));
    } else body(0, 1);
  };
}

/** spryte, one `draw.sprite()` call per sprite: the general-purpose path. */
export const spryteSprite: Adapter = {
  id: "spryte",
  label: "spryte draw.sprite",
  package: "spryte",
  setup: "createRenderer(canvas, { smooth: false }); one draw.sprite per sprite with a reused options object. Slice scenes: one reused Frame object whose source rectangle changes per call. Text: draw.text with a CSS font and a reused options object. Render target: createTarget, draw.into, then the target drawn scaled. Clip: draw.clip per panel. Upload: draw.invalidate on the layer each frame.",
  supports: () => true,
  async create(canvas, textures, scene) {
    const { draw, gl } = await setup(canvas);
    const o = { rotation: 0, scaleX: 1, scaleY: 1, tint: 0xffffffff };
    // Slices: one reused Frame object, since draw.sprite reads it immediately (no allocation per slice).
    const frame = { image: textures[0] as HTMLCanvasElement, x: 0, y: 0, w: 1, h: 1 };
    const label = { font: TEXT_FONT, color: 0xffffffff, baseline: "top" as const };
    const slice = { origin: [0, 0] as const, scaleX: 1, scaleY: 1, tint: 0xffffffff };
    const sprites = framed(draw, scene, textures, (first, stride) => {
      const st = state;
      for (let i = first; i < st.count; i += stride) {
        o.rotation = st.rotation[i] as number;
        o.scaleX = o.scaleY = st.scale[i] as number;
        o.tint = st.color[i] as number;
        draw.sprite(textures[st.texture[i] as number] as HTMLCanvasElement, st.x[i] as number, st.y[i] as number, o);
      }
    });
    let state: FrameState;
    return {
      draw(s) {
        draw.begin(BACKGROUND, WIDTH, HEIGHT, 1);
        if (scene.text) {
          const text = s.text as string[];
          for (let i = 0; i < s.count; i++) {
            label.color = s.color[i] as number;
            draw.text(text[i] as string, s.x[i] as number, s.y[i] as number, label);
          }
          draw.end();
          return;
        }
        if (scene.slices) {
          for (let i = 0; i < s.count; i++) {
            frame.x = s.sx[i] as number;
            frame.y = s.sy[i] as number;
            frame.w = s.sw[i] as number;
            frame.h = s.sh[i] as number;
            slice.scaleX = (s.w[i] as number) / frame.w;
            slice.scaleY = (s.h[i] as number) / frame.h;
            slice.tint = s.color[i] as number;
            draw.sprite(frame, s.x[i] as number, s.y[i] as number, slice);
          }
          draw.end();
          return;
        }
        state = s;
        sprites();
        draw.end();
      },
      sync: () => readPixel(gl),
    };
  },
};

/**
 * spryte bulk, `draw.sprites()`: the scene's arrays go to the GPU as they are. Positions are interleaved
 * x, y, so they're copied into one array per frame (the only per-sprite JavaScript), as a game would.
 */
export const spryteBulk: Adapter = {
  id: "spryte-bulk",
  label: "spryte draw.sprites",
  package: "spryte",
  setup: "createRenderer(canvas, { smooth: false }); one draw.sprites per texture per frame, with per-copy scale, rotation and colour arrays. Render target, upload: as for draw.sprite. Clip: positions grouped per panel as they're copied, one draw.sprites per panel inside draw.clip.",
  // draw.sprites draws one frame at many positions; slices need a different source region per copy.
  supports: (scene) => scene.textures === 1 && !scene.slices,
  async create(canvas, textures, scene) {
    const { draw, gl } = await setup(canvas);
    let pos = new Float32Array(0);
    const image = textures[0] as HTMLCanvasElement;
    // Clip scenes: positions grouped by panel (the copy below does it), one draw.sprites per panel.
    const starts = new Int32Array(PANELS.length + 1);
    let state: FrameState;
    const sprites = framed(draw, scene, textures, (first, stride) => {
      const s = state;
      const each = scene.rotation || scene.scale || scene.color ? { scale: s.scale, rotation: s.rotation, color: s.color } : undefined;
      if (stride === 1) draw.sprites(image, pos, s.count, undefined, each);
      else draw.sprites(image, pos.subarray((starts[first] as number) * 2), (starts[first + 1] as number) - (starts[first] as number));
    });
    return {
      draw(s) {
        if (pos.length < s.count * 2) pos = new Float32Array(s.count * 2);
        if (scene.clip) {
          const P = PANELS.length;
          let k = 0;
          for (let p = 0; p < P; p++) {
            starts[p] = k;
            for (let i = p; i < s.count; i += P) {
              pos[k * 2] = s.x[i] as number;
              pos[k * 2 + 1] = s.y[i] as number;
              k++;
            }
          }
          starts[P] = k;
        } else
          for (let i = 0; i < s.count; i++) {
            pos[i * 2] = s.x[i] as number;
            pos[i * 2 + 1] = s.y[i] as number;
          }
        state = s;
        draw.begin(BACKGROUND, WIDTH, HEIGHT, 1);
        sprites();
        draw.end();
      },
      sync: () => readPixel(gl),
    };
  },
};

import { createRenderer } from "spryte";
import { readPixel } from "../gl.js";
import { type Adapter, BACKGROUND, HEIGHT, WIDTH } from "../types.js";

const setup = (canvas: HTMLCanvasElement) => {
  const draw = createRenderer(canvas, { backend: "webgl2", smooth: false });
  draw.resize(WIDTH, HEIGHT);
  const raw = draw.raw;
  if (raw.kind !== "webgl2") throw new Error("WebGL2 unavailable");
  return { draw, gl: raw.gl };
};

/** spryte, one `draw.sprite()` call per sprite: the general-purpose path. */
export const spryteSprite: Adapter = {
  id: "spryte",
  label: "spryte draw.sprite",
  package: "spryte",
  setup: "createRenderer(canvas, { smooth: false }); one draw.sprite per sprite with a reused options object.",
  supports: () => true,
  async create(canvas, textures) {
    const { draw, gl } = setup(canvas);
    const o = { rotation: 0, scaleX: 1, scaleY: 1, tint: 0xffffffff };
    return {
      draw(s) {
        draw.begin(BACKGROUND, WIDTH, HEIGHT, 1);
        for (let i = 0; i < s.count; i++) {
          o.rotation = s.rotation[i] as number;
          o.scaleX = o.scaleY = s.scale[i] as number;
          o.tint = s.color[i] as number;
          draw.sprite(textures[s.texture[i] as number] as HTMLCanvasElement, s.x[i] as number, s.y[i] as number, o);
        }
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
  setup: "createRenderer(canvas, { smooth: false }); one draw.sprites per texture per frame, with per-copy scale, rotation and colour arrays.",
  supports: (scene) => scene.textures === 1,
  async create(canvas, textures, scene) {
    const { draw, gl } = setup(canvas);
    let pos = new Float32Array(0);
    const image = textures[0] as HTMLCanvasElement;
    return {
      draw(s) {
        if (pos.length < s.count * 2) pos = new Float32Array(s.count * 2);
        for (let i = 0; i < s.count; i++) {
          pos[i * 2] = s.x[i] as number;
          pos[i * 2 + 1] = s.y[i] as number;
        }
        draw.begin(BACKGROUND, WIDTH, HEIGHT, 1);
        const each = scene.rotation || scene.scale || scene.color ? { scale: s.scale, rotation: s.rotation, color: s.color } : undefined;
        draw.sprites(image, pos, s.count, undefined, each);
        draw.end();
      },
      sync: () => readPixel(gl),
    };
  },
};

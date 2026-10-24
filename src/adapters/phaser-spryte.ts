import type * as PhaserNS from "phaser";
import type { Draw } from "spryte";
import { readPixel } from "../gl.js";
import { type Adapter, type AdapterInstance, BACKGROUND_CSS, type FrameState, HEIGHT, type SceneSpec, WIDTH } from "../types.js";

type P = typeof PhaserNS;

/**
 * Phaser 4 with spryte drawing the sprites inside it: the game runs on a WebGL2 context from spryte's
 * `createPhaserContext`, and one `Extern` game object hands its slot in Phaser's frame to spryte
 * (`spryteExtern`, spryte 0.4+). Phaser still clears the frame and runs its display list; the Extern is the
 * only object on it. Setup otherwise as the Phaser adapters: pixelArt, no antialias, roundPixels, Phaser's loop
 * stopped and game.step() called per frame.
 */
async function boot(canvas: HTMLCanvasElement) {
  const [{ default: Phaser }, { createPhaserContext, spryteExtern }] = await Promise.all([import("phaser"), import("spryte/phaser")]);
  const P = Phaser as unknown as P;
  let game!: PhaserNS.Game;
  // Called each frame by the Extern, with the frame's state set by draw() before game.step().
  let render: (draw: Draw) => void = () => {};
  const scene = await new Promise<PhaserNS.Scene>((resolve) => {
    game = new P.Game({
      type: P.WEBGL,
      ...createPhaserContext(canvas, { antialias: false }),
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: BACKGROUND_CSS,
      pixelArt: true,
      antialias: false,
      antialiasGL: false,
      roundPixels: true,
      banner: false,
      audio: { noAudio: true },
      input: false,
      autoFocus: false,
      scene: {
        create(this: PhaserNS.Scene) {
          spryteExtern(this.add.extern(), (draw) => render(draw), { smooth: false });
          resolve(this);
        },
      },
    });
  });
  game.loop.stop();
  const gl = (game.renderer as PhaserNS.Renderer.WebGL.WebGLRenderer).gl as WebGL2RenderingContext;
  let time = performance.now();
  const step = (frame: (draw: Draw) => void) => {
    render = frame;
    time += 1000 / 60;
    game.step(time, 1000 / 60);
  };
  return { scene, gl, step };
}

// Scenes the Phaser adapters draw, so the comparison is like for like. Slices, churn, target, clip, upload and
// text aren't written yet.
const plain = (scene: SceneSpec) => !scene.slices && !scene.churn && !scene.target && !scene.clip && !scene.upload && !scene.text;

/** Phaser 4 with spryte inside: one `draw.sprite()` per sprite in the Extern. */
export const phaserSpryte: Adapter = {
  id: "phaser-spryte",
  label: "Phaser + spryte draw.sprite",
  package: "spryte",
  setup:
    "Phaser Game as for Image, on a WebGL2 context from spryte/phaser's createPhaserContext (no antialias); one Extern game object, drawn by spryteExtern with smooth: false. Each frame, inside the Extern, one draw.sprite per sprite with a reused options object.",
  supports: plain,
  async create(canvas, textures, scene): Promise<AdapterInstance> {
    const { gl, step } = await boot(canvas);
    const o = { rotation: 0, scaleX: 1, scaleY: 1, tint: 0xffffffff };
    return {
      draw(s: FrameState) {
        step((draw) => {
          for (let i = 0; i < s.count; i++) {
            if (scene.rotation) o.rotation = s.rotation[i] as number;
            if (scene.scale) o.scaleX = o.scaleY = s.scale[i] as number;
            if (scene.color) o.tint = s.color[i] as number;
            draw.sprite(textures[s.texture[i] as number] as HTMLCanvasElement, s.x[i] as number, s.y[i] as number, o);
          }
        });
      },
      sync: () => readPixel(gl),
    };
  },
};

/** Phaser 4 with spryte inside: the scene's arrays go to the GPU as they are, in one `draw.sprites()` call. */
export const phaserSpryteBulk: Adapter = {
  id: "phaser-spryte-bulk",
  label: "Phaser + spryte draw.sprites",
  package: "spryte",
  setup:
    "Phaser Game and Extern as for Phaser + spryte draw.sprite. Each frame, inside the Extern, one draw.sprites call with the scene's scale, rotation and colour arrays; positions are interleaved into one array per frame (the only per-sprite JavaScript), as in the spryte draw.sprites adapter.",
  supports: (scene) => scene.textures === 1 && plain(scene),
  async create(canvas, textures, scene): Promise<AdapterInstance> {
    const { gl, step } = await boot(canvas);
    const image = textures[0] as HTMLCanvasElement;
    let pos = new Float32Array(0);
    return {
      draw(s: FrameState) {
        if (pos.length < s.count * 2) pos = new Float32Array(s.count * 2);
        for (let i = 0; i < s.count; i++) {
          pos[i * 2] = s.x[i] as number;
          pos[i * 2 + 1] = s.y[i] as number;
        }
        const each = scene.rotation || scene.scale || scene.color ? { scale: s.scale, rotation: s.rotation, color: s.color } : undefined;
        step((draw) => draw.sprites(image, pos, s.count, undefined, each));
      },
      sync: () => readPixel(gl),
    };
  },
};

import type * as Pixi from "pixi.js";
import { readPixel } from "../gl.js";
import { type Adapter, type AdapterInstance, BACKGROUND_CSS, HEIGHT, type SceneSpec, WIDTH } from "../types.js";

/**
 * PixiJS 8, WebGL renderer (measured faster than its WebGPU renderer on these scenes; see METHOD.md),
 * no antialiasing, roundPixels on (matching the whole-pixel rule), ticker off (we call render()).
 * Maintainers: if there's a more idiomatic or faster setup, please open a PR.
 */
async function app(canvas: HTMLCanvasElement) {
  const PIXI = await import("pixi.js");
  const application = new PIXI.Application();
  await application.init({
    canvas,
    width: WIDTH,
    height: HEIGHT,
    background: BACKGROUND_CSS,
    preference: "webgl",
    antialias: false,
    autoStart: false,
    roundPixels: true,
  });
  const gl = (application.renderer as unknown as { gl: WebGL2RenderingContext }).gl;
  return { PIXI, application, gl };
}

const textureOf = (PIXI: typeof Pixi, image: HTMLCanvasElement) => {
  const t = PIXI.Texture.from(image);
  t.source.scaleMode = "nearest";
  return t;
};

/** PixiJS `Sprite`s on the stage: the general-purpose path. */
export const pixiSprite: Adapter = {
  id: "pixi-sprite",
  label: "PixiJS Sprite",
  package: "pixi.js",
  setup: "Application (WebGL, roundPixels, no antialias, no ticker); one Sprite per sprite, anchor 0.5, created once; properties the scene uses are set each frame.",
  supports: () => true,
  async create(canvas, textures, scene): Promise<AdapterInstance> {
    const { PIXI, application, gl } = await app(canvas);
    const texs = textures.map((t) => textureOf(PIXI, t));
    const sprites: Pixi.Sprite[] = [];
    return {
      draw(s) {
        for (let i = 0; i < s.count; i++) {
          let sp = sprites[i];
          if (!sp) {
            sp = new PIXI.Sprite(texs[s.texture[i] as number]);
            sp.anchor.set(0.5);
            sprites.push(sp);
            application.stage.addChild(sp);
          }
          sp.x = s.x[i] as number;
          sp.y = s.y[i] as number;
          if (scene.rotation) sp.rotation = s.rotation[i] as number;
          if (scene.scale) sp.scale.set(s.scale[i] as number);
          if (scene.color) {
            const c = s.color[i] as number;
            sp.tint = c >>> 8;
            sp.alpha = (c & 0xff) / 255;
          }
        }
        // Sprites beyond count (count only grows in a run) don't exist.
        application.render();
      },
      sync: () => readPixel(gl),
    };
  },
};

/** PixiJS `ParticleContainer`: the bulk path. Only the properties the scene changes are dynamic. */
export const pixiParticle: Adapter = {
  id: "pixi-particle",
  label: "PixiJS ParticleContainer",
  package: "pixi.js",
  setup: "Application as for Sprite; one ParticleContainer with dynamicProperties set to exactly what the scene changes per frame (position, plus rotation, scale and color where used).",
  supports: (scene: SceneSpec) => scene.textures === 1,
  async create(canvas, textures, scene): Promise<AdapterInstance> {
    const { PIXI, application, gl } = await app(canvas);
    const tex = textureOf(PIXI, textures[0] as HTMLCanvasElement);
    const container = new PIXI.ParticleContainer({
      dynamicProperties: { position: true, rotation: scene.rotation, scale: scene.scale, color: scene.color },
    });
    application.stage.addChild(container);
    const particles: Pixi.Particle[] = [];
    return {
      draw(s) {
        for (let i = 0; i < s.count; i++) {
          let p = particles[i];
          if (!p) {
            p = new PIXI.Particle({ texture: tex, anchorX: 0.5, anchorY: 0.5 });
            particles.push(p);
            container.addParticle(p);
          }
          p.x = s.x[i] as number;
          p.y = s.y[i] as number;
          if (scene.rotation) p.rotation = s.rotation[i] as number;
          if (scene.scale) p.scaleX = p.scaleY = s.scale[i] as number;
          if (scene.color) {
            const c = s.color[i] as number;
            p.tint = c >>> 8;
            p.alpha = (c & 0xff) / 255;
          }
        }
        application.render();
      },
      sync: () => readPixel(gl),
    };
  },
};

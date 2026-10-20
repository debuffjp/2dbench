import type * as Pixi from "pixi.js";
import { readPixel } from "../gl.js";
import { TEXT_SIZE } from "../text.js";
import { type Adapter, type AdapterInstance, BACKGROUND_CSS, type FrameState, HEIGHT, type SceneSpec, WIDTH } from "../types.js";

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

/**
 * Churn scenes: keep `objs` in step with the frame's ids. The oldest leave the front and new ones are appended,
 * so dead objects are removed and destroyed and new ones created, as a game spawning and despawning would.
 * If the ids don't line up (the scene was resized, which reorders it), everything is rebuilt.
 */
function syncChurn<T>(objs: T[], ids: number[], s: FrameState, make: (i: number) => T, remove: (count: number) => void): void {
  let drop = 0;
  while (drop < ids.length && (ids[drop] as number) < (s.id[0] as number)) drop++;
  const kept = ids.length - drop;
  const aligned = kept <= s.count && (kept === 0 || (ids[drop] === s.id[0] && ids[ids.length - 1] === s.id[kept - 1]));
  const gone = aligned ? drop : ids.length;
  if (gone) {
    remove(gone);
    objs.splice(0, gone);
    ids.splice(0, gone);
  }
  for (let i = objs.length; i < s.count; i++) {
    objs.push(make(i));
    ids.push(s.id[i] as number);
  }
  // Cheap check that the timed path stays honest: exactly the frame's sprites, in the frame's order.
  if (objs.length !== s.count || (s.count && (ids[0] !== s.id[0] || ids[s.count - 1] !== s.id[s.count - 1]))) throw new Error("churn: objects out of step with the frame");
}

/** TEXT_FONT as a PixiJS text style. */
const TEXT_STYLE = { fontFamily: "monospace", fontWeight: "bold", fontSize: TEXT_SIZE } as const;

/** Text scenes: one label object per label, created once; its string is set every frame (PixiJS skips unchanged ones) and its fill when the colour changes. */
function labels(
  application: Pixi.Application,
  gl: WebGL2RenderingContext,
  make: (text: string, fill: number) => Pixi.Text | Pixi.BitmapText,
  recolour: (t: Pixi.Text | Pixi.BitmapText, fill: number) => void,
): AdapterInstance {
  const items: (Pixi.Text | Pixi.BitmapText)[] = [];
  const fills: number[] = [];
  return {
    draw(s) {
      const text = s.text as string[];
      for (let i = 0; i < s.count; i++) {
        let t = items[i];
        if (!t) {
          t = make(text[i] as string, (s.color[i] as number) >>> 8);
          items.push(t);
          fills.push((s.color[i] as number) >>> 8);
          application.stage.addChild(t);
        }
        const fill = (s.color[i] as number) >>> 8;
        if (fills[i] !== fill) {
          recolour(t, fill);
          fills[i] = fill;
        }
        t.text = text[i] as string;
        t.x = s.x[i] as number;
        t.y = s.y[i] as number;
      }
      application.render();
    },
    sync: () => readPixel(gl),
  };
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
  setup: "Application (WebGL, roundPixels, no antialias, no ticker); one Sprite per sprite, anchor 0.5, created once; properties the scene uses are set each frame. Churn: dead Sprites are removed and destroyed, new ones created and added. Text: one Text per label (canvas-rasterised, resolution 1), string set each frame. Slice scenes: a cached Texture per source rectangle on the shared source, and a pool of Sprites shown or hidden as the count changes.",
  supports: () => true,
  async create(canvas, textures, scene): Promise<AdapterInstance> {
    const { PIXI, application, gl } = await app(canvas);
    if (scene.text) return labels(application, gl, (str, fill) => new PIXI.Text({ text: str, style: { ...TEXT_STYLE, fill }, resolution: 1 }), (t, fill) => {
        t.style.fill = fill;
      });
    const texs = textures.map((t) => textureOf(PIXI, t));
    const sprites: Pixi.Sprite[] = [];
    if (scene.slices) {
      // Slices: a Texture per source rectangle (cached; PixiJS's way of drawing part of an image), and a
      // pool of Sprites, shown or hidden as the slice count changes from frame to frame.
      const base = texs[0] as Pixi.Texture;
      const frames = new Map<number, Pixi.Texture>();
      const frameOf = (sx: number, sy: number, sw: number, sh: number) => {
        const key = ((sx * 4096 + sy) * 128 + sw) * 128 + sh;
        let t = frames.get(key);
        if (!t) {
          t = new PIXI.Texture({ source: base.source, frame: new PIXI.Rectangle(sx, sy, sw, sh) });
          frames.set(key, t);
        }
        return t;
      };
      return {
        draw(s) {
          for (let i = 0; i < s.count; i++) {
            let sp = sprites[i];
            if (!sp) {
              sp = new PIXI.Sprite(base);
              sprites.push(sp);
              application.stage.addChild(sp);
            }
            sp.visible = true;
            sp.texture = frameOf(s.sx[i] as number, s.sy[i] as number, s.sw[i] as number, s.sh[i] as number);
            sp.x = s.x[i] as number;
            sp.y = s.y[i] as number;
            sp.width = s.w[i] as number;
            sp.height = s.h[i] as number;
            const c = s.color[i] as number;
            sp.tint = c >>> 8;
            sp.alpha = (c & 0xff) / 255;
          }
          for (let i = s.count; i < sprites.length; i++) (sprites[i] as Pixi.Sprite).visible = false;
          application.render();
        },
        sync: () => readPixel(gl),
      };
    }
    const ids: number[] = [];
    const make = (i: number, s: FrameState) => {
      const sp = new PIXI.Sprite(texs[s.texture[i] as number]);
      sp.anchor.set(0.5);
      application.stage.addChild(sp);
      return sp;
    };
    return {
      draw(s) {
        if (scene.churn)
          syncChurn(sprites, ids, s, (i) => make(i, s), (n) => {
            for (const sp of application.stage.removeChildren(0, n)) sp.destroy();
          });
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
  setup: "Application as for Sprite; one ParticleContainer with dynamicProperties set to exactly what the scene changes per frame (position, plus rotation, scale and color where used). Churn: dead particles removed with removeParticles, new ones created and added.",
  // A ParticleContainer shares one texture region across particles; slices need a different one per sprite.
  supports: (scene: SceneSpec) => scene.textures === 1 && !scene.slices,
  async create(canvas, textures, scene): Promise<AdapterInstance> {
    const { PIXI, application, gl } = await app(canvas);
    const tex = textureOf(PIXI, textures[0] as HTMLCanvasElement);
    const container = new PIXI.ParticleContainer({
      dynamicProperties: { position: true, rotation: scene.rotation, scale: scene.scale, color: scene.color },
    });
    application.stage.addChild(container);
    const particles: Pixi.Particle[] = [];
    const ids: number[] = [];
    return {
      draw(s) {
        if (scene.churn)
          syncChurn(
            particles,
            ids,
            s,
            () => {
              const p = new PIXI.Particle({ texture: tex, anchorX: 0.5, anchorY: 0.5 });
              container.addParticle(p);
              return p;
            },
            (n) => container.removeParticles(0, n),
          );
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

/** PixiJS `BitmapText`: the API PixiJS recommends for text that changes often. Text scenes only. */
export const pixiBitmapText: Adapter = {
  id: "pixi-bitmaptext",
  label: "PixiJS BitmapText",
  package: "pixi.js",
  setup: "Application as for Sprite; BitmapFont.install once (white, the scene's font, resolution 1, nearest filtering, digits); one BitmapText per label, string set each frame, colour by tint.",
  supports: (scene) => !!scene.text,
  async create(canvas): Promise<AdapterInstance> {
    const { PIXI, application, gl } = await app(canvas);
    // A white font installed once, crisp (resolution 1, nearest filtering, like every other scene), tinted per label.
    PIXI.BitmapFont.install({ name: "bench", chars: "0123456789", resolution: 1, style: { ...TEXT_STYLE, fill: 0xffffff }, textureStyle: { scaleMode: "nearest" } });
    return labels(
      application,
      gl,
      (str, fill) => new PIXI.BitmapText({ text: str, style: { fontFamily: "bench", fontSize: TEXT_SIZE }, tint: fill }),
      (t, fill) => {
        t.tint = fill;
      },
    );
  },
};

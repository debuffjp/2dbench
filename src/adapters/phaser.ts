import type * as PhaserNS from "phaser";
import { readPixel } from "../gl.js";
import { type Adapter, type AdapterInstance, BACKGROUND_CSS, type FrameState, HEIGHT, type SceneSpec, SPRITE, WIDTH } from "../types.js";

type P = typeof PhaserNS;

/**
 * Phaser 4, WebGL renderer, pixelArt (nearest filtering, no antialias, roundPixels), one Scene. Phaser's own
 * requestAnimationFrame loop is stopped once the scene is created; each frame calls game.step(), which runs the
 * scene update and render exactly as the loop would, so the harness controls timing.
 * Phaser 4's WebGL renderer uses a WebGL1 context. Maintainers: if there's a more idiomatic or faster setup, please open a PR.
 */
async function boot(canvas: HTMLCanvasElement) {
  const Phaser = (await import("phaser")).default as unknown as P;
  let game!: PhaserNS.Game;
  const scene = await new Promise<PhaserNS.Scene>((resolve) => {
    game = new Phaser.Game({
      type: Phaser.WEBGL,
      canvas,
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
          resolve(this);
        },
      },
    });
  });
  // Stop Phaser's own loop: frames are stepped by draw().
  game.loop.stop();
  const gl = (game.renderer as PhaserNS.Renderer.WebGL.WebGLRenderer).gl;
  let time = performance.now();
  const step = () => {
    time += 1000 / 60;
    game.step(time, 1000 / 60);
  };
  return { Phaser, game, scene, gl, step };
}

const textureKeys = (scene: PhaserNS.Scene, textures: HTMLCanvasElement[]) =>
  textures.map((t, i) => {
    scene.textures.addCanvas(`t${i}`, t);
    return `t${i}`;
  });

/** Phaser's general path: one `Image` game object per sprite on the display list. */
export const phaserImage: Adapter = {
  id: "phaser-image",
  label: "Phaser Image",
  package: "phaser",
  setup:
    "Game (WEBGL, pixelArt: nearest, no antialias, roundPixels), one Scene; Phaser's loop stopped and game.step() called per frame. One Image per sprite (origin 0.5), created once with scene.add.image; properties the scene uses are set each frame (setTint + setAlpha for colour). Slice scenes: a cached texture Frame per source rectangle (texture.add), and a pool of Images (origin 0) shown or hidden, setFrame + setDisplaySize per slice.",
  // Not written yet: churn, render target, clip, upload and text scenes.
  supports: (scene: SceneSpec) => !scene.churn && !scene.target && !scene.clip && !scene.upload && !scene.text,
  async create(canvas, textures, scene): Promise<AdapterInstance> {
    const { scene: sc, gl, step } = await boot(canvas);
    const keys = textureKeys(sc, textures);
    const images: PhaserNS.GameObjects.Image[] = [];
    if (scene.slices) {
      const tex = sc.textures.get(keys[0] as string);
      const frames = new Map<number, string>();
      const frameOf = (sx: number, sy: number, sw: number, sh: number) => {
        const key = ((sx * 4096 + sy) * 128 + sw) * 128 + sh;
        let name = frames.get(key);
        if (name === undefined) {
          name = `f${frames.size}`;
          tex.add(name, 0, sx, sy, sw, sh);
          frames.set(key, name);
        }
        return name;
      };
      return {
        draw(s) {
          for (let i = 0; i < s.count; i++) {
            let im = images[i];
            if (!im) {
              im = sc.add.image(0, 0, keys[0] as string).setOrigin(0, 0);
              images.push(im);
            }
            im.visible = true;
            im.setFrame(frameOf(s.sx[i] as number, s.sy[i] as number, s.sw[i] as number, s.sh[i] as number), false, false);
            im.x = s.x[i] as number;
            im.y = s.y[i] as number;
            im.setDisplaySize(s.w[i] as number, s.h[i] as number);
            const c = s.color[i] as number;
            im.setTint(c >>> 8);
            im.alpha = (c & 0xff) / 255;
          }
          for (let i = s.count; i < images.length; i++) (images[i] as PhaserNS.GameObjects.Image).visible = false;
          step();
        },
        sync: () => readPixel(gl),
      };
    }
    return {
      draw(s: FrameState) {
        for (let i = 0; i < s.count; i++) {
          let im = images[i];
          if (!im) {
            im = sc.add.image(0, 0, keys[s.texture[i] as number] as string);
            images.push(im);
          }
          im.x = s.x[i] as number;
          im.y = s.y[i] as number;
          if (scene.rotation) im.rotation = s.rotation[i] as number;
          if (scene.scale) im.setScale(s.scale[i] as number);
          if (scene.color) {
            const c = s.color[i] as number;
            im.setTint(c >>> 8);
            im.alpha = (c & 0xff) / 255;
          }
        }
        // Images beyond count (count only grows in a run) don't exist.
        step();
      },
      sync: () => readPixel(gl),
    };
  },
};

/**
 * Phaser 4 `SpriteGPULayer`: the bulk path, one buffer of members drawn in one call. It's designed for members
 * that change rarely (or animate on the GPU); every member here changes every frame, so each one is rewritten
 * with editMember (one reused member object) and the whole buffer is re-uploaded, as Phaser does for edits.
 */
export const phaserGPULayer: Adapter = {
  id: "phaser-gpulayer",
  label: "Phaser SpriteGPULayer",
  package: "phaser",
  setup:
    "Game as for Image; one SpriteGPULayer (single texture), sized to the count. Each frame every member is rewritten with editMember from one reused member object (x, y, plus rotation, scaleX/scaleY, tint and alpha where the scene uses them); the layer re-uploads the edited buffer segments when it renders.",
  // One texture per layer (mixed has 4); slices need a frame per member; churn, target, clip, upload, text not written yet.
  supports: (scene: SceneSpec) => scene.textures === 1 && !scene.slices && !scene.churn && !scene.target && !scene.clip && !scene.upload && !scene.text,
  async create(canvas, textures, scene): Promise<AdapterInstance> {
    const { scene: sc, gl, step } = await boot(canvas);
    const [key] = textureKeys(sc, textures);
    let layer: PhaserNS.GameObjects.SpriteGPULayer | null = null;
    const m = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, alpha: 1, tintTopLeft: 0xffffff, tintTopRight: 0xffffff, tintBottomLeft: 0xffffff, tintBottomRight: 0xffffff };
    const set = (s: FrameState, i: number) => {
      m.x = s.x[i] as number;
      m.y = s.y[i] as number;
      if (scene.rotation) m.rotation = s.rotation[i] as number;
      if (scene.scale) m.scaleX = m.scaleY = s.scale[i] as number;
      if (scene.color) {
        const c = s.color[i] as number;
        m.tintTopLeft = m.tintTopRight = m.tintBottomLeft = m.tintBottomRight = c >>> 8;
        m.alpha = (c & 0xff) / 255;
      }
    };
    return {
      draw(s) {
        if (!layer || layer.size < s.count) {
          // Count only grows in a run: grow the layer's capacity, then append the new members.
          if (!layer) layer = sc.add.spriteGPULayer(key as string, s.count);
          else layer.resize(s.count);
        }
        const l = layer;
        for (let i = 0; i < l.memberCount; i++) {
          set(s, i);
          l.editMember(i, m);
        }
        for (let i = l.memberCount; i < s.count; i++) {
          set(s, i);
          l.addMember(m);
        }
        step();
      },
      sync: () => readPixel(gl),
    };
  },
};

/** Phaser `Blitter`: position-only `Bob`s, Phaser's lightweight path for many copies of a frame. */
export const phaserBlitter: Adapter = {
  id: "phaser-blitter",
  label: "Phaser Blitter",
  package: "phaser",
  setup: "Game as for Image; one Blitter, one Bob per sprite created once with blitter.create; x and y set each frame. Bobs have no rotation or scale, so only position-only scenes.",
  // Bobs have position, alpha, tint and frame, but no rotation or scale; one texture per Blitter.
  supports: (scene: SceneSpec) => scene.textures === 1 && !scene.rotation && !scene.scale && !scene.color && !scene.slices && !scene.churn && !scene.target && !scene.clip && !scene.upload && !scene.text,
  async create(canvas, textures): Promise<AdapterInstance> {
    const { scene: sc, gl, step } = await boot(canvas);
    const [key] = textureKeys(sc, textures);
    const blitter = sc.add.blitter(0, 0, key as string);
    const bobs: PhaserNS.GameObjects.Bob[] = [];
    // Bobs draw from their top-left corner; the scene's positions are centres of 16×16 sprites.
    const half = SPRITE / 2;
    return {
      draw(s) {
        for (let i = 0; i < s.count; i++) {
          let b = bobs[i];
          if (!b) {
            b = blitter.create(0, 0);
            bobs.push(b);
          }
          b.x = (s.x[i] as number) - half;
          b.y = (s.y[i] as number) - half;
        }
        step();
      },
      sync: () => readPixel(gl),
    };
  },
};

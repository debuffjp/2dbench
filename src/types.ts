/**
 * The contract every renderer plugs into. Scenes own the simulation and write plain typed arrays each
 * frame; adapters only draw them. So every library does the same work by construction, and adding a
 * library is one file in src/adapters.
 */

/** What a scene asks of a renderer. An adapter that can't do something honestly says so in `supports`. */
export interface SceneSpec {
  id: string;
  /** One line for reports. */
  description: string;
  /** Sprites use per-sprite rotation. */
  rotation: boolean;
  /** Sprites use per-sprite uniform scale. */
  scale: boolean;
  /** Sprites use per-sprite tint and alpha (`color`). */
  color: boolean;
  /** Number of distinct textures sprites are drawn from (separate images, not an atlas). */
  textures: number;
  /**
   * Sprites are slices: each draws part of the texture (`sx, sy, sw, sh`, in texture pixels) at any size
   * (`w, h`), with `x, y` its top-left corner, not its centre. Rotation and scale aren't used.
   */
  slices: boolean;
  /** For `slices` scenes, how many sprites are drawn per unit of `count` varies per frame (e.g. raycaster strips). */
  countMeans?: string;
}

/**
 * The world for one frame, structure-of-arrays. Length `count` is valid; arrays may be longer.
 * Positions are sprite centres in canvas pixels; sprites are 16×16 drawn at their texture's size × scale.
 */
export interface FrameState {
  count: number;
  /** Frame number since the scene started (for adapters that animate nothing themselves). */
  frame: number;
  x: Float32Array;
  y: Float32Array;
  /** Uniform scale (1 when the scene doesn't use scale). */
  scale: Float32Array;
  /** Radians (0 when the scene doesn't use rotation). */
  rotation: Float32Array;
  /** 0xRRGGBBAA tint × alpha (0xffffffff when the scene doesn't use color). */
  color: Uint32Array;
  /** Index into the textures array (0 when the scene has one texture). */
  texture: Uint8Array;
  /** `slices` scenes only: source rectangle in texture pixels, and drawn size. Empty otherwise. */
  sx: Float32Array;
  sy: Float32Array;
  sw: Float32Array;
  sh: Float32Array;
  w: Float32Array;
  h: Float32Array;
}

/** What `page.ts` drives: a scene's simulation. `count` is the scene's load dial (sprites, or enemies…). */
export interface Sim {
  readonly state: FrameState;
  resize(count: number): void;
  step(): void;
}

export interface AdapterInstance {
  /** Draw one frame of `state` to the canvas, clearing to BACKGROUND first. */
  draw(state: FrameState): void;
  /** Block until the GPU has finished the frame (a 1-pixel readback), so its cost is measured. */
  sync(): void | Promise<void>;
}

export interface Adapter {
  /** Short id used in URLs and results, e.g. "pixi-particle". */
  id: string;
  /** Library and API, e.g. "PixiJS ParticleContainer". */
  label: string;
  /** npm package whose version is recorded with results ("" for hand-written code). */
  package: string;
  /** How the library is configured, so readers can check it's idiomatic. Shown in reports. */
  setup: string;
  supports(scene: SceneSpec): boolean;
  create(canvas: HTMLCanvasElement, textures: HTMLCanvasElement[], scene: SceneSpec): Promise<AdapterInstance>;
}

export const WIDTH = 960;
export const HEIGHT = 540;
/** Clear colour, #11140d. */
export const BACKGROUND = 0x11140dff;
export const BACKGROUND_CSS = "#11140d";
export const SPRITE = 16;

import type { Adapter } from "../types.js";
import { canvas2d } from "./canvas2d.js";
import { pixiParticle, pixiSprite } from "./pixi.js";
import { spryteBulk, spryteSprite } from "./spryte.js";
import { webgl2Baseline } from "./webgl2-baseline.js";

/**
 * Every adapter, by id. The first is the parity reference: hand-written, so no library referees itself.
 * Adding a library: write src/adapters/<library>.ts implementing Adapter, add it here, open a PR.
 */
export const ADAPTERS: Adapter[] = [webgl2Baseline, canvas2d, spryteSprite, spryteBulk, pixiSprite, pixiParticle];

export const REFERENCE = webgl2Baseline.id;

import type { Adapter } from "../types.js";
import { canvas2d } from "./canvas2d.js";
import { pixiBitmapText, pixiParticle, pixiSprite } from "./pixi.js";
import { spryteBulk, spryteSprite } from "./spryte.js";

/**
 * Every adapter, by id. The first is the parity reference: PixiJS Sprite, the most widely used 2D web
 * renderer, which supports every scene and isn't made by 2dbench's authors (who also make spryte).
 * Adding a library: write src/adapters/<library>.ts implementing Adapter, add it here, open a PR.
 */
export const ADAPTERS: Adapter[] = [pixiSprite, pixiParticle, pixiBitmapText, spryteSprite, spryteBulk, canvas2d];

export const REFERENCE = pixiSprite.id;

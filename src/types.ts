import type { EmitterConfig } from './Emitter.js';

export enum Rarity {
  Common = 0,
  Uncommon = 1,
  Rare = 2,
  Epic = 3,
  Legendary = 4,
  Unique = 5,
}

export interface CargoCacheParams {
  rarity: Rarity;
  x?: number;
  y?: number;
  size?: number;
  /** Indices of layers to render. Undefined = all layers. Used by the
   *  examples harness to inspect a single layer in isolation; out-of-range
   *  indices are silently dropped. */
  layerMask?: number[];
}

// One Niagara emitter slot in a loot-drop system. `kind` selects the shader
// (and for `partic*` the texture binding). `dmp` is the per-emitter Dynamic
// Material Parameter [0] — the four-float vector that the underlying HLSL
// reads via GetDynamicParameter. Each material interprets it differently:
//   sphere:  (r1, r2, d1, d2) — outer/inner halo radii + depth/sharpness
//   flash:   (NI_X, NI_Y, out_X, out_y) — inner/outer noise UV scales
//   partic*: (.r, *, *, *)   — emissive opacity multiplier
export type LayerKind = 'sphere' | 'star' | 'flash' | 'partic' | 'partic2' | 'partic3' | 'orb' | 'ring' | 'glow' | 'flare';

// Niagara FRichCurve shapes the loot-drop graphs use for size_over_life and
// alpha_over_life. Per the spec header: "all curves have easeInOutSine
// smoothing unless otherwise specified" — so these are easeInOutSine-smoothed
// piecewise curves, not linear ramps.
//   bell      [0,0, 0.5,1, 1,0]      → eased bell, peak 1
//   bellLow   [0,0, 0.5,0.2, 1,0]    → eased bell × 0.2
//   bellMid   [0,0, 0.5,0.5, 1,0]    → eased bell × 0.5
//   rampUp    [0,0, 1,1]             → easeInOutSine(t)
//   rampDown  [0,1, 1,0]             → 1 - easeInOutSine(t)
//   hold      constant 1.0           → no change over life (static layers)
export type CurveShape = 'bell' | 'bellLow' | 'bellMid' | 'rampUp' | 'rampDown' | 'hold';

export interface LayerSpec {
  kind: LayerKind;
  emitter: EmitterConfig;
  /** Override DMP[0]. Default: kind-specific defaults from the HLSL. */
  dmp?: [number, number, number, number];
  /** size_over_life curve. Default: 'bell'. */
  sizeCurve?: CurveShape;
  /** alpha_over_life curve. Default: kind-specific. */
  alphaCurve?: CurveShape;
}

export interface RarityConfig {
  color: [number, number, number];
  layers: LayerSpec[];
}

export interface RiftRendererOptions {
  canvas?: HTMLCanvasElement;
  /** Folder path (served URL) holding T_NOISE.PNG, T_glow_2.PNG, etc. */
  texturePath: string;
}

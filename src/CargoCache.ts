import { Rarity, CargoCacheParams, RarityConfig, LayerSpec } from './types.js';
import { RARITY_CONFIGS } from './rarity.js';
import { Emitter, EmitterConfig } from './Emitter.js';

// Each cache owns one Emitter per layer in its rarity's Niagara system, in
// declared order. Rare has 6 layers, Epic has 11; the list is ordered
// because draw order matters (back-to-front additive composition) and
// because each layer carries its own DMP[0] which the renderer reads via
// `layers[i].spec.dmp`.
export interface OwnedLayer {
  spec: LayerSpec;
  emitter: Emitter;
}

const SCALE = (e: EmitterConfig, s: number): EmitterConfig => {
  const out: EmitterConfig = { ...e };
  switch (e.size.kind) {
    case 'fixed':
      out.size = { kind: 'fixed', value: e.size.value * s };
      break;
    case 'rangeUniform':
      out.size = { kind: 'rangeUniform', min: e.size.min * s, max: e.size.max * s };
      break;
    case 'rangeXY':
      out.size = {
        kind: 'rangeXY',
        min: [e.size.min[0] * s, e.size.min[1] * s],
        max: [e.size.max[0] * s, e.size.max[1] * s],
      };
      break;
  }
  if (e.spawnRadius != null) out.spawnRadius = e.spawnRadius * s;
  if (e.spawnShape) {
    if (e.spawnShape.kind === 'disc' || e.spawnShape.kind === 'ring') {
      out.spawnShape = { kind: e.spawnShape.kind, radius: e.spawnShape.radius * s };
    }
  }
  if (e.velocityFromPoint != null) {
    out.velocityFromPoint = typeof e.velocityFromPoint === 'number'
      ? e.velocityFromPoint * s
      : [e.velocityFromPoint[0] * s, e.velocityFromPoint[1] * s];
  }
  if (e.curlNoiseStrength != null) out.curlNoiseStrength = e.curlNoiseStrength * s;
  if (e.positionOffset) out.positionOffset = [e.positionOffset[0] * s, e.positionOffset[1] * s];
  return out;
};

export class CargoCache {
  readonly rarity: Rarity;
  readonly config: RarityConfig;
  x: number;
  y: number;
  size: number;
  birthTime: number;

  readonly layers: OwnedLayer[] = [];

  private _destroying = false;
  private _destroyTime = 0;
  private _finished = false;
  private _onFinished: (() => void) | null = null;

  constructor(params: CargoCacheParams, birthTime: number) {
    this.rarity = params.rarity;
    this.config = RARITY_CONFIGS[params.rarity];
    this.x = params.x ?? 0;
    this.y = params.y ?? 0;
    this.size = params.size ?? 1.0;
    this.birthTime = birthTime;

    // layerMask = which indices to keep (undefined = all). We skip emitter
    // construction for excluded layers entirely so they cost nothing.
    const mask = params.layerMask
      ? new Set(params.layerMask)
      : null;
    this.config.layers.forEach((spec, idx) => {
      if (mask && !mask.has(idx)) return;
      this.layers.push({
        spec,
        emitter: new Emitter(SCALE(spec.emitter, this.size)),
      });
    });
  }

  destroy(): void {
    if (this._destroying) return;
    this._destroying = true;
  }

  /** Renderer calls this each frame: advances every owned emitter and stamps
   *  destroyTime exactly once on the first tick after destroy() is called. */
  tick(now: number, dt: number): void {
    if (this._destroying && this._destroyTime === 0) {
      this._destroyTime = now;
    }
    for (const l of this.layers) l.emitter.tick(now, dt);

    if (this._destroyTime > 0 && now - this._destroyTime > 0.7) {
      this._finished = true;
      this._onFinished?.();
    }
  }

  get destroying(): boolean { return this._destroying; }
  get destroyTime(): number { return this._destroyTime; }
  get finished(): boolean { return this._finished; }
  set onFinished(cb: (() => void) | null) { this._onFinished = cb; }
}

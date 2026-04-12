import { Rarity, CargoCacheParams, RarityConfig } from './types.js';
import { RARITY_CONFIGS } from './rarity.js';

export class CargoCache {
  readonly rarity: Rarity;
  readonly config: RarityConfig;
  x: number;
  y: number;
  size: number;
  birthTime: number;

  private _destroying = false;
  private _destroyTime = 0;
  private _finished = false;
  private _onFinished: (() => void) | null = null;

  // Particle seeds (written once, never updated)
  readonly particleSeeds: Float32Array;

  constructor(params: CargoCacheParams, birthTime: number) {
    this.rarity = params.rarity;
    this.config = RARITY_CONFIGS[params.rarity];
    this.x = params.x ?? 0;
    this.y = params.y ?? 0;
    this.size = params.size ?? 1.0;
    this.birthTime = birthTime;

    // Generate particle seeds
    const count = this.config.particleCount;
    this.particleSeeds = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      this.particleSeeds[i * 2] = Math.random();       // seed
      this.particleSeeds[i * 2 + 1] = Math.random();   // lifetime offset
    }
  }

  destroy(): void {
    if (this._destroying) return;
    this._destroying = true;
  }

  /** Called by renderer each frame to set destroyTime once */
  updateDestroy(time: number): void {
    if (this._destroying && this._destroyTime === 0) {
      this._destroyTime = time;
    }
    if (this._destroyTime > 0 && time - this._destroyTime > 0.7) {
      this._finished = true;
      this._onFinished?.();
    }
  }

  get destroying(): boolean {
    return this._destroying;
  }

  get destroyTime(): number {
    return this._destroyTime;
  }

  get finished(): boolean {
    return this._finished;
  }

  set onFinished(cb: (() => void) | null) {
    this._onFinished = cb;
  }

  /** Write instance data for layers 1-4 into the target array at the given offset */
  writeInstanceData(target: Float32Array, offset: number): void {
    target[offset]     = this.x;
    target[offset + 1] = this.y;
    target[offset + 2] = this.size;
    target[offset + 3] = this.birthTime;
    target[offset + 4] = this.config.color[0];
    target[offset + 5] = this.config.color[1];
    target[offset + 6] = this.config.color[2];
    target[offset + 7] = 1.0;
    target[offset + 8] = this._destroyTime;
    target[offset + 9] = this.config.starBreathes ? 1.0 : 0.0;
  }

  /** Batch key for instancing: same rarity + size = same batch */
  get batchKey(): string {
    return `${this.rarity}_${this.size}`;
  }
}

// Niagara-equivalent emitter. Owns a fixed-size pool of particles and runs
// a continuous spawn loop driven by `spawnRate`. Each particle carries its
// own birth time, lifetime, dimensions, initial rotation, *and* its own
// motion state (position offset, velocity, constant acceleration). The
// shader turns those into a normalized 0..1 lifecycle param `t` so curves
// baked in the fragment shader can drive size/alpha over the particle's
// life.
//
// Pool layout (packed Float32Array, STRIDE floats per slot):
//   [0,1]  offset (x,y) from emitter origin
//   [2,3]  velocity (vx, vy) in pixels/sec
//   [4,5]  size (w,h) in pixels
//   [6]    birthTime (seconds)
//   [7]    lifetime  (seconds)
//   [8]    initial rotation (radians)
//   [9,10] constant acceleration (ax, ay) — pseudo curl-noise
//
// Curl noise is approximated as a constant per-particle acceleration vector
// drawn at spawn — preserves the "particles don't all go the same way" feel
// without simulating a vector field. Enough for visual parity at this scale.

export type LifetimeSpec = number | [number, number];
export type SizeSpec =
  | { kind: 'fixed'; value: number }
  | { kind: 'rangeXY'; min: [number, number]; max: [number, number] }
  | { kind: 'rangeUniform'; min: number; max: number };

export type SpawnShape =
  | { kind: 'point' }
  | { kind: 'disc';  radius: number }
  | { kind: 'ring';  radius: number };

export interface EmitterConfig {
  spawnRate: number;
  lifetime: LifetimeSpec;
  size: SizeSpec;
  rotationRate?: number;
  spawnRadius?: number;            // legacy alias for {kind:'disc'}
  spawnShape?: SpawnShape;
  /** Initial radial speed from emitter origin (px/sec). Number or [min,max]. */
  velocityFromPoint?: number | [number, number];
  /** Velocity decay coefficient: v *= exp(-drag * dt). */
  drag?: number;
  /** Approximated curl-noise: per-particle constant accel magnitude (px/sec²). */
  curlNoiseStrength?: number;
  /** If false, initial rotation is 0 (axis-aligned) instead of random — needed
   *  for a clean vertical+horizontal '+' star. Default true. */
  randomRotation?: boolean;
  /** Constant offset (px) added to every spawn position — places a layer off
   *  the drop's center, e.g. the ground ring sitting below it. */
  positionOffset?: [number, number];
}

const STRIDE = 11;

const sampleLifetime = (spec: LifetimeSpec): number =>
  typeof spec === 'number' ? spec : spec[0] + Math.random() * (spec[1] - spec[0]);

const sampleSize = (spec: SizeSpec): [number, number] => {
  switch (spec.kind) {
    case 'fixed':        return [spec.value, spec.value];
    case 'rangeUniform': {
      const v = spec.min + Math.random() * (spec.max - spec.min);
      return [v, v];
    }
    case 'rangeXY':      return [
      spec.min[0] + Math.random() * (spec.max[0] - spec.min[0]),
      spec.min[1] + Math.random() * (spec.max[1] - spec.min[1]),
    ];
  }
};

const sampleSpeed = (spec: number | [number, number]): number =>
  typeof spec === 'number' ? spec : spec[0] + Math.random() * (spec[1] - spec[0]);

export class Emitter {
  readonly config: EmitterConfig;
  readonly rotationRate: number;
  readonly drag: number;
  private capacity: number;
  private pool: Float32Array;
  private count = 0;
  private spawnAccum = 0;
  private lastTickNow = 0;

  constructor(config: EmitterConfig) {
    this.config = config;
    this.rotationRate = config.rotationRate ?? 0;
    this.drag = config.drag ?? 0;

    const maxLife = typeof config.lifetime === 'number'
      ? config.lifetime
      : config.lifetime[1];
    this.capacity = Math.max(2, Math.ceil(config.spawnRate * maxLife * 1.25) + 2);
    this.pool = new Float32Array(this.capacity * STRIDE);
  }

  tick(now: number, dt: number): void {
    // Advance simulation: position += velocity*dt, velocity *= drag decay
    // + constant accel*dt. We update before eviction so dead particles still
    // count for one final frame at correct position.
    const dragMul = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.count; i++) {
      const b = i * STRIDE;
      this.pool[b]     += this.pool[b + 2] * dt;
      this.pool[b + 1] += this.pool[b + 3] * dt;
      this.pool[b + 2]  = this.pool[b + 2] * dragMul + this.pool[b + 9]  * dt;
      this.pool[b + 3]  = this.pool[b + 3] * dragMul + this.pool[b + 10] * dt;
    }

    // Evict dead via swap-remove
    let i = 0;
    while (i < this.count) {
      const base = i * STRIDE;
      const birth = this.pool[base + 6];
      const life = this.pool[base + 7];
      if (now - birth >= life) {
        const lastBase = (this.count - 1) * STRIDE;
        if (i !== this.count - 1) {
          this.pool.copyWithin(base, lastBase, lastBase + STRIDE);
        }
        this.count--;
      } else {
        i++;
      }
    }

    this.spawnAccum += dt * this.config.spawnRate;
    while (this.spawnAccum >= 1.0 && this.count < this.capacity) {
      this.spawn(now);
      this.spawnAccum -= 1.0;
    }
    if (this.count >= this.capacity) this.spawnAccum = 0;
    this.lastTickNow = now;
  }

  private spawn(now: number): void {
    const base = this.count * STRIDE;

    // Spawn position from shape (or legacy spawnRadius / point)
    let ox = 0, oy = 0;
    const shape: SpawnShape = this.config.spawnShape
      ?? (this.config.spawnRadius != null && this.config.spawnRadius > 0
        ? { kind: 'disc', radius: this.config.spawnRadius }
        : { kind: 'point' });
    if (shape.kind === 'disc') {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * shape.radius;
      ox = Math.cos(a) * r;
      oy = Math.sin(a) * r;
    } else if (shape.kind === 'ring') {
      const a = Math.random() * Math.PI * 2;
      ox = Math.cos(a) * shape.radius;
      oy = Math.sin(a) * shape.radius;
    }

    // Initial velocity: radial from origin if velocityFromPoint set, else 0
    let vx = 0, vy = 0;
    if (this.config.velocityFromPoint != null) {
      const speed = sampleSpeed(this.config.velocityFromPoint);
      const len = Math.hypot(ox, oy);
      if (len > 1e-4) {
        vx = (ox / len) * speed;
        vy = (oy / len) * speed;
      } else {
        const a = Math.random() * Math.PI * 2;
        vx = Math.cos(a) * speed;
        vy = Math.sin(a) * speed;
      }
    }

    // Constant per-particle acceleration ≈ curl noise force (random direction)
    let ax = 0, ay = 0;
    if (this.config.curlNoiseStrength != null && this.config.curlNoiseStrength > 0) {
      const a = Math.random() * Math.PI * 2;
      const m = this.config.curlNoiseStrength * (0.5 + Math.random() * 0.5);
      ax = Math.cos(a) * m;
      ay = Math.sin(a) * m;
    }

    if (this.config.positionOffset) {
      ox += this.config.positionOffset[0];
      oy += this.config.positionOffset[1];
    }

    const [sx, sy] = sampleSize(this.config.size);
    this.pool[base]     = ox;
    this.pool[base + 1] = oy;
    this.pool[base + 2] = vx;
    this.pool[base + 3] = vy;
    this.pool[base + 4] = sx;
    this.pool[base + 5] = sy;
    this.pool[base + 6] = now;
    this.pool[base + 7] = sampleLifetime(this.config.lifetime);
    this.pool[base + 8] = this.config.randomRotation === false ? 0 : Math.random() * Math.PI * 2;
    this.pool[base + 9]  = ax;
    this.pool[base + 10] = ay;
    this.count++;
  }

  /**
   * Pack live particles into the GPU instance buffer at floatOffset.
   * Stride per instance: 12 floats — pos(2) + size(2) + birth + life +
   * rotation + color(4) + destroyTime.
   */
  pack(
    out: Float32Array,
    floatOffset: number,
    cacheX: number,
    cacheY: number,
    color: readonly [number, number, number],
    destroyTime: number,
  ): number {
    let dst = floatOffset;
    for (let i = 0; i < this.count; i++) {
      const src = i * STRIDE;
      out[dst]      = cacheX + this.pool[src];
      out[dst + 1]  = cacheY + this.pool[src + 1];
      out[dst + 2]  = this.pool[src + 4];
      out[dst + 3]  = this.pool[src + 5];
      out[dst + 4]  = this.pool[src + 6];
      out[dst + 5]  = this.pool[src + 7];
      out[dst + 6]  = this.pool[src + 8];
      out[dst + 7]  = color[0];
      out[dst + 8]  = color[1];
      out[dst + 9]  = color[2];
      out[dst + 10] = 1.0;
      out[dst + 11] = destroyTime;
      dst += 12;
    }
    return this.count;
  }

  get liveCount(): number { return this.count; }
}

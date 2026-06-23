import { CargoCacheParams, RiftRendererOptions, LayerKind, CurveShape } from './types.js';
import { CargoCache } from './CargoCache.js';
import { TIME_WRAP } from './Emitter.js';
import { getOrCreateProgram } from './gl/programCache.js';
import {
  createQuadBuffer,
  createInstanceBuffer,
  setupInstanceAttributes,
  FLOATS_PER_INSTANCE,
} from './gl/buffers.js';
import { Bloom } from './gl/postprocess.js';
import { sphereVert, sphereFrag } from './shaders/sphere.js';
import { starVert, starFrag } from './shaders/star.js';
import { flashVert, flashFrag } from './shaders/flash.js';
import { particVert, particFrag } from './shaders/partic.js';
import { ringVert, ringFrag } from './shaders/ring.js';
import { flareVert, flareFrag } from './shaders/flare.js';
import { loadTextures, TextureSet } from './textures.js';

interface LayerProgram {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  uniforms: {
    u_time: WebGLUniformLocation | null;
    u_resolution: WebGLUniformLocation | null;
    u_rotationRate: WebGLUniformLocation | null;
    u_dmp: WebGLUniformLocation | null;
    u_noiseTex: WebGLUniformLocation | null;
    u_particTex: WebGLUniformLocation | null;
    u_sizeCurve: WebGLUniformLocation | null;
    u_alphaCurve: WebGLUniformLocation | null;
    u_breathPhase: WebGLUniformLocation | null;
  };
}

// One record is the whole definition of a layer kind: which shader pair draws
// it, which compiled program it shares, its default DMP[0] and curve shapes,
// and the sampler/texture it binds (if any). Adding a kind is now a single
// object literal here plus its entry in the LayerKind union — TypeScript won't
// compile until every field is supplied, so there is no "edit six tables and
// hope" ritual and no silent wrong-default. compileLayers() and drawBucket()
// both iterate this one source instead of cross-referencing parallel maps.
//
// `programKey` lets several kinds reuse one compiled program: the partic family
// (incl. orb) shares the partic shader and differs only by bound texture; glow
// reuses the ring program (same procedural-gradient shader). `texture` names
// the sampler uniform and the TextureSet entry to bind for that draw.
//
// Defaults (DMP / curves) come straight from each material's HLSL
// `GetDynamicParameter(...)` and its size_over_life / alpha_over_life graphs.
//
// Only 'glow', 'ring', 'flare', 'star', 'partic' appear in the current rarity
// recipes; 'sphere', 'flash', 'partic2', 'partic3', 'orb' are retained as
// opt-in kinds for consumers who fork RARITY_CONFIGS. Each still compiles a
// program (and loads its sprite) at startup even when unused — drop the entry
// here and from LayerKind if bundle/startup cost ever matters.
interface LayerKindDef {
  shaders: [string, string];   // [vertex, fragment] source
  programKey: string;          // shared program identity (partic family, glow→ring)
  dmp: [number, number, number, number];
  sizeCurve: CurveShape;
  alphaCurve: CurveShape;
  texture?: { sampler: 'u_noiseTex' | 'u_particTex'; key: keyof TextureSet };
}

const LAYER_KINDS: Record<LayerKind, LayerKindDef> = {
  sphere:  { shaders: [sphereVert, sphereFrag], programKey: 'sphere', dmp: [0.5, 0.2, 1.0, 1.0],  sizeCurve: 'bell',   alphaCurve: 'rampDown' },
  star:    { shaders: [starVert,   starFrag],   programKey: 'star',   dmp: [1.0, 1.0, 1.0, 1.0],   sizeCurve: 'bell',   alphaCurve: 'bellLow' },
  flash:   { shaders: [flashVert,  flashFrag],  programKey: 'flash',  dmp: [5.0, 0.05, 2.0, 0.05], sizeCurve: 'rampUp', alphaCurve: 'bellLow', texture: { sampler: 'u_noiseTex',  key: 'noise' } },
  partic:  { shaders: [particVert, particFrag], programKey: 'partic', dmp: [1.0, 1.0, 1.0, 1.0],   sizeCurve: 'bell',   alphaCurve: 'bellLow', texture: { sampler: 'u_particTex', key: 'glow2' } },
  partic2: { shaders: [particVert, particFrag], programKey: 'partic', dmp: [1.0, 1.0, 1.0, 1.0],   sizeCurve: 'bell',   alphaCurve: 'bellLow', texture: { sampler: 'u_particTex', key: 'cell1' } },
  partic3: { shaders: [particVert, particFrag], programKey: 'partic', dmp: [1.0, 1.0, 1.0, 1.0],   sizeCurve: 'bell',   alphaCurve: 'bellLow', texture: { sampler: 'u_particTex', key: 'loot' } },
  // Body holds full size across its life (overlapping instances average to a
  // steady orb) rather than pulsing like a bell.
  orb:     { shaders: [particVert, particFrag], programKey: 'partic', dmp: [1.0, 1.0, 1.0, 1.0],   sizeCurve: 'rampUp', alphaCurve: 'bell',    texture: { sampler: 'u_particTex', key: 'sphere' } },
  // The ring / glow are single static `burst` instances — they hold their
  // size/alpha rather than ramping, so each reads as one steady circle.
  ring:    { shaders: [ringVert,   ringFrag],   programKey: 'ring',   dmp: [0.45, 0.75, 0.5, 0.8], sizeCurve: 'hold',   alphaCurve: 'hold' },   // x=inner radius, y=peak, z=reach, w=falloff exp
  glow:    { shaders: [ringVert,   ringFrag],   programKey: 'ring',   dmp: [0.0, 0.6, 0.7, 0.8],   sizeCurve: 'hold',   alphaCurve: 'hold' },   // L0 center gradient (radius 0 = solid-centered)
  flare:   { shaders: [flareVert,  flareFrag],  programKey: 'flare',  dmp: [7.0, 0.5, 0.95, 1.0],  sizeCurve: 'hold',   alphaCurve: 'hold' },   // x=tongue freq, y=drift speed, z=reach, w=intensity
};

// Curve enum mapping must match evalCurve() in src/shaders/common.ts.
const CURVE_ID: Record<CurveShape, number> = {
  bell:     0,
  bellLow:  1,
  bellMid:  2,
  rampUp:   3,
  rampDown: 4,
  hold:     5,
};

export class RiftRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private programCache = new Map<string, WebGLProgram>();
  private quadBuffer: WebGLBuffer;
  private instanceBuffer: WebGLBuffer;
  private instanceData = new Float32Array(0);
  private instanceCapacity = 0;

  private layers = new Map<LayerKind, LayerProgram>();
  private textures: TextureSet | null = null;
  private textureLoad: Promise<void>;
  private bloom: Bloom;

  private caches = new Set<CargoCache>();
  /** When non-null, freezes the star breath sine at this phase (radians) —
   *  used by the contact-sheet capture so every cell shows the same phase. */
  breathPhase: number | null = null;
  private animFrameId = 0;
  private lastTickTime = 0;
  // Monotonic simulation clock, advanced by the *clamped* per-frame dt. Spawn
  // accumulation and particle eviction both read this, so they stay in sync
  // regardless of frame rate — a slow frame slows time uniformly instead of
  // letting eviction outrun spawning (which drained emitters under low fps).
  private simTime = 0;
  private destroyed = false;

  constructor(options: RiftRendererOptions) {
    if (options.canvas) {
      this.canvas = options.canvas;
    } else {
      this.canvas = document.createElement('canvas');
      this.canvas.style.position = 'absolute';
      this.canvas.style.top = '0';
      this.canvas.style.left = '0';
      this.canvas.style.width = '100%';
      this.canvas.style.height = '100%';
      document.body.appendChild(this.canvas);
    }

    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
    });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    this.quadBuffer = createQuadBuffer(gl);
    this.instanceBuffer = createInstanceBuffer(gl);
    this.bloom = new Bloom(gl);

    this.compileLayers();

    this.lastTickTime = performance.now() / 1000;
    this.tick = this.tick.bind(this);

    // Render loop only starts once textures are in. Both flash and partic
    // shaders sample textures every frame, so a missing texture would render
    // as solid color (or black, with the fragment discards now in place).
    this.textureLoad = loadTextures(gl, options.texturePath).then((tex) => {
      this.textures = tex;
      this.lastTickTime = performance.now() / 1000;
      this.animFrameId = requestAnimationFrame(this.tick);
    });
  }

  /** Resolves once the renderer is ready to draw. */
  ready(): Promise<void> { return this.textureLoad; }

  /** Monotonic simulation time in seconds (advances by the clamped per-frame
   *  dt). Capture tooling polls this to wait for emitters to reach steady
   *  state independent of the host's frame rate. */
  get clock(): number { return this.simTime; }

  /** Fast-forward the simulation by `seconds`, ticking every live cache in
   *  fixed sub-steps WITHOUT drawing. Lets capture tooling warm emitters to
   *  steady state instantly regardless of host frame rate; not needed for
   *  normal playback (the raf loop fills them in over time). */
  advance(seconds: number): void {
    const step = 1 / 60;
    for (let t = 0; t < seconds; t += step) {
      this.simTime += step;
      for (const cache of this.caches) cache.tick(this.simTime, step);
    }
  }

  private compileLayers(): void {
    const gl = this.gl;

    for (const kind of Object.keys(LAYER_KINDS) as LayerKind[]) {
      // The partic family (incl. orb) shares one program — only the bound
      // sampler differs per draw — and glow reuses the ring program; programKey
      // keys the program cache so those near-identical compiles are skipped.
      const def = LAYER_KINDS[kind];
      const [vs, fs] = def.shaders;
      const program = getOrCreateProgram(gl, this.programCache, def.programKey, vs, fs);
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      setupInstanceAttributes(gl, this.instanceBuffer);
      gl.bindVertexArray(null);

      this.layers.set(kind, {
        program,
        vao,
        uniforms: {
          u_time:         gl.getUniformLocation(program, 'u_time'),
          u_resolution:   gl.getUniformLocation(program, 'u_resolution'),
          u_rotationRate: gl.getUniformLocation(program, 'u_rotationRate'),
          u_dmp:          gl.getUniformLocation(program, 'u_dmp'),
          u_noiseTex:     gl.getUniformLocation(program, 'u_noiseTex'),
          u_particTex:    gl.getUniformLocation(program, 'u_particTex'),
          u_sizeCurve:    gl.getUniformLocation(program, 'u_sizeCurve'),
          u_alphaCurve:   gl.getUniformLocation(program, 'u_alphaCurve'),
          u_breathPhase:  gl.getUniformLocation(program, 'u_breathPhase'),
        },
      });
    }
  }

  createCargoCache(params: CargoCacheParams): CargoCache {
    const cache = new CargoCache(params, this.simTime);
    cache.onFinished = () => { this.caches.delete(cache); };
    this.caches.add(cache);
    return cache;
  }

  /** Drop a cache immediately, skipping the destroy() teardown animation.
   *  Used by the tuning harness to re-spawn the grid on every slider change
   *  without leaving fading ghosts behind. */
  removeCargoCache(cache: CargoCache): void {
    this.caches.delete(cache);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.animFrameId);

    const gl = this.gl;
    this.programCache.forEach(p => gl.deleteProgram(p));
    this.layers.forEach(l => gl.deleteVertexArray(l.vao));
    gl.deleteBuffer(this.instanceBuffer);
    gl.deleteBuffer(this.quadBuffer);
    this.bloom.destroy();
    if (this.textures) {
      gl.deleteTexture(this.textures.noise);
      gl.deleteTexture(this.textures.lightRing);
      gl.deleteTexture(this.textures.glow2);
      gl.deleteTexture(this.textures.cell1);
      gl.deleteTexture(this.textures.loot);
    }
    this.caches.clear();
  }

  private tick(now: number): void {
    if (this.destroyed) return;

    const gl = this.gl;
    const dt = Math.min(0.05, Math.max(0, (now / 1000) - this.lastTickTime));
    this.lastTickTime = now / 1000;
    this.simTime += dt;
    const time = this.simTime;

    // Resize backing store on devicePixelRatio / layout changes
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.bloom.resize(w, h);

    for (const cache of this.caches) cache.tick(time, dt);
    for (const cache of this.caches) {
      if (cache.finished) this.caches.delete(cache);
    }

    // Scene draws into the HDR FBO (RGBA16F) so additive emissive can
    // exceed 1.0; bloom.apply() then blurs bright pixels and tonemaps
    // back to the canvas.
    this.bloom.bind();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    if (this.caches.size > 0 && this.textures) {
      this.renderAllLayers(time, w, h);
    }

    this.bloom.apply();

    this.animFrameId = requestAnimationFrame(this.tick);
  }

  // Niagara composes layers in declared order — back-to-front additive. For
  // a multi-rarity scene we need to preserve that *per cache*, but emitters
  // of the same kind across caches can batch into one draw call. We walk
  // every cache's layer list keyed by (kind, dmp, rotationRate): all live
  // particles that share those uniforms get packed into one buffer and one
  // drawArraysInstanced. Distinct uniform tuples become separate draws.
  private renderAllLayers(time: number, w: number, h: number): void {
    type Bucket = {
      kind: LayerKind;
      dmp: [number, number, number, number];
      rotationRate: number;
      sizeCurve: number;
      alphaCurve: number;
      sources: { cache: CargoCache; layerIdx: number }[];
    };
    const buckets: Bucket[] = [];

    // Bucket key: kind | rotationRate | dmp | sizeCurve | alphaCurve. Curves
    // joined the key with DMP because each layer in a rarity can carry its own
    // alpha_over_life shape (rampDown vs bellLow vs bellMid) and size envelope;
    // they must be passed as separate uniforms per draw.
    const bucketIndex = new Map<string, number>();

    for (const cache of this.caches) {
      for (let i = 0; i < cache.layers.length; i++) {
        const l = cache.layers[i];
        if (l.emitter.liveCount === 0) continue;
        const def = LAYER_KINDS[l.spec.kind];
        const dmp = l.spec.dmp ?? def.dmp;
        const rotationRate = l.emitter.rotationRate;
        const sizeCurve = CURVE_ID[l.spec.sizeCurve ?? def.sizeCurve];
        const alphaCurve = CURVE_ID[l.spec.alphaCurve ?? def.alphaCurve];
        const key = `${l.spec.kind}|${rotationRate}|${dmp.join(',')}|${sizeCurve}|${alphaCurve}`;
        let idx = bucketIndex.get(key);
        if (idx == null) {
          idx = buckets.length;
          bucketIndex.set(key, idx);
          buckets.push({ kind: l.spec.kind, dmp, rotationRate, sizeCurve, alphaCurve, sources: [] });
        }
        buckets[idx].sources.push({ cache, layerIdx: i });
      }
    }

    // We *don't* sort buckets — the order they were created in already
    // reflects the first layer-index we saw for each kind/dmp combo, which
    // matches Niagara's declared layer order well enough for the visuals.
    for (const bucket of buckets) {
      this.drawBucket(bucket, time, w, h);
    }
  }

  private drawBucket(
    bucket: {
      kind: LayerKind;
      dmp: [number, number, number, number];
      rotationRate: number;
      sizeCurve: number;
      alphaCurve: number;
      sources: { cache: CargoCache; layerIdx: number }[];
    },
    time: number,
    w: number,
    h: number,
  ): void {
    const gl = this.gl;
    const layer = this.layers.get(bucket.kind)!;

    let total = 0;
    for (const src of bucket.sources) {
      total += src.cache.layers[src.layerIdx].emitter.liveCount;
    }
    if (total === 0) return;

    this.ensureInstanceCapacity(total);

    let written = 0;
    for (const src of bucket.sources) {
      const owned = src.cache.layers[src.layerIdx];
      if (owned.emitter.liveCount === 0) continue;
      written += owned.emitter.pack(
        this.instanceData,
        written * FLOATS_PER_INSTANCE,
        src.cache.x,
        src.cache.y,
        src.cache.config.color,
        src.cache.destroyTime,
      );
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData, 0, total * FLOATS_PER_INSTANCE);

    gl.useProgram(layer.program);
    // Wrap the clock into [0, TIME_WRAP) to match the wrapped birthTime/
    // destroyTime packed per instance (keeps shader-side float precision high
    // over long sessions — see TIME_WRAP in Emitter.ts).
    gl.uniform1f(layer.uniforms.u_time, time % TIME_WRAP);
    gl.uniform2f(layer.uniforms.u_resolution, w, h);
    gl.uniform1f(layer.uniforms.u_rotationRate, bucket.rotationRate);
    gl.uniform4f(layer.uniforms.u_dmp, bucket.dmp[0], bucket.dmp[1], bucket.dmp[2], bucket.dmp[3]);
    if (layer.uniforms.u_sizeCurve)  gl.uniform1i(layer.uniforms.u_sizeCurve,  bucket.sizeCurve);
    if (layer.uniforms.u_alphaCurve) gl.uniform1i(layer.uniforms.u_alphaCurve, bucket.alphaCurve);
    if (layer.uniforms.u_breathPhase) {
      // Pre-wrap the breath phase to [0, 2π): sin() of an unbounded argument
      // loses precision and the pulse visibly stutters after hours of uptime.
      const phase = this.breathPhase ?? (time * 1.25) % (2 * Math.PI);
      gl.uniform1f(layer.uniforms.u_breathPhase, phase);
    }

    // Sampler binding is data on the kind def: flash → T_NOISE on u_noiseTex;
    // the partic family / orb → their Texture2D_0 sprite on u_particTex
    // (glow2 / cell1 / loot / sphere). Kinds with no `texture` bind nothing.
    const tex = LAYER_KINDS[bucket.kind].texture;
    if (tex && this.textures) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[tex.key]);
      gl.uniform1i(layer.uniforms[tex.sampler]!, 0);
    }

    gl.bindVertexArray(layer.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, total);
    gl.bindVertexArray(null);
  }

  private ensureInstanceCapacity(count: number): void {
    if (count <= this.instanceCapacity) return;
    const newCap = Math.max(count, this.instanceCapacity * 2, 32);
    this.instanceData = new Float32Array(newCap * FLOATS_PER_INSTANCE);
    this.instanceCapacity = newCap;

    const gl = this.gl;
    gl.deleteBuffer(this.instanceBuffer);
    this.instanceBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);

    for (const layer of this.layers.values()) {
      gl.bindVertexArray(layer.vao);
      setupInstanceAttributes(gl, this.instanceBuffer);
      gl.bindVertexArray(null);
    }
  }
}

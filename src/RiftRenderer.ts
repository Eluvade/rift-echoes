import { CargoCacheParams, RiftRendererOptions } from './types.js';
import { RARITY_CONFIGS } from './rarity.js';
import { CargoCache } from './CargoCache.js';
import { getOrCreateProgram } from './gl/programCache.js';
import { createQuadBuffer, createInstanceBuffer, setupInstanceAttributes, INSTANCE_STRIDE } from './gl/buffers.js';
import { backlightVert, backlightFrag } from './shaders/backlight.js';

import { starVert, starFrag } from './shaders/star.js';
import { beaconVert, beaconFrag } from './shaders/beacon.js';
import { particleVert, particleFrag } from './shaders/particle.js';

const FLOATS_PER_INSTANCE = INSTANCE_STRIDE / 4; // 10 floats

export class RiftRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private programCache = new Map<string, WebGLProgram>();
  private quadBuffer: WebGLBuffer;
  private caches = new Set<CargoCache>();
  private animFrameId = 0;
  private startTime = 0;
  private destroyed = false;

  private instanceBuffer: WebGLBuffer;
  private instanceBufferCapacity = 0;
  private instanceData = new Float32Array(0);

  private layerVAOs = new Map<string, WebGLVertexArrayObject>();

  private particleVAO: WebGLVertexArrayObject | null = null;
  private particleInstanceBuffer: WebGLBuffer | null = null;

  constructor(options?: RiftRendererOptions) {
    if (options?.canvas) {
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

    this.compilePrograms();
    this.setupLayerVAOs();
    this.setupParticleVAO();

    this.startTime = performance.now() / 1000;
    this.tick = this.tick.bind(this);
    this.animFrameId = requestAnimationFrame(this.tick);
  }

  private compilePrograms(): void {
    const gl = this.gl;
    getOrCreateProgram(gl, this.programCache, 'backlight', backlightVert, backlightFrag);

    getOrCreateProgram(gl, this.programCache, 'star', starVert, starFrag);
    getOrCreateProgram(gl, this.programCache, 'beacon', beaconVert, beaconFrag);
    getOrCreateProgram(gl, this.programCache, 'particle', particleVert, particleFrag);
  }

  private setupLayerVAOs(): void {
    const gl = this.gl;
    for (const layer of ['backlight', 'star', 'beacon']) {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);

      // Bind quad geometry to location 0
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      // Bind instance attributes
      setupInstanceAttributes(gl, this.instanceBuffer);

      gl.bindVertexArray(null);
      this.layerVAOs.set(layer, vao);
    }
  }

  private setupParticleVAO(): void {
    const gl = this.gl;
    this.particleInstanceBuffer = gl.createBuffer()!;

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    // Quad geometry at location 0
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Particle instance data: seed (float) + lifetime (float) = 8 bytes stride
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleInstanceBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 8, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 8, 4);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
    this.particleVAO = vao;
  }

  createCargoCache(params: CargoCacheParams): CargoCache {
    const time = performance.now() / 1000 - this.startTime;
    const cache = new CargoCache(params, time);
    cache.onFinished = () => {
      this.caches.delete(cache);
    };
    this.caches.add(cache);
    return cache;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.animFrameId);

    const gl = this.gl;
    this.programCache.forEach(p => gl.deleteProgram(p));
    this.layerVAOs.forEach(v => gl.deleteVertexArray(v));
    if (this.particleVAO) gl.deleteVertexArray(this.particleVAO);
    gl.deleteBuffer(this.instanceBuffer);
    gl.deleteBuffer(this.quadBuffer);
    if (this.particleInstanceBuffer) gl.deleteBuffer(this.particleInstanceBuffer);

    this.caches.clear();
  }

  private tick(now: number): void {
    if (this.destroyed) return;

    const gl = this.gl;
    const time = now / 1000 - this.startTime;

    // Resize canvas to match display size
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);

    // Update destroy states
    for (const cache of this.caches) {
      cache.updateDestroy(time);
    }

    // Remove finished caches
    for (const cache of this.caches) {
      if (cache.finished) {
        this.caches.delete(cache);
      }
    }

    const cacheArray = Array.from(this.caches);
    if (cacheArray.length === 0) {
      this.animFrameId = requestAnimationFrame(this.tick);
      return;
    }

    const resolution: [number, number] = [w, h];

    // Ensure instance buffer is large enough
    this.ensureInstanceCapacity(cacheArray.length);

    // Write instance data
    for (let i = 0; i < cacheArray.length; i++) {
      cacheArray[i].writeInstanceData(this.instanceData, i * FLOATS_PER_INSTANCE);
    }

    // Upload instance data
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData, 0, cacheArray.length * FLOATS_PER_INSTANCE);

    // Layer 1: Backlight ring glow (additive)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    this.renderQuadLayer('backlight', cacheArray.length, time, resolution);

    // Layer 3: Beacon (additive)
    this.renderQuadLayer('beacon', cacheArray.length, time, resolution);

    // Layer 4: Star (additive) — render per rarity group (different star configs)
    this.renderStarLayer(cacheArray, time, resolution);

    // Layer 5: Particles (additive)
    this.renderParticles(cacheArray, time, resolution);

    this.animFrameId = requestAnimationFrame(this.tick);
  }

  private ensureInstanceCapacity(count: number): void {
    if (count <= this.instanceBufferCapacity) return;

    const newCapacity = Math.max(count, this.instanceBufferCapacity * 2, 8);
    this.instanceData = new Float32Array(newCapacity * FLOATS_PER_INSTANCE);
    this.instanceBufferCapacity = newCapacity;

    const gl = this.gl;

    // Recreate instance buffer with new size and re-bind in all VAOs
    gl.deleteBuffer(this.instanceBuffer);
    this.instanceBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);

    // Rebind instance attributes in all layer VAOs
    for (const [, vao] of this.layerVAOs) {
      gl.bindVertexArray(vao);
      setupInstanceAttributes(gl, this.instanceBuffer);
      gl.bindVertexArray(null);
    }
  }

  private renderQuadLayer(
    layer: string,
    count: number,
    time: number,
    resolution: [number, number],
  ): void {
    const gl = this.gl;
    const program = this.programCache.get(layer)!;
    const vao = this.layerVAOs.get(layer)!;

    gl.useProgram(program);
    gl.uniform1f(gl.getUniformLocation(program, 'u_time'), time);
    gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), resolution[0], resolution[1]);

    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
  }

  private renderStarLayer(
    caches: CargoCache[],
    time: number,
    resolution: [number, number],
  ): void {
    const gl = this.gl;
    const program = this.programCache.get('star')!;
    const vao = this.layerVAOs.get('star')!;

    gl.useProgram(program);
    gl.uniform1f(gl.getUniformLocation(program, 'u_time'), time);
    gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), resolution[0], resolution[1]);

    gl.bindVertexArray(vao);

    // Group by rarity for different star configs
    const groups = new Map<number, number[]>();
    for (let i = 0; i < caches.length; i++) {
      const r = caches[i].rarity;
      let group = groups.get(r);
      if (!group) {
        group = [];
        groups.set(r, group);
      }
      group.push(i);
    }

    for (const [rarity, indices] of groups) {
      const config = RARITY_CONFIGS[rarity as keyof typeof RARITY_CONFIGS];
      if (config.starScale <= 0) continue;

      gl.uniform1f(gl.getUniformLocation(program, 'u_starScale'), config.starScale);
      gl.uniform1f(gl.getUniformLocation(program, 'u_yStretch'), config.starYStretch);

      // Re-upload instance data for this group
      for (let j = 0; j < indices.length; j++) {
        caches[indices[j]].writeInstanceData(this.instanceData, j * FLOATS_PER_INSTANCE);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData, 0, indices.length * FLOATS_PER_INSTANCE);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, indices.length);
    }

    gl.bindVertexArray(null);
  }

  private renderParticles(
    caches: CargoCache[],
    time: number,
    resolution: [number, number],
  ): void {
    const gl = this.gl;
    const program = this.programCache.get('particle')!;

    gl.useProgram(program);
    gl.uniform1f(gl.getUniformLocation(program, 'u_time'), time);
    gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), resolution[0], resolution[1]);

    gl.bindVertexArray(this.particleVAO);

    for (const cache of caches) {
      if (cache.config.particleCount <= 0) continue;

      const config = cache.config;
      gl.uniform2f(gl.getUniformLocation(program, 'u_center'), cache.x, cache.y);
      gl.uniform1f(gl.getUniformLocation(program, 'u_innerRadius'), cache.size * 5.0);
      gl.uniform1f(gl.getUniformLocation(program, 'u_outerRadius'), cache.size * 80.0);
      gl.uniform1f(gl.getUniformLocation(program, 'u_speed'), config.particleSpeed);
      gl.uniform1f(gl.getUniformLocation(program, 'u_particleSize'), cache.size * 3.0);
      gl.uniform4f(gl.getUniformLocation(program, 'u_color'),
        config.color[0], config.color[1], config.color[2], 1.0);
      gl.uniform1f(gl.getUniformLocation(program, 'u_destroyTime'), cache.destroyTime);

      const jitter = config.particleSpeed * 2.0;
      gl.uniform1f(gl.getUniformLocation(program, 'u_jitter'), jitter);

      // Upload particle seeds
      gl.bindBuffer(gl.ARRAY_BUFFER, this.particleInstanceBuffer!);
      gl.bufferData(gl.ARRAY_BUFFER, cache.particleSeeds, gl.DYNAMIC_DRAW);

      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, config.particleCount);
    }

    gl.bindVertexArray(null);
  }
}

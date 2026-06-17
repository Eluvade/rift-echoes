// HDR + bloom postprocess. The Niagara loot-drop materials are designed to
// be rendered into an HDR scene buffer in Unreal — additive emissive values
// well above 1.0 get compressed back to LDR by tonemapping AFTER the bloom
// post-process spreads bright pixels into wide soft halos. Without that pass
// our additive accumulation never produces the soft "body" you see around
// the reference orbs (peak-alpha-0.2 pixels stay below the visibility floor).
//
// Pipeline:
//   1. Scene draws into an RGBA16F FBO (this.bind() before draws)
//   2. apply() runs:
//      a) downsample to half-res blur ping-pong
//      b) horizontal/vertical 9-tap gaussian blur N times for wide halos
//      c) composite scene + blurred halo with Reinhard tonemapping back to
//         the default framebuffer (the canvas)
//
// Requires EXT_color_buffer_float (renderable RGBA16F) — universally
// available on WebGL2-capable GPUs.

const PASSTHROUGH_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// 9-tap gaussian (5 unique weights, mirror-sampled around center). Direction
// is u_dir = (1/w, 0) for horizontal pass, (0, 1/h) for vertical, scaled by
// u_radius to widen the kernel without recompiling.
const BLUR_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_dir;
uniform float u_radius;
in vec2 v_uv;
out vec4 fragColor;
const float W0 = 0.227027;
const float W1 = 0.1945946;
const float W2 = 0.1216216;
const float W3 = 0.054054;
const float W4 = 0.016216;
void main() {
  vec2 d = u_dir * u_radius;
  vec3 c = texture(u_src, v_uv).rgb * W0;
  c += texture(u_src, v_uv + d * 1.0).rgb * W1;
  c += texture(u_src, v_uv - d * 1.0).rgb * W1;
  c += texture(u_src, v_uv + d * 2.0).rgb * W2;
  c += texture(u_src, v_uv - d * 2.0).rgb * W2;
  c += texture(u_src, v_uv + d * 3.0).rgb * W3;
  c += texture(u_src, v_uv - d * 3.0).rgb * W3;
  c += texture(u_src, v_uv + d * 4.0).rgb * W4;
  c += texture(u_src, v_uv - d * 4.0).rgb * W4;
  fragColor = vec4(c, 1.0);
}`;

// Composite + tonemap. Reinhard mapping `x / (x + 1)` keeps the cargo cache
// readable even when emissive values stack well above 1.0. Output alpha is
// the tonemapped luminance so the canvas blends correctly on any backdrop
// (matches the renderer's `alpha: true, premultipliedAlpha: false` config).
const COMPOSITE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform float u_bloomIntensity;
uniform float u_exposure;
in vec2 v_uv;
out vec4 fragColor;
// ACES filmic (Narkowicz fit). Per-channel Reinhard x/(x+1) greyed out
// saturated cores (a vivid green emissive mapped toward white); ACES holds
// saturation through the highlight rolloff. Exposure lifts the additive HDR
// scene before the curve so stacked cores read hot, not muddy.
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
void main() {
  vec3 scene = texture(u_scene, v_uv).rgb;
  vec3 bloom = texture(u_bloom, v_uv).rgb;
  vec3 hdr = (scene + bloom * u_bloomIntensity) * u_exposure;
  vec3 mapped = aces(hdr);
  float lum = max(mapped.r, max(mapped.g, mapped.b));
  fragColor = vec4(mapped, lum);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Bloom shader compile error: ${log}`);
  }
  return sh;
}

function makeProgram(gl: WebGL2RenderingContext, vsrc: string, fsrc: string): WebGLProgram {
  const v = compile(gl, gl.VERTEX_SHADER, vsrc);
  const f = compile(gl, gl.FRAGMENT_SHADER, fsrc);
  const p = gl.createProgram()!;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`Bloom program link error: ${log}`);
  }
  return p;
}

export class Bloom {
  private gl: WebGL2RenderingContext;
  private hdrFBO: WebGLFramebuffer;
  private hdrTex: WebGLTexture;
  // Half-resolution ping-pong pair for the gaussian blur passes. Half-res
  // is enough to produce the wide "Unreal bloom" look at much lower cost
  // than a full-res blur, and any aliasing is hidden by the blur itself.
  private blurFBO: [WebGLFramebuffer, WebGLFramebuffer];
  private blurTex: [WebGLTexture, WebGLTexture];
  private blurProgram: WebGLProgram;
  private compositeProgram: WebGLProgram;
  private uBlurSrc: WebGLUniformLocation | null;
  private uBlurDir: WebGLUniformLocation | null;
  private uBlurRadius: WebGLUniformLocation | null;
  private uCompScene: WebGLUniformLocation | null;
  private uCompBloom: WebGLUniformLocation | null;
  private uCompIntensity: WebGLUniformLocation | null;
  private uCompExposure: WebGLUniformLocation | null;
  private quadBuf: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private w = 0;
  private h = 0;
  private blurW = 0;
  private blurH = 0;
  /** Bloom contribution amount in the composite. */
  bloomIntensity = 1.0;
  /** Exposure multiplier applied to the additive HDR scene before ACES. */
  exposure = 1.15;
  /** Horizontal+vertical blur iterations. More = wider, smoother halo. */
  blurIterations = 16;
  /** Per-iteration kernel radius (half-res pixels). MUST stay small: the 9-tap
   *  kernel samples at ±1..4×radius, so a large radius leaves gaps between taps
   *  and replicates every bright pixel into a regular ghost GRID. Keep ≤~1.5
   *  (contiguous taps) and widen the bloom via blurIterations instead. */
  blurRadius = 1.5;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;

    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('EXT_color_buffer_float required for HDR bloom');
    }
    // Float blending isn't strictly required (we render once per pixel into
    // the HDR target with additive blending — most drivers support that on
    // RGBA16F), but enabling the hint where available avoids fallback paths.
    gl.getExtension('EXT_float_blend');

    this.compositeProgram = makeProgram(gl, PASSTHROUGH_VERT, COMPOSITE_FRAG);
    this.blurProgram = makeProgram(gl, PASSTHROUGH_VERT, BLUR_FRAG);

    this.uBlurSrc       = gl.getUniformLocation(this.blurProgram, 'u_src');
    this.uBlurDir       = gl.getUniformLocation(this.blurProgram, 'u_dir');
    this.uBlurRadius    = gl.getUniformLocation(this.blurProgram, 'u_radius');
    this.uCompScene     = gl.getUniformLocation(this.compositeProgram, 'u_scene');
    this.uCompBloom     = gl.getUniformLocation(this.compositeProgram, 'u_bloom');
    this.uCompIntensity = gl.getUniformLocation(this.compositeProgram, 'u_bloomIntensity');
    this.uCompExposure  = gl.getUniformLocation(this.compositeProgram, 'u_exposure');

    // Fullscreen triangle covering [-1,1]^2 — actually a strip of two tris.
    this.quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1,  -1, 1,
       1, -1,  1,  1,  -1, 1,
    ]), gl.STATIC_DRAW);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.hdrFBO = gl.createFramebuffer()!;
    this.hdrTex = gl.createTexture()!;
    this.blurFBO = [gl.createFramebuffer()!, gl.createFramebuffer()!];
    this.blurTex = [gl.createTexture()!, gl.createTexture()!];
  }

  resize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    this.w = w;
    this.h = h;
    this.blurW = Math.max(1, w >> 1);
    this.blurH = Math.max(1, h >> 1);

    // HDR scene target — RGBA16F so additive accumulation can exceed 1.0
    // without clipping (Niagara emissive routinely peaks at 4–8x).
    gl.bindTexture(gl.TEXTURE_2D, this.hdrTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.hdrFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.hdrTex, 0);

    for (let i = 0; i < 2; i++) {
      gl.bindTexture(gl.TEXTURE_2D, this.blurTex[i]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, this.blurW, this.blurH, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFBO[i]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.blurTex[i], 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Bind the HDR FBO so subsequent draws accumulate into the float target. */
  bind(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.hdrFBO);
    gl.viewport(0, 0, this.w, this.h);
  }

  /** Run the bloom passes and composite to the canvas. Should be called
   *  once per frame after all scene draws are done. */
  apply(): void {
    const gl = this.gl;
    gl.disable(gl.BLEND);

    // Pass 1 — downsample HDR scene into blurTex[0].
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFBO[0]);
    gl.viewport(0, 0, this.blurW, this.blurH);
    gl.useProgram(this.blurProgram);
    gl.uniform1i(this.uBlurSrc, 0);
    gl.uniform2f(this.uBlurDir, 0, 0);                  // zero-direction = passthrough sample
    gl.uniform1f(this.uBlurRadius, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.hdrTex);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Pass 2 — N gaussian iterations, alternating H/V into the ping-pong pair.
    let src = 0;
    let dst = 1;
    const invW = 1 / this.blurW;
    const invH = 1 / this.blurH;
    for (let i = 0; i < this.blurIterations; i++) {
      // Horizontal
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFBO[dst]);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.blurTex[src]);
      gl.uniform2f(this.uBlurDir, invW, 0);
      gl.uniform1f(this.uBlurRadius, this.blurRadius);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      src ^= 1; dst ^= 1;
      // Vertical
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFBO[dst]);
      gl.bindTexture(gl.TEXTURE_2D, this.blurTex[src]);
      gl.uniform2f(this.uBlurDir, 0, invH);
      gl.uniform1f(this.uBlurRadius, this.blurRadius);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      src ^= 1; dst ^= 1;
    }

    // Pass 3 — composite scene + blurred to canvas with tonemap.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.compositeProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.hdrTex);
    gl.uniform1i(this.uCompScene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.blurTex[src]);
    gl.uniform1i(this.uCompBloom, 1);
    gl.uniform1f(this.uCompIntensity, this.bloomIntensity);
    gl.uniform1f(this.uCompExposure, this.exposure);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindVertexArray(null);
  }

  destroy(): void {
    const gl = this.gl;
    gl.deleteFramebuffer(this.hdrFBO);
    gl.deleteTexture(this.hdrTex);
    gl.deleteFramebuffer(this.blurFBO[0]);
    gl.deleteFramebuffer(this.blurFBO[1]);
    gl.deleteTexture(this.blurTex[0]);
    gl.deleteTexture(this.blurTex[1]);
    gl.deleteProgram(this.blurProgram);
    gl.deleteProgram(this.compositeProgram);
    gl.deleteBuffer(this.quadBuf);
    gl.deleteVertexArray(this.vao);
  }
}

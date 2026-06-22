import { COMMON_VERTEX_HEADER, CURVE_HELPERS, DESTROY_FUNCTIONS, VERTEX_TRANSFORM } from './common.js';

// L2 — energy flare (Legendary tier and above). An animated procedural corona
// that mimics solar flares / flame / magical energy waves slowly radiating from
// the centre. Built with value-noise fbm (the Book of Shaders recipe —
// https://thebookofshaders.com/13/) sampled in a seam-free polar-ish space: we
// feed fbm the unit direction vector (continuous all the way around, unlike
// atan which tears at ±π) offset by radius and time, so the turbulence forms
// radial tongues that drift outward as u_time advances.
export const flareVert = `${COMMON_VERTEX_HEADER}
${CURVE_HELPERS}
${DESTROY_FUNCTIONS}

out vec2 v_uv;
out vec4 v_color;
out float v_t;

${VERTEX_TRANSFORM}

void main() {
  float age = elapsed(u_time, a_birthTime);
  float t = clamp(age / a_lifetime, 0.0, 1.0);

  float sizeT = evalCurve(u_sizeCurve, t);
  float scale = sizeT * getDestroyScale(a_destroyTime, u_time);
  vec2 destroyOff = getDestroyOffset(a_destroyTime, u_time);

  float rotation = a_rotation + u_rotationRate * age;
  gl_Position = buildClipPosition(rotation, scale, destroyOff);

  v_uv = a_quad;
  v_color = a_color;
  v_t = t;
}`;

export const flareFrag = `#version 300 es
precision highp float;
${CURVE_HELPERS}

uniform float u_time;
uniform int u_alphaCurve;
uniform vec4 u_dmp;   // x = tongue frequency, y = drift speed, z = reach, w = intensity

in vec2 v_uv;
in vec4 v_color;
in float v_t;
out vec4 fragColor;

// Value noise + fbm — standard Book of Shaders construction. The fract(sin(...))
// hash is precision-sensitive for large arguments, but the bounded clock (M1:
// u_time wrapped to [0, TIME_WRAP)) keeps the noise coordinate — and thus the
// sin() argument — bounded, so it stays stable over a long session. (An
// integer-bit hash was tried for extra portability but rendered low-contrast
// under SwiftShader and washed the tongues out; reverted.)
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  // Few octaves on purpose: broad, simple lobes that read as distinct tongues
  // rather than a finely-detailed cloud that blurs into mush through the bloom.
  float v = 0.0, amp = 0.5;
  for (int i = 0; i < 3; i++) { v += amp * vnoise(p); p *= 2.0; amp *= 0.5; }
  return v;
}

void main() {
  vec2 uv = v_uv;            // quad-local [-1,1]
  float r = length(uv);
  float reach = max(u_dmp.z, 1e-3);
  if (r > reach) discard;

  float freq      = u_dmp.x > 0.0 ? u_dmp.x : 7.0;
  float speed     = u_dmp.y;
  float intensity = u_dmp.w > 0.0 ? u_dmp.w : 1.0;

  // Seam-free angular coordinate: the unit direction vector. Offsetting the
  // sample point by radius (outward) and time gives tongues that crawl out.
  vec2 dir = uv / (r + 1e-3);
  // Mostly-angular sampling (small radial term) so the tongues stay coherent as
  // they radiate outward — flames pointing out from the centre, not a swirl.
  float n = fbm(dir * freq + (r * 0.8 - u_time * speed));
  // High threshold → only the noise peaks survive, leaving wide transparent gaps
  // between a few defined tongues instead of a continuous same-colour wash.
  float flame = smoothstep(0.58, 0.9, n);

  // Corona envelope: a mid-radius band so the flare frames the star rather than
  // piling up under its core (which just mushed to white). Rises from the
  // centre, peaks partway out, then chokes toward the edge.
  float env = smoothstep(0.0, 0.32, r) * (1.0 - smoothstep(0.38, reach, r));

  float g = flame * env * intensity;
  if (g < 0.002) discard;

  const float EMISSIVE = 1.4;
  float alpha = evalCurve(u_alphaCurve, v_t) * v_color.a * g * EMISSIVE;
  fragColor = vec4(v_color.rgb, alpha);
}`;

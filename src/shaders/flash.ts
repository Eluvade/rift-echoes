import { COMMON_VERTEX_HEADER, CURVE_HELPERS, DESTROY_FUNCTIONS, VERTEX_TRANSFORM } from './common.js';

// M_Flash from NS_Loot_Drop_3 layer 3 (and Epic L9), ported from
// reference/M_Flash.hlsl. The "ring of rays" is procedural — two T_NOISE
// samples with polar UVs (atan2 for U, radius for V) at spoke frequencies
// determined by DMP[0], composited with a radial mask raised to powers
// 2 (halo) and 15 (hot core).
//
// DMP[0] = (NI_X, NI_Y, out_X, out_y)
//   NI_X = inner sample U-scale (≈ spoke count for first noise)
//   NI_Y = inner sample V-pan   (per-second scroll along noise V)
//   out_X = outer sample U-scale
//   out_y = outer sample V-pan
//
// HLSL default is (5, 0.05, 2, 0.05): five spokes panning slowly + two
// outer spokes panning slowly. Epic L9 override (0.58, 0.22, 0.15, 0)
// drops both spoke counts well below 1 — the noise turns into broad,
// soft glowing blobs rather than a crisp ring of rays, and the outer
// pan is frozen.
export const flashVert = `${COMMON_VERTEX_HEADER}
${CURVE_HELPERS}
${DESTROY_FUNCTIONS}

out vec2 v_uv;
out vec4 v_color;
out float v_t;
out float v_age;

${VERTEX_TRANSFORM}

void main() {
  float age = u_time - a_birthTime;
  float t = clamp(age / a_lifetime, 0.0, 1.0);

  float sizeT = evalCurve(u_sizeCurve, t);
  float scale = sizeT * getDestroyScale(a_destroyTime, u_time);
  vec2 destroyOff = getDestroyOffset(a_destroyTime, u_time);

  float rotation = a_rotation + u_rotationRate * age;
  gl_Position = buildClipPosition(rotation, scale, destroyOff);

  v_uv = a_quad;
  v_color = a_color;
  v_t = t;
  v_age = age;
}`;

export const flashFrag = `#version 300 es
precision highp float;
${CURVE_HELPERS}

uniform sampler2D u_noiseTex;
uniform vec4 u_dmp;        // (NI_X, NI_Y, out_X, out_y)
uniform int u_alphaCurve;

in vec2 v_uv;
in vec4 v_color;
in float v_t;
in float v_age;
out vec4 fragColor;

void main() {
  vec2 centered = v_uv;
  float r = length(centered);
  if (r > 1.0) discard;

  float theta = atan(centered.y, centered.x);
  float angle01 = fract(theta / 6.28318530718);

  // Two noise samples driven by DMP — per-channel U-scale + V-pan speed.
  vec2 uv0 = vec2(angle01 * u_dmp.x, r * 0.05 - v_age * u_dmp.y);
  vec2 uv1 = vec2(angle01 * u_dmp.z, r * 0.05 - v_age * u_dmp.w);
  float n0 = texture(u_noiseTex, uv0).r;
  float n1 = texture(u_noiseTex, uv1).r;

  // Radial mask in [0,1] UV — peaks at center, zero at edge of unit disc.
  vec2 uv01 = v_uv * 0.5 + 0.5;
  float maskLen = length(uv01 - 0.5);
  float mask = clamp(1.0 - 2.0 * maskLen, 0.0, 1.0);
  float halo = mask * mask * 0.5;
  float core = pow(mask, 15.0);

  float haloTerm = (n0 + n1) * halo;
  float coreTerm = (n0 * n0 + n1 * n1) * (core * 3.0);
  float extra    = core * 0.5;
  float intensity = haloTerm + coreTerm + extra;
  if (intensity < 0.002) discard;

  // alpha_over_life: per-layer curve (default bellLow). Fold intensity into
  // alpha and output un-premultiplied RGB to match the SRC_ALPHA/ONE blend.
  const float EMISSIVE = 2.0;    // flash rays are already crisp — small boost
  float alpha = evalCurve(u_alphaCurve, v_t) * v_color.a * intensity * EMISSIVE;
  fragColor = vec4(v_color.rgb, alpha);
}`;

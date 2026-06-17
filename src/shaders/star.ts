import { COMMON_VERTEX_HEADER, CURVE_HELPERS, DESTROY_FUNCTIONS, VERTEX_TRANSFORM } from './common.js';

// M_Star from NS_Loot_Drop_3 layer 2. Ported from reference/M_Star.hlsl
// (CalcPixelMaterialInputs Locals 0..21). The material produces a tight
// plus-shaped beam by:
//
//   uv01    = TexCoord (0..1)
//   absC    = |uv01 - 0.5|                 // 0 on axes, 0.5 at corners
//   rLen    = length(uv01 - 0.5)           // 0..~0.707
//   s       = 1 - rLen / 0.8               // 1 at center, decays outward
//   gauss   = exp(-(s * 2.333)^2)          // gaussian in s
//   power   = 1 - gauss                    // 0 at center, rises outward
//   axPow   = absC ^ power                 // elementwise
//   prod    = axPow.x * axPow.y            // zero along any axis
//   opacity = pow(1 - prod, 5000)          // ULTRA sharp threshold
//
// pow(·, 5000) is the key — it collapses everything to zero except pixels
// where `prod` is ≈ 0, i.e. directly on the x or y axis of the sprite UV.
// That gives thin, crisp cross beams instead of the soft "+" my first pass
// produced. Color is the particle tint, opacity times Particle.Color.a.
export const starVert = `${COMMON_VERTEX_HEADER}
${CURVE_HELPERS}
${DESTROY_FUNCTIONS}

out vec2 v_uv;
out vec4 v_color;
out float v_t;
out float v_breathe;

uniform float u_breathPhase;   // sine argument for the breath; freezable for captures

${VERTEX_TRANSFORM}

void main() {
  float age = u_time - a_birthTime;
  float t = clamp(age / a_lifetime, 0.0, 1.0);

  float sizeT = evalCurve(u_sizeCurve, t);
  float scale = sizeT * getDestroyScale(a_destroyTime, u_time);
  vec2 destroyOff = getDestroyOffset(a_destroyTime, u_time);

  float rotation = a_rotation + u_rotationRate * age;
  gl_Position = buildClipPosition(rotation, scale, destroyOff);

  // Deliberate slow "breathing" — a brightness pulse (applied to alpha in the
  // fragment), NOT a size pulse. Breathing size made the arms retract behind
  // the orb at the low end and the cross vanished; a glow pulse keeps the cross
  // full-size (always dominant) while it visibly throbs. Fixed ~5s period via
  // absolute u_time, so it's present immediately and every instance pulses in
  // sync (the aggregate reads as one breathing star, not many).
  v_breathe = 0.88 + 0.12 * sin(u_breathPhase);

  v_uv = a_quad;
  v_color = a_color;
  v_t = t;
}`;

export const starFrag = `#version 300 es
precision highp float;
${CURVE_HELPERS}

uniform int u_alphaCurve;
uniform vec4 u_dmp;   // x = horizontal arm reach, y = vertical arm reach (0..1)

in vec2 v_uv;
in vec4 v_color;
in float v_t;
in float v_breathe;
out vec4 fragColor;

void main() {
  // Soft, bold, tapering 4-point star in quad-local space [-1,1]. The old
  // M_Star pow(·,5000) made a 1px hairline cross that the bloom erased; the
  // reference '+' has wide soft arms + a hot core. We build it from two
  // exponential beams (one per axis) tapered to the quad edge, plus a radial
  // core glow.
  vec2 uv = v_uv;
  float r = length(uv);
  if (r > 1.45) discard;
  vec2 a = abs(uv);

  // Asymmetric arm reach from DMP — the reference star is taller than it is
  // wide, and the ratio grows with rarity. lx/ly are the arm lengths as a
  // fraction of the quad half-extent (smaller lx = shorter horizontal arms =
  // more vertical-looking star). Arms stay thin via the exp() falloff across.
  float lx = u_dmp.x > 0.0 ? u_dmp.x : 0.6;
  float ly = u_dmp.y > 0.0 ? u_dmp.y : 1.0;
  float armH = exp(-a.y * 40.0) * (1.0 - smoothstep(0.0, lx, a.x));   // horizontal spike
  float armV = exp(-a.x * 40.0) * (1.0 - smoothstep(0.0, ly, a.y));   // vertical spike
  float core = 0.9 * exp(-r * 16.0);        // tight hot pip — only the very center clips to white

  float intensity = armH + armV + core;
  if (intensity < 0.002) discard;

  // Only the very center should clip to white. Arms keep their colour: a
  // lower emissive keeps arm HDR values inside the ACES saturation range, so
  // the white wash sits in the core (where core+armH+armV all peak) instead
  // of bleeding down every arm and blending the whole star to white.
  const float EMISSIVE = 2.6;
  float alpha = evalCurve(u_alphaCurve, v_t) * v_color.a * intensity * EMISSIVE * v_breathe;
  fragColor = vec4(v_color.rgb, alpha);
}`;

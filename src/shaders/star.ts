import { COMMON_VERTEX_HEADER, CURVE_HELPERS, DESTROY_FUNCTIONS, VERTEX_TRANSFORM } from './common.js';

// L4 — the four-armed star. Built on the product-cross technique (see
// https://discourse.threejs.org/t/.../51784): (|uv.x| * |uv.y|) is ~0 along
// either axis, so a single `1 - |uv.x|*|uv.y|*SHARP` term lights up a thin,
// self-tapering '+' (fat near the core, slender toward the tips). The catch
// from that thread is the cross is bright along the *entire* axes, so the rays
// over-extend to the quad edge; the fix — and exactly the L4 spec ("the angle
// from the center toward where it disappears should gradually slope, choking
// out the light at the edges") — is a soft radial falloff that chokes the arms
// before the edge. The breath slowly grows/shrinks that reach, so the four
// tentacles expand and contract in length.
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
  float age = elapsed(u_time, a_birthTime);
  float t = clamp(age / a_lifetime, 0.0, 1.0);

  float sizeT = evalCurve(u_sizeCurve, t);
  float scale = sizeT * getDestroyScale(a_destroyTime, u_time);
  vec2 destroyOff = getDestroyOffset(a_destroyTime, u_time);

  float rotation = a_rotation + u_rotationRate * age;
  gl_Position = buildClipPosition(rotation, scale, destroyOff);

  // Slow "breathing" — the four arms lengthen and contract. v_breathe scales
  // the arm reach in the fragment (NOT brightness), so the tentacles visibly
  // expand/shrink in length, sloping the light in and out at the tips. Every
  // instance breathes in sync off u_breathPhase, so the aggregate reads as one
  // breathing star rather than many.
  // Gentle pulse around a high baseline: range [0.8, 1.0]. A wider swing made
  // the arms shrink so far at the trough that the star vanished into the glow.
  // (If you retune this range, update the breathNorm remap in the fragment.)
  v_breathe = 0.9 + 0.1 * sin(u_breathPhase);

  v_uv = a_quad;
  v_color = a_color;
  v_t = t;
}`;

export const starFrag = `#version 300 es
precision highp float;
${CURVE_HELPERS}

uniform int u_alphaCurve;
uniform vec4 u_dmp;   // x = horizontal arm reach, y = vertical arm reach (fraction of quad)

in vec2 v_uv;
in vec4 v_color;
in float v_t;
in float v_breathe;
out vec4 fragColor;

void main() {
  vec2 uv = v_uv;            // quad-local [-1,1]
  vec2 a = abs(uv);
  float r = length(uv);

  // Arm reach as a fraction of the quad half-extent, breathing in and out so
  // the tentacles lengthen and contract. dmp.x/y = horizontal/vertical reach;
  // a smaller x gives a taller, more vertical star. TAIL pushes the reach past
  // the quad-edge choke so the arms read as long, slender tails instead of a
  // stubby '+'.
  const float TAIL = 1.25;
  float reachX = (u_dmp.x > 0.0 ? u_dmp.x : 0.6) * v_breathe * TAIL;
  float reachY = (u_dmp.y > 0.0 ? u_dmp.y : 1.0) * v_breathe * TAIL;

  // 4-armed cross. (a.x * a.y) is ~0 along either axis, so the cross is bright
  // on-axis; SHARP sets how fast it falls off across the arm, tapering each arm
  // to a thin tip. High SHARP = needle-thin rays (the Art-of-Code look).
  // Long, gradual along-arm taper: brightness slopes smoothly from the core out
  // to a soft, faint tip with no hard cutoff. Anisotropic via reachX/reachY for
  // the slight vertical bias.
  float er = length(vec2(uv.x / reachX, uv.y / reachY));
  float falloff = pow(max(0.0, 1.0 - er), 1.4);

  // Sharp spikes — the thin bright rays of the star.
  const float SHARP = 70.0;
  float rays = max(0.0, 1.0 - a.x * a.y * SHARP) * falloff;

  // Light SHAFTS — a much broader, dimmer cross hugging the SAME four arms, so
  // the star's emission streaks out *along its own shape* (directional light)
  // instead of pooling into a round halo. This is what stops the glow reading as
  // a copy of the L0 gradient: the light is star-shaped, not a disc.
  float wide = max(0.0, 1.0 - a.x * a.y * 9.0);
  float shafts = wide * pow(max(0.0, 1.0 - er), 2.2);

  // Hot pinpoint core — the light source itself. Kept very tight (high exp) so
  // through the HDR bloom it flares as a compact star, not a wide gradient disc,
  // and its peak clips toward white like a real emitter.
  float core = 1.3 * exp(-r * 18.0);

  float intensity = rays + shafts * 0.35 + core;
  // Zero-output rather than discard — additive blend ignores a 0 alpha, and
  // avoiding discard keeps tiled-GPU fast-paths on for the whole (large) quad.
  if (intensity < 0.002) { fragColor = vec4(0.0); return; }

  // Light output rises as the arms elongate and dims as they contract.
  float breathNorm = clamp((v_breathe - 0.8) / 0.2, 0.0, 1.0);
  float lightMul = mix(0.9, 1.25, breathNorm);

  // White-hot along a THIN bright spine of the '+', not just the dead centre.
  // The spine is a much sharper cross than the visible rays (SHARP_WHITE >>
  // SHARP), so only the slender centreline of each arm whitens; everything
  // around it keeps the saturated rarity colour. This yields the target
  // gradient: opaque white spine → fully-saturated, semi-transparent rarity
  // arms → transparent tips. Combined with the hot pinpoint core so the centre
  // is solid white. lightMul swells the white a touch as the star breathes.
  const float SHARP_WHITE = 300.0;
  float spine = max(0.0, 1.0 - a.x * a.y * SHARP_WHITE) * falloff;
  float white = max(spine, core);
  float whiteness = smoothstep(0.45, 0.95, white * lightMul);
  vec3 rgb = mix(v_color.rgb, vec3(1.0), whiteness);

  // Translucent, but emissive high enough that the saturated arms read vividly
  // (not washed) and the core clips hot through the HDR bloom.
  const float EMISSIVE = 0.95;
  float alpha = evalCurve(u_alphaCurve, v_t) * v_color.a * intensity * lightMul * EMISSIVE;
  fragColor = vec4(rgb, alpha);
}`;

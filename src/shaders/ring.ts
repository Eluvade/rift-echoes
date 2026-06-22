import { COMMON_VERTEX_HEADER, CURVE_HELPERS, DESTROY_FUNCTIONS, VERTEX_TRANSFORM } from './common.js';

// Procedural radial gradient — no texture, no crisp line. Serves two layers:
//   • L1 ring  (kind 'ring')  — radius > 0 → a band peaking around the radius.
//   • L0 glow  (kind 'glow')  — radius = 0 → a solid-centred gradient.
// Both share this program; only the DMP differs. DMP: x = inner radius, y =
// peak opacity, z = fade reach (all fractions of the quad half-extent),
// w = falloff exponent (lower = softer/longer fade).
export const ringVert = `${COMMON_VERTEX_HEADER}
${CURVE_HELPERS}
${DESTROY_FUNCTIONS}

out vec2 v_uv;
out vec4 v_color;
out float v_t;

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
}`;

export const ringFrag = `#version 300 es
precision highp float;
${CURVE_HELPERS}

uniform int u_alphaCurve;
uniform float u_breathPhase;   // star breath — drives the "lit by the star" pulse
uniform vec4 u_dmp;   // x = inner radius, y = peak opacity, z = fade reach,
                      // w = falloff exponent (radius/reach are fractions of the
                      // quad half-extent; lower exponent = softer, longer fade)

in vec2 v_uv;
in vec4 v_color;
in float v_t;
out vec4 fragColor;

void main() {
  float r = length(v_uv);
  float radius = u_dmp.x;
  float peak   = u_dmp.y;
  float glow   = max(u_dmp.z, 1e-3);
  float falloffPow = max(u_dmp.w, 0.05);

  float g;
  float breath;
  if (radius > 0.0) {
    // L1 annulus — a soft ring BAND that FRAMES the star. It rises from a fully
    // transparent interior up to the peak at the radius, then fades back out, so
    // there is clear background between the star core and the ring (no light
    // inside the ring). The inner rise and outer fade both complete inside the
    // quad, and a final circular contain term forces zero alpha before the SQUARE
    // quad edge — otherwise leftover alpha at the edge midpoints (while the
    // corners fade out) reads as a clipped diamond/rhombus. The fade is
    // pow(1 - t, exponent): lower exponent = softer, longer, more gradual tail.
    float inner = smoothstep(radius - 0.16, radius, r);   // transparent core → peak (thin band)
    float t = clamp((r - radius) / glow, 0.0, 1.0);
    float outer = pow(1.0 - t, falloffPow);               // soft outward fade
    float contain = 1.0 - smoothstep(0.86, 0.99, r);      // circular safety cap
    g = inner * outer * peak * contain;
    // The ring does NOT pulse with the star — a ring breathing in lockstep reads
    // as fake. It is a steady band, only gently lit on its inner face (it already
    // peaks at the inner edge nearest the star and fades outward), so it reads as
    // catching the star's light rather than emitting its own.
    breath = 1.0;
  } else {
    // L0 glow — solid centre fading outward (a contained radial; reaches 0 well
    // inside the quad, so it never clips).
    float t = clamp(r / glow, 0.0, 1.0);
    g = pow(1.0 - t, falloffPow) * peak;
    // The glow IS the star's own central light, so it breathes with the star.
    breath = breathLight(u_breathPhase, 0.68, 1.4);
  }
  if (g < 0.002) discard;

  const float EMISSIVE = 1.4;
  float alpha = evalCurve(u_alphaCurve, v_t) * v_color.a * g * EMISSIVE * breath;
  fragColor = vec4(v_color.rgb, alpha);
}`;

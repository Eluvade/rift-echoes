import { COMMON_VERTEX_HEADER, CURVE_HELPERS, DESTROY_FUNCTIONS, VERTEX_TRANSFORM } from './common.js';

// Procedural "circular inline" — a clean, crisp, thin ring (the orb outline in
// the reference). No texture, so there's none of the concentric-bullseye
// artifact the T_SPHERE orb produced. Constant size across rarities; only the
// colour changes. DMP: x = ring radius (fraction of quad half-extent),
// y = ring thickness (same units).
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
uniform vec4 u_dmp;   // x = radius (0..1), y = thickness

in vec2 v_uv;
in vec4 v_color;
in float v_t;
out vec4 fragColor;

void main() {
  float r = length(v_uv);
  float radius = u_dmp.x > 0.0 ? u_dmp.x : 0.82;
  float thick  = u_dmp.y > 0.0 ? u_dmp.y : 0.05;

  // Thin bright annulus centered on the radius. smoothstep on the distance to
  // the ring band keeps the edge soft (anti-aliased) but the line crisp.
  float d = abs(r - radius);
  float ring = 1.0 - smoothstep(0.0, thick, d);
  if (ring < 0.002) discard;

  const float EMISSIVE = 1.5;
  float alpha = evalCurve(u_alphaCurve, v_t) * v_color.a * ring * EMISSIVE;
  fragColor = vec4(v_color.rgb, alpha);
}`;

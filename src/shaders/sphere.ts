import { COMMON_VERTEX_HEADER, CURVE_HELPERS, DESTROY_FUNCTIONS, VERTEX_TRANSFORM } from './common.js';

// M_Sphere from NS_Loot_Drop_3 layer 1, ported from reference/M_Sphere.hlsl
// Locals 0..21. The material outputs an *annular* halo:
//
//   r       = length(uv - 0.5)            // 0..0.707 in unit-square UV
//   halo(R, D) = (R > 0 && r < R)
//              ? 1 - exp(-((1 - r/R) * D)²)
//              : 0
//   intensity = halo(r1, d1) - halo(r2, d2)        // outer minus inner
//   alpha     = particle.alpha * intensity
//
// DMP[0] = (r1, r2, d1, d2). Default per the HLSL is (0.5, 0.2, 1.0, 1.0)
// — a thick ring. The Niagara override on Uncommon sets (0.5, 0, 0.2, 0)
// which collapses the inner halo and dims the outer halo dramatically;
// d1=0.2 means the ball is broad and very faint, more of a soft fog than
// the bright disc the procedural form had.
export const sphereVert = `${COMMON_VERTEX_HEADER}
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

export const sphereFrag = `#version 300 es
precision highp float;
${CURVE_HELPERS}

uniform vec4 u_dmp;        // (r1, r2, d1, d2)
uniform int u_alphaCurve;  // CurveShape id

in vec2 v_uv;
in vec4 v_color;
in float v_t;
out vec4 fragColor;

// halo(r, R, D) = (R > 0 && r < R) ? 1 - exp(-((1 - r/R) * D)²) : 0
float halo(float r, float R, float D) {
  if (R <= 0.0 || r >= R) return 0.0;
  float k = (1.0 - r / R) * D;
  return 1.0 - exp(-k * k);
}

void main() {
  // M_Sphere works in [0,1] UV; v_uv is quad-local [-1,1].
  vec2 uv01 = v_uv * 0.5 + 0.5;
  float r = length(uv01 - 0.5);

  float outer = halo(r, u_dmp.x, u_dmp.z);
  float inner = halo(r, u_dmp.y, u_dmp.w);
  float intensity = max(outer - inner, 0.0);
  if (intensity < 0.001) discard;

  // alpha_over_life: per-layer curve (default rampDown for sphere). Intensity
  // folds into alpha so SRC_ALPHA/ONE blend contributes rgb*alpha rather
  // than squaring premul.
  const float EMISSIVE = 4.0;    // sphere is the inner soft body — bloom widens it
  float alpha = evalCurve(u_alphaCurve, v_t) * v_color.a * intensity * EMISSIVE;
  fragColor = vec4(v_color.rgb, alpha);
}`;

import { COMMON_VERTEX_HEADER, CURVE_HELPERS, DESTROY_FUNCTIONS, VERTEX_TRANSFORM } from './common.js';

// M_Partic / M_Partic_2 / M_Partic_3 from reference/M_Partic*.hlsl. The
// four files are mathematically identical — the only difference is which
// texture is bound to Texture2D_0 in each material. We share a single
// program here and let the renderer pick which sampler asset to bind per
// LayerKind:
//
//   M_Partic   → T_glow_2  (soft round emissive blob)
//   M_Partic_2 → T_Cell_1  (cellular dot pattern)
//   M_Partic_3 → T_Loot    (loot-burst sprite)
//
// Per-pixel math (Locals 0..12 in the HLSL):
//   tex   = sample(Texture2D_0, uv)
//   rgb   = particle.rgb * tex.rgb
//   alpha = tex.a * DMP[0].r * particle.alpha
//
// DMP default is (1, 1, 1, 1). Niagara overrides the scalar via the
// `partic_emissive_scale` curve baked into module_dynamic_material_parameter
// — for a baseline port we hold it at 1 and let the per-layer DMP override
// (already plumbed through the renderer) handle Epic / Rare's special
// emissive ramps.
//
// Sprite size + alpha follow the same (bell × 0.2 / linear ramp) shape as
// the other layers; rotation_rate stays 0 by default but a config can
// override it for spinning loot bits.
export const particVert = `${COMMON_VERTEX_HEADER}
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

export const particFrag = `#version 300 es
precision highp float;
${CURVE_HELPERS}

uniform sampler2D u_particTex;
uniform vec4 u_dmp;            // (.r = emissive opacity multiplier, others unused)
uniform int u_alphaCurve;

in vec2 v_uv;
in vec4 v_color;
in float v_t;
out vec4 fragColor;

void main() {
  // v_uv is quad-local [-1,1]; M_Partic samples in [0,1] UV.
  vec2 uv01 = v_uv * 0.5 + 0.5;
  vec4 tex = texture(u_particTex, uv01);

  // Radial mask fades quad corners to 0 starting at unit radius. The HLSL
  // relies entirely on the texture alpha for shape, but T_Cell_1 in
  // particular has high alpha across most of its quad — without this mask,
  // big M_Partic_2 particles render as visible textured rectangles when
  // amplified by HDR + bloom. smoothstep(0.6, 1.0, r) is permissive enough
  // not to clip the texture's natural soft falloff in the inner 60%.
  float r = length(v_uv);
  float radialMask = 1.0 - smoothstep(0.6, 1.0, r);
  if (radialMask <= 0.0) discard;

  vec3 rgb = v_color.rgb * tex.rgb;

  // alpha_over_life: per-layer curve. The Niagara loot-drop graphs use three
  // shapes for M_Partic — rampDown, bellLow, and bellMid — depending on the
  // emitter slot (e.g. Rare L6 partic_3 uses bellMid; most others use bellLow
  // or rampDown). Particle.alpha (v_color.a) carries the emitter-wide
  // multiplier; DMP.r scales the texture mask further per material.
  const float EMISSIVE = 6.0;    // partic = the soft body of the orb; bloom does the rest
  float alpha = evalCurve(u_alphaCurve, v_t) * v_color.a * tex.a * u_dmp.x * EMISSIVE * radialMask;
  if (alpha < 0.001) discard;

  // Un-premultiplied RGB so SRC_ALPHA/ONE blend yields rgb*alpha per pixel
  // rather than rgb*alpha² (the blow-out bug from the first Niagara port).
  fragColor = vec4(rgb, alpha);
}`;

// Vertex header shared by every particle layer. The attribute layout matches
// `setupInstanceAttributes` in src/gl/buffers.ts. Each draw call is one quad
// (a_quad ∈ {-1,1}^2) instanced over a flat list of live particles supplied by
// the renderer; the per-particle pose is built from a_position, a_size, and
// the lifetime triple (a_birthTime, a_lifetime, a_rotation).
export const COMMON_VERTEX_HEADER = `#version 300 es
precision highp float;

layout(location=0) in vec2 a_quad;
layout(location=1) in vec2 a_position;     // pixel center
layout(location=2) in vec2 a_size;         // pixel width / height
layout(location=3) in float a_birthTime;
layout(location=4) in float a_lifetime;
layout(location=5) in float a_rotation;    // initial rotation, radians
layout(location=6) in vec4 a_color;
layout(location=7) in float a_destroyTime; // 0 = not destroying

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_rotationRate;              // radians/sec, additive on top of a_rotation
uniform int u_sizeCurve;                    // CurveShape id — see common.ts
`;

// Niagara loot-drop curves — per the user's spec doc, "all curves have
// easeInOutSine smoothing unless otherwise specified". So a `[0,0, 0.5,1, 1,0]`
// shape is two easeInOutSine arcs joined at t=0.5 (NOT a sine bell), and a
// `[0,0, 1,1]` ramp is easeInOutSine(t) (NOT linear). evalCurve picks one of
// five shapes used across the loot-drop graphs by an integer ID — see types.ts
// CurveShape for the mapping. Picking by uniform avoids recompiling shaders
// per layer; the cost is one branch per particle per frame.
//
//   0 = bell      [0,0, 0.5,1, 1,0]      bellEased(t)
//   1 = bellLow   [0,0, 0.5,0.2, 1,0]    bellEased(t) * 0.2
//   2 = bellMid   [0,0, 0.5,0.5, 1,0]    bellEased(t) * 0.5
//   3 = rampUp    [0,0, 1,1]             easeInOutSine(t)
//   4 = rampDown  [0,1, 1,0]             1 - easeInOutSine(t)
//   5 = hold      constant 1.0          static layers (no size/alpha change)
export const CURVE_HELPERS = `
const float PI = 3.14159265359;
// Bounded clock. The JS sim clock grows without limit, so every time fed to a
// shader (u_time, a_birthTime, a_destroyTime) is wrapped CPU-side into
// [0, TIME_WRAP) before upload — keep this in sync with TIME_WRAP in Emitter.ts.
// Wrapping keeps sin()/fbm arguments and age subtractions small, avoiding the
// float precision decay (stuttering breath, quantised motion) that absolute
// seconds hit once a session has been open for hours.
const float TIME_WRAP = 3600.0;
// Elapsed time across the wrap: now and start are both in [0, TIME_WRAP), so a
// start that sits just "ahead" of now (right after a wrap) still yields a small
// positive age. Valid while the true elapsed time stays below TIME_WRAP.
float elapsed(float now, float start) {
  float d = now - start;
  return d < 0.0 ? d + TIME_WRAP : d;
}
// Per-shader emissive scales push additive HDR accumulation above 1.0 so
// the bloom + tonemap pass produces saturated cores and wide soft halos.
// Different materials need different scales to balance: M_Partic is the
// soft *body* of the orb (peak alpha 0.2 — needs the most boost), M_Sphere
// is the inner glow (mid boost), M_Flash/M_Star are crisp rays already
// peaking near 1 alpha (smaller boost; too high and they dominate the
// composite). Niagara emissive values in Unreal frequently exceed 5.0.
float easeInOutSine(float t) { return 0.5 - 0.5 * cos(PI * clamp(t, 0.0, 1.0)); }
float bellEased(float t) {
  // Triangular fold around t=0.5 → easeInOutSine on the folded coordinate.
  // Yields a bell that rises slower than sin(πt), peaks sharply at 1, then
  // falls slower — matches the FRichCurve [0,0, 0.5,1, 1,0] easeInOutSine
  // smoothing exactly at the keys and very close in between.
  float u = 1.0 - 2.0 * abs(clamp(t, 0.0, 1.0) - 0.5);
  return easeInOutSine(u);
}
float evalCurve(int id, float t) {
  if (id == 0) return bellEased(t);
  if (id == 1) return bellEased(t) * 0.2;
  if (id == 2) return bellEased(t) * 0.5;
  if (id == 3) return easeInOutSine(t);
  if (id == 5) return 1.0;         // hold — constant, static layers
  return 1.0 - easeInOutSine(t);   // id == 4 (rampDown), or fallback
}
// Legacy alias — kept so existing shader source that referenced bell(t) still
// compiles during the curve-plumbing migration.
float bell(float t) { return bellEased(t); }
// "Lit by the star": the whole drop brightens and dims with the star's breath
// so the star reads as the single light source for every layer. phase is the
// star's u_breathPhase (n = 0.5 + 0.5*sin(phase), 0..1 over the pulse); each
// layer maps it into its own lo..hi brightness swing. Keeping the formula here
// guarantees every layer pulses in lockstep with the star.
float breathLight(float phase, float lo, float hi) {
  return mix(lo, hi, 0.5 + 0.5 * sin(phase));
}
`;

// `destroyTime > 0` means the user requested teardown at that timestamp; we
// shake briefly, expand, then snap to zero scale so the particle pool can
// drain naturally without a visible discontinuity.
export const DESTROY_FUNCTIONS = `
vec2 getDestroyOffset(float destroyTime, float time) {
  if (destroyTime <= 0.0) return vec2(0.0);
  float dt = elapsed(time, destroyTime);
  if (dt < 0.3) return vec2(sin(dt * 60.0) * 3.0, cos(dt * 47.0) * 3.0);
  return vec2(0.0);
}

float getDestroyScale(float destroyTime, float time) {
  if (destroyTime <= 0.0) return 1.0;
  float dt = elapsed(time, destroyTime);
  if (dt < 0.3) return 1.0;
  if (dt < 0.5) return 1.0 + (dt - 0.3) * 0.5;
  if (dt < 0.7) return max(0.0, 1.1 - (dt - 0.5) * 5.5);
  return 0.0;
}
`;

// Shared boilerplate that turns (a_quad, a_position, a_size, rotation) into
// a clip-space corner. `lifeT` (0..1) scales the sprite along its life and
// `extraScale` is anything else the layer wants to fold in.
export const VERTEX_TRANSFORM = `
vec4 buildClipPosition(float rotation, float scale, vec2 destroyOffset) {
  vec2 corner = a_quad * 0.5 * a_size * scale;
  float c = cos(rotation), s = sin(rotation);
  vec2 rotated = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
  vec2 worldPx = a_position + rotated + destroyOffset;
  vec2 ndc = (worldPx / u_resolution) * 2.0 - 1.0;
  // Negate Y: pixel space is top-left origin (Y down), clip space is Y up.
  return vec4(ndc.x, -ndc.y, 0.0, 1.0);
}
`;

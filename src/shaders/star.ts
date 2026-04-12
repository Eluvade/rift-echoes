import { COMMON_VERTEX_HEADER, DESTROY_FUNCTIONS } from './common.js';

export const starVert = `${COMMON_VERTEX_HEADER}
${DESTROY_FUNCTIONS}

out vec2 v_uv;
out vec4 v_color;
out float v_starScale;
out float v_yStretch;
out float v_breatheFactor;

uniform float u_starScale;
uniform float u_yStretch;

void main() {
  float dScale = getDestroyScale(a_destroyTime, u_time);
  vec2 dOffset = getDestroyOffset(a_destroyTime, u_time);

  float breatheFactor = 0.0;
  if (a_breathes > 0.5) {
    float localTime = u_time - a_phase;
    breatheFactor = 0.15 * sin(localTime * 1.8) + 0.05 * sin(localTime * 3.7);
  }

  float baseRadius = a_size * 80.0 * u_starScale * (1.0 + breatheFactor);
  float radius = baseRadius * dScale;

  // Quad must be tall enough for the Y arm
  float quadYScale = max(u_yStretch, 1.0);
  vec2 quadScale = vec2(1.0, quadYScale);
  vec2 pixelPos = a_position + dOffset + a_quad * quadScale * radius;
  vec2 clipPos = (pixelPos / u_resolution) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;

  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_uv = a_quad * quadScale;
  v_color = a_color;
  v_starScale = u_starScale;
  v_yStretch = u_yStretch;
  v_breatheFactor = breatheFactor;
}
`;

export const starFrag = `#version 300 es
precision highp float;

in vec2 v_uv;
in vec4 v_color;
in float v_starScale;
in float v_yStretch;
in float v_breatheFactor;
out vec4 fragColor;

void main() {
  if (v_starScale <= 0.0) discard;

  float dx = abs(v_uv.x);
  float dy = abs(v_uv.y);

  // Breathing modulates thickness: thicker when expanding, thinner when contracting
  float k = 0.015 * (1.0 + v_breatheFactor * 2.0);

  // Reciprocal cross SDF:
  // Horizontal arm extends along X axis. A point is on it if dy < thickness(dx).
  // thickness(dx) = k / (dx + k) — thick at center, paper-thin at tips.
  float horizThickness = k / (dx + k);
  float horizArm = smoothstep(horizThickness, horizThickness * 0.3, dy);
  float horizTipFade = 1.0 - smoothstep(0.7, 1.0, dx);
  horizArm *= horizTipFade;

  // Vertical arm extends along Y axis. A point is on it if dx < thickness(dy).
  float vertArm = 0.0;
  if (v_yStretch > 0.01) {
    float vertThickness = k / (dy + k);
    vertArm = smoothstep(vertThickness, vertThickness * 0.3, dx);
    // Tip fade at the Y arm's reach (scaled by yStretch)
    float normalizedDy = dy / v_yStretch;
    float vertTipFade = 1.0 - smoothstep(0.7, 1.0, normalizedDy);
    vertArm *= vertTipFade;
  }

  float cross = max(horizArm, vertArm);
  if (cross < 0.01) discard;

  // No forced white — pure rarity color with intensity gradient
  // Brighter at center (intensity > 1 lets additive blending naturally whiten)
  float yScale = max(v_yStretch, 1.0);
  float distFromCenter = length(v_uv / vec2(1.0, yScale));
  float intensity = 1.5 / (distFromCenter * 3.0 + 1.0);

  // Breathing also pulses intensity
  intensity *= (1.0 + v_breatheFactor * 1.5);

  float alpha = cross * intensity;
  vec3 color = v_color.rgb * intensity;

  fragColor = vec4(color * cross, alpha);
}
`;

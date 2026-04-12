import { COMMON_VERTEX_HEADER, DESTROY_FUNCTIONS } from './common.js';

export const beaconVert = `${COMMON_VERTEX_HEADER}
${DESTROY_FUNCTIONS}

out vec2 v_uv;
out vec4 v_color;
out float v_localTime;

void main() {
  float dScale = getDestroyScale(a_destroyTime, u_time);
  vec2 dOffset = getDestroyOffset(a_destroyTime, u_time);

  float baseRadius = a_size * 36.0;
  float radius = baseRadius * dScale;

  vec2 pixelPos = a_position + dOffset + a_quad * radius;
  vec2 clipPos = (pixelPos / u_resolution) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;

  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_uv = a_quad;
  v_color = a_color;
  v_localTime = u_time - a_phase;
}
`;

export const beaconFrag = `#version 300 es
precision highp float;

in vec2 v_uv;
in vec4 v_color;
in float v_localTime;
out vec4 fragColor;

const float PI = 3.14159265;

// Ease-out cubic: decelerates toward the end
float easeOutCubic(float t) {
  float t1 = 1.0 - t;
  return 1.0 - t1 * t1 * t1;
}

void main() {
  float dist = length(v_uv);
  if (dist > 1.0 || dist < 0.05) discard;

  float angle = atan(v_uv.y, v_uv.x);

  // Two opposing sides centered at angle=0 and angle=PI
  float a0 = abs(angle);
  float aPI = PI - a0;
  float side = min(a0, aPI);

  // Graduated segments with decreasing size
  float centralHalf = PI / 6.0;   // 30 deg half-width
  float segGap = 0.08;

  float alpha = 0.0;

  if (side < centralHalf) {
    alpha = 1.0;
  }
  else if (side > centralHalf + segGap && side < centralHalf + segGap + PI / 13.0) {
    alpha = 0.7;
  }
  else if (side > centralHalf + segGap * 2.0 + PI / 13.0 && side < centralHalf + segGap * 2.0 + PI / 13.0 + PI / 22.0) {
    alpha = 0.45;
  }
  else if (side > centralHalf + segGap * 3.0 + PI / 13.0 + PI / 22.0 && side < centralHalf + segGap * 3.0 + PI / 13.0 + PI / 22.0 + PI / 50.0) {
    alpha = 0.2;
  }
  else {
    discard;
  }

  // Pulsing rings with ease-out: fast at center, decelerating outward
  float rawPulse = fract(v_localTime * 0.5);
  float easedPulse = easeOutCubic(rawPulse);

  // Ring position based on eased pulse
  float ringPos = easedPulse;
  float ringDelta = abs(dist - ringPos);
  float ring = smoothstep(0.08, 0.0, ringDelta) * (1.0 - rawPulse * 0.6);

  // Subtle steady outer edge
  float steady = smoothstep(1.0, 0.85, dist) * smoothstep(0.0, 0.15, dist) * 0.1;

  float intensity = (ring + steady) * alpha;
  if (intensity < 0.01) discard;

  fragColor = vec4(v_color.rgb * intensity, intensity);
}
`;

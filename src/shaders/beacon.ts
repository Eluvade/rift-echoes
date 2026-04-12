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

void main() {
  float dist = length(v_uv);
  if (dist > 1.0 || dist < 0.05) discard;

  float angle = atan(v_uv.y, v_uv.x);

  // Two opposing sides centered at angle=0 and angle=PI
  // Map angle to [0, PI] distance from nearest axis
  float a0 = abs(angle);           // distance from 0
  float aPI = PI - a0;             // distance from PI

  float side = min(a0, aPI);       // distance from nearest side center

  // Graduated segments: central arc ~60deg (PI/3), then smaller ones
  // The total angular coverage is about 70deg per side with graduated segments
  float centralHalf = PI / 6.0;    // 30 deg half-width for central arc
  float segGap = 0.06;             // gap between segments

  float alpha = 0.0;

  // Central segment: ±30 degrees
  if (side < centralHalf) {
    alpha = 1.0;
  }
  // Second segment pair: 35-48 degrees
  else if (side > centralHalf + segGap && side < centralHalf + segGap + PI / 13.0) {
    alpha = 0.75;
  }
  // Third segment pair: 55-62 degrees
  else if (side > centralHalf + segGap * 2.0 + PI / 13.0 && side < centralHalf + segGap * 2.0 + PI / 13.0 + PI / 22.0) {
    alpha = 0.5;
  }
  // Fourth tiny segment: 68-71 degrees
  else if (side > centralHalf + segGap * 3.0 + PI / 13.0 + PI / 22.0 && side < centralHalf + segGap * 3.0 + PI / 13.0 + PI / 22.0 + PI / 50.0) {
    alpha = 0.25;
  }
  else {
    discard;
  }

  // Pulsing rings expanding outward
  float pulse = fract(dist - v_localTime * 0.8);
  float ring = smoothstep(0.0, 0.05, pulse) * (1.0 - smoothstep(0.05, 0.12, pulse));

  // Also show a subtle steady arc
  float steady = smoothstep(0.9, 0.85, dist) * smoothstep(0.0, 0.1, dist) * 0.15;

  float intensity = (ring + steady) * alpha;
  if (intensity < 0.01) discard;

  fragColor = vec4(v_color.rgb * intensity, intensity);
}
`;

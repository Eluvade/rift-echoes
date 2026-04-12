import { COMMON_VERTEX_HEADER, DESTROY_FUNCTIONS } from './common.js';

export const coreGlowVert = `${COMMON_VERTEX_HEADER}
${DESTROY_FUNCTIONS}

out vec2 v_uv;
out vec4 v_color;
out float v_localTime;
out float v_breathes;

uniform float u_glowRadius;
uniform float u_particleCount;
uniform float u_particleSpeed;

void main() {
  float dScale = getDestroyScale(a_destroyTime, u_time);
  vec2 dOffset = getDestroyOffset(a_destroyTime, u_time);

  float breathe = 1.0;
  if (a_breathes > 0.5) {
    float localTime = u_time - a_phase;
    breathe = 1.0 + 0.15 * sin(localTime * 1.8) + 0.05 * sin(localTime * 3.7);
  }

  float radius = u_glowRadius * a_size * dScale * breathe;

  vec2 pixelPos = a_position + dOffset + a_quad * radius;
  vec2 clipPos = (pixelPos / u_resolution) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;

  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_uv = a_quad;
  v_color = a_color;
  v_localTime = u_time - a_phase;
  v_breathes = a_breathes;
}
`;

export const coreGlowFrag = `#version 300 es
precision highp float;

in vec2 v_uv;
in vec4 v_color;
in float v_localTime;
in float v_breathes;
out vec4 fragColor;

uniform float u_particleCount;
uniform float u_particleSpeed;
uniform float u_starScale;

void main() {
  float dist = length(v_uv);
  if (dist > 1.0) discard;

  // Soft radial glow — gaussian falloff
  float glow = exp(-dist * dist * 3.0);

  // Strong steady base that never extinguishes
  float baseIntensity = u_starScale > 0.0 ? 0.6 : 0.0;

  // Gentle particle-arrival flicker on top (subtle, not dominant)
  float flicker = 0.0;
  if (u_particleCount > 0.0) {
    float rate = u_particleSpeed * 0.3;
    // Slow harmonics for organic pulsing, not rapid blinking
    flicker += sin(v_localTime * rate * 6.283 * 0.7) * 0.06;
    flicker += sin(v_localTime * rate * 6.283 * 1.3 + 1.3) * 0.04;
    flicker += sin(v_localTime * rate * 6.283 * 2.1 + 2.7) * 0.03;
    float countFactor = min(u_particleCount / 30.0, 1.0);
    // More particles = stronger steady glow
    baseIntensity += countFactor * 0.2;
    flicker *= countFactor;
  }

  float totalIntensity = baseIntensity + flicker;

  // Emissive bloom: color stays rarity-colored, very center gets slightly brighter
  float bloomCenter = exp(-dist * dist * 10.0);
  vec3 bloomColor = v_color.rgb * (1.0 + bloomCenter * 0.5);

  float alpha = glow * totalIntensity;
  if (alpha < 0.005) discard;

  fragColor = vec4(bloomColor * alpha, alpha);
}
`;

import { COMMON_VERTEX_HEADER, DESTROY_FUNCTIONS } from './common.js';

export const starVert = `${COMMON_VERTEX_HEADER}
${DESTROY_FUNCTIONS}

out vec2 v_uv;
out vec4 v_color;
out float v_starScale;
out float v_yStretch;

uniform float u_starScale;
uniform float u_yStretch;

void main() {
  float dScale = getDestroyScale(a_destroyTime, u_time);
  vec2 dOffset = getDestroyOffset(a_destroyTime, u_time);

  float breathe = 1.0;
  if (a_breathes > 0.5) {
    float localTime = u_time - a_phase;
    breathe = 1.0 + 0.08 * sin(localTime * 2.0);
  }

  float baseRadius = a_size * 80.0 * u_starScale * breathe;
  float radius = baseRadius * dScale;

  // Stretch the quad on Y axis to accommodate yStretch
  vec2 quadScale = vec2(1.0, u_yStretch);
  vec2 pixelPos = a_position + dOffset + a_quad * quadScale * radius;
  vec2 clipPos = (pixelPos / u_resolution) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;

  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_uv = a_quad * quadScale;
  v_color = a_color;
  v_starScale = u_starScale;
  v_yStretch = u_yStretch;
}
`;

export const starFrag = `#version 300 es
precision highp float;

in vec2 v_uv;
in vec4 v_color;
in float v_starScale;
in float v_yStretch;
out vec4 fragColor;

void main() {
  if (v_starScale <= 0.0) discard;

  float dx = abs(v_uv.x);
  float dy = abs(v_uv.y);

  // Reciprocal-function cross: thickness = k / (distance_along_arm + k)
  // This creates a natural diamond shape at the center where arms intersect
  float k = 0.015;

  // Each arm: the perpendicular distance must be less than the reciprocal envelope
  float armX = k / (dx + k);  // thickness envelope along X arm
  float armY = k / (dy + k);  // thickness envelope along Y arm

  float crossX = smoothstep(armY * 0.5, armY * 0.25, dx);  // horizontal arm contribution
  float crossY = smoothstep(armX * 0.5, armX * 0.25, dy);  // vertical arm contribution

  float cross = max(crossX, crossY);

  // Fade at tips based on distance along each axis
  float tipFadeX = 1.0 - smoothstep(0.7, 1.0, dy / v_yStretch);
  float tipFadeY = 1.0 - smoothstep(0.7, 1.0, dx);
  float tipFade = crossX > crossY ? tipFadeX : tipFadeY;
  cross *= tipFade;

  if (cross < 0.01) discard;

  // Color: white-hot at center, rarity color at edges
  float distFromCenter = length(v_uv / vec2(1.0, v_yStretch));
  vec3 color = mix(vec3(1.0), v_color.rgb, smoothstep(0.0, 0.5, distFromCenter));

  fragColor = vec4(color * cross, cross);
}
`;

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

  vec2 pixelPos = a_position + dOffset + a_quad * radius;
  vec2 clipPos = (pixelPos / u_resolution) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;

  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_uv = a_quad;
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

  vec2 uv = v_uv;
  uv.y /= v_yStretch;

  float dx = abs(uv.x);
  float dy = abs(uv.y);

  float distFromCenter = length(uv);

  // Cross shape: min distance to either axis
  float crossDist = min(dx, dy);

  // Taper: thickness decreases with distance from center
  float maxThickness = 0.12;
  float taper = max(0.0, 1.0 - distFromCenter);
  float thickness = maxThickness * taper;

  float cross = 1.0 - smoothstep(thickness * 0.5, thickness, crossDist);

  // Fade at tips
  float tipFade = 1.0 - smoothstep(0.6, 1.0, distFromCenter);
  cross *= tipFade;

  if (cross < 0.01) discard;

  // Color: white at center, rarity color at edges
  vec3 color = mix(vec3(1.0), v_color.rgb, smoothstep(0.0, 0.7, distFromCenter));

  fragColor = vec4(color * cross, cross);
}
`;

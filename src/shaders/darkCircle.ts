import { COMMON_VERTEX_HEADER, DESTROY_FUNCTIONS } from './common.js';

export const darkCircleVert = `${COMMON_VERTEX_HEADER}
${DESTROY_FUNCTIONS}

out vec2 v_uv;

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
}
`;

export const darkCircleFrag = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

void main() {
  float dist = length(v_uv);
  float alpha = 1.0 - smoothstep(0.9, 1.0, dist);
  fragColor = vec4(0.0, 0.0, 0.0, alpha * 0.85);
}
`;

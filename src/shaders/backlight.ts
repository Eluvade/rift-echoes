import { COMMON_VERTEX_HEADER, DESTROY_FUNCTIONS } from './common.js';

export const backlightVert = `${COMMON_VERTEX_HEADER}
${DESTROY_FUNCTIONS}

out vec2 v_uv;
out vec4 v_color;

void main() {
  float dScale = getDestroyScale(a_destroyTime, u_time);
  vec2 dOffset = getDestroyOffset(a_destroyTime, u_time);

  float baseRadius = a_size * 120.0;
  float radius = baseRadius * dScale;

  vec2 pixelPos = a_position + dOffset + a_quad * radius;
  vec2 clipPos = (pixelPos / u_resolution) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;

  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_uv = a_quad;
  v_color = a_color;
}
`;

export const backlightFrag = `#version 300 es
precision highp float;

in vec2 v_uv;
in vec4 v_color;
out vec4 fragColor;

void main() {
  float dist = length(v_uv);
  if (dist > 1.0) discard;

  // Inner cutoff: sharp edge where the "dark circle" would be
  // innerEdge is ~0.30 of the quad (36px / 120px)
  float innerEdge = 0.30;

  // Ring glow: ramps up from inner edge, peaks, then fades to outer edge
  float innerRamp = smoothstep(innerEdge - 0.02, innerEdge + 0.08, dist);
  float outerFade = 1.0 - smoothstep(0.35, 1.0, dist);

  float alpha = innerRamp * outerFade * 0.8;
  if (alpha < 0.005) discard;

  fragColor = vec4(v_color.rgb * alpha, alpha);
}
`;

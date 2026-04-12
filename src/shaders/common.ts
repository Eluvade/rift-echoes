export const COMMON_VERTEX_HEADER = `#version 300 es
precision highp float;

layout(location=0) in vec2 a_quad;
layout(location=1) in vec2 a_position;
layout(location=2) in float a_size;
layout(location=3) in float a_phase;
layout(location=4) in vec4 a_color;
layout(location=5) in float a_destroyTime;
layout(location=6) in float a_breathes;

uniform float u_time;
uniform vec2 u_resolution;
`;

export const DESTROY_FUNCTIONS = `
vec2 getDestroyOffset(float destroyTime, float time) {
  if (destroyTime <= 0.0) return vec2(0.0);
  float dt = time - destroyTime;
  if (dt < 0.3) {
    return vec2(sin(dt * 60.0) * 3.0, cos(dt * 47.0) * 3.0);
  }
  return vec2(0.0);
}

float getDestroyScale(float destroyTime, float time) {
  if (destroyTime <= 0.0) return 1.0;
  float dt = time - destroyTime;
  if (dt < 0.3) return 1.0;
  if (dt < 0.5) return 1.0 + (dt - 0.3) * 0.5;
  if (dt < 0.7) return max(0.0, 1.1 - (dt - 0.5) * 5.5);
  return 0.0;
}
`;

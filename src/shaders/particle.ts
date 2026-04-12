export const particleVert = `#version 300 es
precision highp float;

layout(location=0) in vec2 a_quad;

// Per-particle instance data
layout(location=1) in float a_seed;
layout(location=2) in float a_lifetime;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_center;
uniform float u_innerRadius;
uniform float u_outerRadius;
uniform float u_speed;
uniform float u_particleSize;
uniform vec4 u_color;
uniform float u_destroyTime;
uniform float u_jitter;

out vec2 v_uv;
out float v_alpha;

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

// Hash function for pseudo-random per-particle values
float hash(float n) {
  return fract(sin(n) * 43758.5453);
}

void main() {
  float dScale = getDestroyScale(u_destroyTime, u_time);
  vec2 dOffset = getDestroyOffset(u_destroyTime, u_time);

  // Lifecycle: 0..1 repeating, each particle offset by its seed
  float t = fract(u_time * u_speed * 0.25 + a_seed);

  // Each particle gets a unique fixed angle from its seed
  float baseAngle = hash(a_seed * 127.1) * 6.2831853;

  // Small angular drift as it moves inward (non-linear, wobbly)
  float drift = sin(t * 4.0 + a_seed * 20.0) * 0.3
              + sin(t * 7.0 + a_seed * 13.0) * 0.15;
  float angle = baseAngle + drift;

  // Radius: spawn at random point between inner and outer, move inward
  float spawnR = mix(u_innerRadius, u_outerRadius, hash(a_seed * 311.7));
  float r = mix(spawnR, u_innerRadius, t) * dScale;

  // Jitter for higher rarities (fire-like cracklings)
  float jitterX = sin(u_time * 15.0 + a_seed * 50.0) * u_jitter;
  float jitterY = cos(u_time * 11.3 + a_seed * 37.0) * u_jitter;

  vec2 particleCenter = u_center + dOffset
    + vec2(cos(angle), sin(angle)) * r
    + vec2(jitterX, jitterY);

  // Size: shrinks as particle approaches center
  float size = u_particleSize * (1.0 - t * 0.7) * dScale;

  vec2 pixelPos = particleCenter + a_quad * size;
  vec2 clipPos = (pixelPos / u_resolution) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;

  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_uv = a_quad;
  v_alpha = (1.0 - t * 0.6);
}
`;

export const particleFrag = `#version 300 es
precision highp float;

in vec2 v_uv;
in float v_alpha;
uniform vec4 u_color;
out vec4 fragColor;

void main() {
  float dist = length(v_uv);
  float circle = 1.0 - smoothstep(0.5, 1.0, dist);
  if (circle < 0.01) discard;

  float alpha = circle * v_alpha;
  fragColor = vec4(u_color.rgb * alpha, alpha);
}
`;

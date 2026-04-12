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
out float v_glowSize;

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

float hash(float n) {
  return fract(sin(n) * 43758.5453);
}

void main() {
  float dScale = getDestroyScale(u_destroyTime, u_time);
  vec2 dOffset = getDestroyOffset(u_destroyTime, u_time);

  // Lifecycle: 0..1 repeating
  float rawCycle = u_time * u_speed * 0.5 + a_seed;
  float t = fract(rawCycle);
  float cycleIndex = floor(rawCycle);

  // Ease-in: accelerate toward center
  float easedT = t * t;

  // Randomize angle AND spawn radius per cycle so respawns aren't predictable
  float cycleHash1 = hash(a_seed * 127.1 + cycleIndex * 7.31);
  float cycleHash2 = hash(a_seed * 311.7 + cycleIndex * 13.17);
  float cycleHash3 = hash(a_seed * 53.3 + cycleIndex * 3.71);

  float baseAngle = cycleHash1 * 6.2831853;

  // Subtle angular drift
  float drift = sin(t * 3.0 + a_seed * 20.0) * 0.08;
  float angle = baseAngle + drift;

  // Spawn at random radius between inner and outer — different each cycle
  float spawnR = mix(u_innerRadius * 1.5, u_outerRadius, cycleHash2);
  float r = mix(spawnR, u_innerRadius, easedT) * dScale;

  // Minimal jitter, fading near center
  float jitterScale = (1.0 - easedT) * u_jitter * 0.3;
  float jitterX = sin(u_time * 8.0 + a_seed * 50.0) * jitterScale;
  float jitterY = cos(u_time * 6.5 + a_seed * 37.0) * jitterScale;

  vec2 particleCenter = u_center + dOffset
    + vec2(cos(angle), sin(angle)) * r
    + vec2(jitterX, jitterY);

  // Varied size per particle (0.6x to 1.4x), different each cycle
  float sizeVariation = 0.6 + cycleHash3 * 0.8;
  float size = u_particleSize * sizeVariation * (1.0 - easedT * 0.85) * dScale;

  // Larger quad to accommodate radial glow (glow extends beyond core)
  float glowPadding = 2.0;
  vec2 pixelPos = particleCenter + a_quad * size * glowPadding;
  vec2 clipPos = (pixelPos / u_resolution) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;

  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_uv = a_quad * glowPadding;
  v_alpha = 0.5 + easedT * 0.5;
  v_glowSize = sizeVariation;
}
`;

export const particleFrag = `#version 300 es
precision highp float;

in vec2 v_uv;
in float v_alpha;
in float v_glowSize;
uniform vec4 u_color;
out vec4 fragColor;

void main() {
  float dist = length(v_uv);

  // Core: bright solid circle
  float core = 1.0 - smoothstep(0.3, 0.6, dist);

  // Radial glow: soft falloff extending further
  float glow = exp(-dist * dist * 2.0) * 0.5;

  float combined = core + glow;
  if (combined < 0.01) discard;

  float alpha = combined * v_alpha;
  fragColor = vec4(u_color.rgb * alpha, alpha);
}
`;

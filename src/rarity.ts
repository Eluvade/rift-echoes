import { Rarity, RarityConfig, LayerSpec } from './types.js';

// ─── Stylized loot-drop recipes (2026-06-16 redesign) ─────────────────────
// Rebuilt from the user's reference lineup. Every drop is composed of, back
// to front:
//   1. Outer radial gradient  — large soft glow, CONSTANT size across rarities
//   2. Circular inline (ring) — crisp thin clean circle, CONSTANT size
//   3. Star                   — vertically-elongated 4-point '+', RARITY-SCALED
//   4. Particles              — sparse dots kept WITHIN the star's reach
//
// Only the star (and particle density) changes between rarities; the gradient
// and the inline ring are identical on every tier. The old textured orb
// (T_SPHERE) is dropped — its concentric "bullseye" read as a bad textured
// animation. The ring layer is a clean procedural circle instead.

// Constant across every rarity (per the reference: "same size … for the
// circular sharp inline and the outside gradient").
const HALO_SIZE = 200;   // outer radial gradient (furthest-back soft glow)
const RING_SIZE = 80;    // circular sharp inline

interface TierShape {
  color: [number, number, number];
  /** Star quad size in px (0 = no star, e.g. Common). Bigger = higher rarity. */
  starSize: number;
  /** Horizontal arm reach as a fraction of the quad (vertical reach is fixed
   *  near 1.0). Smaller = more vertically elongated star. */
  starLX: number;
  /** Particle density tier. */
  particles: 'none' | 'few' | 'full';
}

function makeRarity(t: TierShape): RarityConfig {
  const layers: LayerSpec[] = [
    // 1. Outer radial gradient — soft, slow, low alpha. Constant size.
    {
      kind: 'partic',
      sizeCurve: 'rampUp',
      alphaCurve: 'bellLow',
      emitter: { spawnRate: 2, lifetime: 4.0, size: { kind: 'fixed', value: HALO_SIZE } },
    },
    // 2. Circular sharp inline — crisp clean ring. Constant size + thickness.
    {
      kind: 'ring',
      sizeCurve: 'rampUp',
      alphaCurve: 'bell',
      dmp: [0.82, 0.045, 1.0, 1.0],
      emitter: { spawnRate: 2, lifetime: 4.0, size: { kind: 'fixed', value: RING_SIZE } },
    },
  ];

  // 3. Star — rarity-scaled, vertically elongated (dmp = [lx, ly]).
  if (t.starSize > 0) {
    layers.push({
      kind: 'star',
      sizeCurve: 'bell',
      alphaCurve: 'bell',
      dmp: [t.starLX, 1.0, 1.0, 1.0],
      emitter: {
        spawnRate: 8,
        lifetime: 1.5,
        size: { kind: 'fixed', value: t.starSize },
        randomRotation: false,
      },
    });
  }

  // 4. Particles — short-lived, low-velocity so they stay near the star.
  if (t.particles !== 'none') {
    // Loot-sprite pops (T_Loot) — small bright dots.
    layers.push({
      kind: 'partic3',
      sizeCurve: 'rampUp',
      alphaCurve: 'bellMid',
      emitter: { spawnRate: 3, lifetime: 1.0, size: { kind: 'rangeUniform', min: 6, max: 12 } },
    });
    // Radial drifters — a denser scatter that stays within the star's reach.
    // displacement ≈ velocity/drag ≈ 320/2.5 ≈ 130px out. bellMid alpha keeps
    // them visible in mid-flight (fading only at the very start/end of life).
    const passes = t.particles === 'full' ? 2 : 1;
    for (let i = 0; i < passes; i++) {
      layers.push({
        kind: 'partic',
        sizeCurve: 'bell',
        alphaCurve: 'bellMid',
        emitter: {
          spawnRate: 75,
          lifetime: [0.7, 1.1],
          size: { kind: 'rangeUniform', min: 5, max: 10 },
          spawnShape: { kind: 'disc', radius: 12 },
          velocityFromPoint: 320,
          drag: 2.5,
          curlNoiseStrength: 150,
        },
      });
    }
  }

  return { color: t.color, layers };
}

export const RARITY_CONFIGS: Record<Rarity, RarityConfig> = {
  [Rarity.Common]:    makeRarity({ color: [0.85, 0.85, 0.90], starSize: 0,   starLX: 0.70, particles: 'none' }),
  [Rarity.Uncommon]:  makeRarity({ color: [0.25, 0.95, 0.40], starSize: 165, starLX: 0.70, particles: 'none' }),
  [Rarity.Rare]:      makeRarity({ color: [0.30, 0.55, 1.00], starSize: 180, starLX: 0.60, particles: 'few'  }),
  [Rarity.Epic]:      makeRarity({ color: [0.75, 0.30, 1.00], starSize: 240, starLX: 0.50, particles: 'full' }),
  [Rarity.Legendary]: makeRarity({ color: [1.00, 0.65, 0.05], starSize: 300, starLX: 0.42, particles: 'full' }),
  [Rarity.Unique]:    makeRarity({ color: [1.00, 0.18, 0.18], starSize: 340, starLX: 0.38, particles: 'full' }),
};

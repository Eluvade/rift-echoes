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
const HALO_SIZE = 200;   // L0 center gradient (furthest-back soft glow)
const FLARE_SIZE = 420;  // L2 energy-flare corona (Legendary+)
// Ring quad must contain the gradient band: it rises around the inner radius
// (~80px) and fades out over a long tail to the quad edge, so the quad
// half-extent needs headroom for that tail. Placement within the quad is set
// by the ring DMP below.
const RING_SIZE = 820;   // soft annulus band — large enough to FRAME the star core

interface TierShape {
  color: [number, number, number];
  /** Star quad size in px (0 = no star, e.g. Common). Bigger = higher rarity. */
  starSize: number;
  /** Horizontal arm reach as a fraction of the quad (vertical reach is fixed
   *  near 1.0). Smaller = more vertically elongated star. */
  starLX: number;
  /** Approximate number of L3 particles in flight (0 = none). A few at low
   *  tiers up to ~40 at the top. */
  particles: number;
  /** L2 energy flare — Legendary tier and above only. */
  flare: boolean;
}

function makeRarity(t: TierShape): RarityConfig {
  const layers: LayerSpec[] = [
    // 1. L0 center gradient — a procedural soft glow, never fully opaque, and
    //    smaller than the ring (ends well inside L1's radius, leaving padding).
    //    Single immortal burst+hold instance. dmp = [radius 0 = solid centre,
    //    peak opacity, fade reach, falloff exponent]; low exponent = soft fade.
    {
      kind: 'glow',
      sizeCurve: 'hold',
      alphaCurve: 'hold',
      dmp: [0.0, 0.16, 0.7, 0.7],
      emitter: { spawnRate: 0, burst: 1, lifetime: 1e6, size: { kind: 'fixed', value: HALO_SIZE } },
    },
    // 2. Soft radial gradient band — no crisp line, just a glow that's brightest
    //    around the inner radius and fades gently outward (the L1 spec). A single
    //    immortal `burst` instance with `hold` curves, so it's exactly one steady
    //    band, not a stack of staggered-age rings smeared across radii. dmp =
    //    [inner radius, peak opacity, fade reach]; radius/reach are fractions of
    //    the quad half-extent (180px): peak ~0.45→80px, fading over 0.5→to ~170px.
    {
      kind: 'ring',
      sizeCurve: 'hold',
      alphaCurve: 'hold',
      dmp: [0.66, 0.12, 0.26, 0.9],
      emitter: { spawnRate: 0, burst: 1, lifetime: 1e6, size: { kind: 'fixed', value: RING_SIZE } },
    },
  ];

  // 2b. L2 energy flare (Legendary tier and above) — an animated procedural
  //     corona of flame/energy tongues radiating from the centre. Single
  //     burst+hold instance; the animation is driven by u_time in the shader.
  //     dmp = [tongue frequency, drift speed, reach, intensity].
  if (t.flare) {
    layers.push({
      kind: 'flare',
      sizeCurve: 'hold',
      alphaCurve: 'hold',
      dmp: [2.2, 0.5, 0.95, 1.0],
      emitter: { spawnRate: 0, burst: 1, lifetime: 1e6, size: { kind: 'fixed', value: FLARE_SIZE } },
    });
  }

  // 3. Star — rarity-scaled, on a square quad; the vertical elongation comes
  //    from the shader's anisotropic arm reach (dmp = [reachX, reachY], reachX
  //    < reachY → taller than wide). A single steady instance (burst + hold)
  //    so the breath, not particle churn, animates it.
  if (t.starSize > 0) {
    layers.push({
      kind: 'star',
      sizeCurve: 'hold',
      alphaCurve: 'hold',
      // dmp.y = 1.2 pushes the vertical reach past the quad-edge choke so the
      // top/bottom spikes stay bright further out — the long vertical arm of the
      // reference. dmp.x = starLX (< 1) keeps the horizontals pulled in, so the
      // ratio reads taller-than-wide.
      dmp: [t.starLX, 1.2, 1.0, 1.0],
      emitter: {
        spawnRate: 0,
        burst: 1,
        lifetime: 1e6,
        // Square quad (fixed → has a `.value`, which grid.html / contact.mjs
        // sliders rely on; a rangeXY here renders NaN-sized in those tools). The
        // vertical-vs-horizontal elongation comes from the shader reach: vertical
        // (dmp.y = 1.0) fills the quad while horizontal (dmp.x = starLX < 1) is
        // pulled in, so a low starLX gives the taller look.
        size: { kind: 'fixed', value: t.starSize },
        randomRotation: false,
      },
    });
  }

  // 4. Particles — drawn INWARD (L3) as slow "magic bubbles" / fireflies. They
  //    spawn on a ring at the outer edge, fade in from transparent, then drift
  //    toward the center on a lazy spiral, each weaving its own autonomous path
  //    (swirl + per-particle wander) before being consumed at the core. Fat,
  //    sparse and unhurried — a gentle suck, not a crackling rush. Count scales
  //    with rarity; avgLife ≈ 2.2s, so spawnRate ≈ count / avgLife keeps ~count
  //    in flight at once.
  if (t.particles > 0) {
    const avgLife = 2.2;
    layers.push({
      kind: 'partic',
      sizeCurve: 'rampDown',  // spawn at full size, then shrink as they're drawn in
      alphaCurve: 'bell',     // transparent → peak max → fade out toward the center
      emitter: {
        spawnRate: t.particles / avgLife,
        lifetime: [1.7, 2.7],
        size: { kind: 'rangeUniform', min: 22, max: 52 },   // fat soft "bubbles"
        spawnShape: { kind: 'ring', radius: 165 },   // start out at the ring edge
        velocityFromPoint: -40,    // clear inward launch at birth (never outward)
        attractToCenter: 200,      // DOMINANT inward suck — must clearly beat swirl+wander
        drag: 1.6,                 // high drag caps speed: terminal ≈ attract/drag, slow + steady
        swirl: 22,                 // gentle tangential bias → spiral, not bee-line
        wanderStrength: 34,        // subtle weave on top of the pull (< attract, so never reverses it)
        wanderRate: [0.5, 1.6],    // each weaves at its own pace
      },
    });
  }

  return { color: t.color, layers };
}

export const RARITY_CONFIGS: Record<Rarity, RarityConfig> = {
  [Rarity.Common]:    makeRarity({ color: [0.85, 0.85, 0.90], starSize: 0,   starLX: 0.70, particles: 0,  flare: false }),
  [Rarity.Uncommon]:  makeRarity({ color: [0.25, 0.95, 0.40], starSize: 450, starLX: 0.70, particles: 8,  flare: false }),
  [Rarity.Rare]:      makeRarity({ color: [0.30, 0.55, 1.00], starSize: 520, starLX: 0.68, particles: 14, flare: false }),
  [Rarity.Epic]:      makeRarity({ color: [0.75, 0.30, 1.00], starSize: 660, starLX: 0.66, particles: 22, flare: false }),
  [Rarity.Legendary]: makeRarity({ color: [1.00, 0.50, 0.03], starSize: 800, starLX: 0.64, particles: 32, flare: true  }),
  [Rarity.Unique]:    makeRarity({ color: [1.00, 0.18, 0.18], starSize: 900, starLX: 0.62, particles: 40, flare: true  }),
};

import { Rarity, RarityConfig } from './types.js';

export const RARITY_CONFIGS: Record<Rarity, RarityConfig> = {
  [Rarity.Common]: {
    color: [0.533, 0.533, 0.533],
    particleCount: 0,
    particleSpeed: 0,
    starScale: 0,
    starYStretch: 0.0,
    starBreathes: false,
  },
  [Rarity.Uncommon]: {
    color: [0.2, 0.9, 0.3],
    particleCount: 6,
    particleSpeed: 0.3,
    starScale: 1.0,
    // starXStretch: 0.0, // interface needs to be updated to include this property
    starYStretch: 0.5,
    starBreathes: false,
  },
  [Rarity.Rare]: {
    color: [0.267, 0.533, 1.0],
    particleCount: 20,
    particleSpeed: 1.47,
    starScale: 1.25,
    starYStretch: 0.5,
    starBreathes: false,
  },
  [Rarity.Epic]: {
    color: [0.733, 0.267, 1.0],
    particleCount: 40,
    particleSpeed: 1.74,
    starScale: 1.47,
    starYStretch: 1.25,
    starBreathes: true,
  },
  [Rarity.Legendary]: {
    color: [1.0, 0.667, 0.0],
    particleCount: 60,
    particleSpeed: 2.0,
    starScale: 1.77,
    starYStretch: 1.5,
    starBreathes: true,
  },
  [Rarity.Unique]: {
    color: [1.0, 0.2, 0.2],
    particleCount: 60,
    particleSpeed: 2.0,
    starScale: 1.77,
    starYStretch: 1.5,
    starBreathes: true,
  },
};

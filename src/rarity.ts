import { Rarity, RarityConfig } from './types.js';

export const RARITY_CONFIGS: Record<Rarity, RarityConfig> = {
  [Rarity.Common]: {
    color: [0.533, 0.533, 0.533],
    particleCount: 0,
    particleSpeed: 0,
    starScale: 0,
    starYStretch: 1.0,
    starBreathes: false,
  },
  [Rarity.Uncommon]: {
    color: [1.0, 1.0, 1.0],
    particleCount: 3,
    particleSpeed: 0.3,
    starScale: 1.0,
    starYStretch: 1.0,
    starBreathes: false,
  },
  [Rarity.Rare]: {
    color: [0.267, 0.533, 1.0],
    particleCount: 10,
    particleSpeed: 0.6,
    starScale: 1.8,
    starYStretch: 1.0,
    starBreathes: false,
  },
  [Rarity.Epic]: {
    color: [0.733, 0.267, 1.0],
    particleCount: 20,
    particleSpeed: 0.8,
    starScale: 1.8,
    starYStretch: 1.25,
    starBreathes: true,
  },
  [Rarity.Legendary]: {
    color: [1.0, 0.667, 0.0],
    particleCount: 30,
    particleSpeed: 1.0,
    starScale: 1.8,
    starYStretch: 1.5,
    starBreathes: false,
  },
  [Rarity.Unique]: {
    color: [1.0, 0.2, 0.2],
    particleCount: 30,
    particleSpeed: 1.0,
    starScale: 1.8,
    starYStretch: 1.5,
    starBreathes: false,
  },
};

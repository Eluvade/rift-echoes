export enum Rarity {
  Common = 0,
  Uncommon = 1,
  Rare = 2,
  Epic = 3,
  Legendary = 4,
  Unique = 5,
}

export interface CargoCacheParams {
  rarity: Rarity;
  x?: number;
  y?: number;
  size?: number;
}

export interface RarityConfig {
  color: [number, number, number];
  particleCount: number;
  particleSpeed: number;
  starScale: number;
  starYStretch: number;
  starBreathes: boolean;
}

export interface RiftRendererOptions {
  canvas?: HTMLCanvasElement;
}

// Progress analysis: diffs our compiled recipe (dist/) against the reference
// Niagara systems (reference/curves/*.json, exported from the commercial
// .uasset). Reports per-tier build completeness (emitter/layer count vs the
// reference) and confirms our curve vocabulary stays within the reference's.
//
//   node scripts/analyze.mjs
//
// Reference curves only exist for the four middle tiers (the commercial pack
// ships uncommon→legendary as one system; Common/Unique have no export here).

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { RARITY_CONFIGS, Rarity } from '../dist/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TIERS = ['uncommon', 'rare', 'epic', 'legendary'];

// ── Reference side ─────────────────────────────────────────────────────────
const classify = (lut) => {
  if (!lut || !lut.length) return '?';
  const v = lut.map((p) => (Array.isArray(p) ? p[p.length - 1] : p)).filter((x) => typeof x === 'number');
  if (!v.length) return '?';
  const n = v.length, a = v[0], m = v[(n / 2) | 0], b = v[n - 1];
  const mx = Math.max(...v), mn = Math.min(...v);
  if (mx - mn < 0.05 * Math.max(1, mx)) return 'hold';
  if (m >= a * 1.15 && m >= b * 1.15) return 'bell';
  return b > a ? 'rampUp' : 'rampDown';
};

const refTier = async (tier) => {
  const j = JSON.parse(await readFile(`${ROOT}/reference/curves/${tier}.json`, 'utf8'));
  const emitters = new Set();
  const shapes = new Set();
  for (const c of j) {
    emitters.add(c.emitter || '?');
    if (c.objectName.includes('Alpha') || c.objectName.includes('Sprite_Scale') || c.objectName.includes('Scale_Factor')) {
      shapes.add(classify(c.lut));
    }
  }
  return { emitters: emitters.size, shapes };
};

// ── Our side ───────────────────────────────────────────────────────────────
const ourTier = (name) => {
  const cfg = RARITY_CONFIGS[Rarity[name[0].toUpperCase() + name.slice(1)]];
  const shapes = new Set();
  for (const l of cfg.layers) { shapes.add(l.sizeCurve ?? 'bell'); shapes.add(l.alphaCurve ?? 'bell'); }
  return { layers: cfg.layers.length, kinds: cfg.layers.map((l) => l.kind), shapes };
};

// ── Report ─────────────────────────────────────────────────────────────────
console.log('\n  RIFT-ECHOES — progress vs reference\n  ' + '─'.repeat(52));
let totRef = 0, totOurs = 0;
for (const tier of TIERS) {
  const ref = await refTier(tier);
  const ours = ourTier(tier);
  totRef += ref.emitters; totOurs += ours.layers;
  const pct = Math.round((ours.layers / ref.emitters) * 100);
  const bar = '█'.repeat(Math.round(pct / 10)).padEnd(10, '·');
  console.log(`  ${tier.padEnd(10)} ${String(ours.layers).padStart(2)} / ${String(ref.emitters).padStart(2)} layers  ${bar} ${pct}%`);
  console.log(`             ours: ${ours.kinds.join(', ')}`);
}
console.log('  ' + '─'.repeat(52));
console.log(`  TOTAL      ${totOurs} / ${totRef} layers  →  ${Math.round((totOurs / totRef) * 100)}% of reference density\n`);

// Curve vocabulary check: every shape we use should appear in the reference's
// (mapping bellLow/bellMid → bell, hold → our static addition).
const refVocab = new Set();
for (const tier of TIERS) for (const s of (await refTier(tier)).shapes) refVocab.add(s);
const norm = (s) => (s === 'bellLow' || s === 'bellMid' ? 'bell' : s);
const ourVocab = new Set();
for (const tier of TIERS) for (const s of ourTier(tier).shapes) ourVocab.add(norm(s));
const extra = [...ourVocab].filter((s) => s !== 'hold' && !refVocab.has(s));
console.log('  curve vocabulary');
console.log('    reference uses : ' + [...refVocab].join(', '));
console.log('    we use         : ' + [...ourVocab].join(', '));
console.log('    off-reference  : ' + (extra.length ? extra.join(', ') : 'none (hold is our static-layer addition)') + '\n');

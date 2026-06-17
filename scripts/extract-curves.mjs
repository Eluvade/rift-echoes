// Pulls every FRichCurve's pre-baked ShaderLUT out of UAssetGUI JSON dumps.
// Each Niagara curve asset exports its LUT + time range; we collect them in
// order so they can be cross-referenced against the emitter/module they feed.
//
// Usage: node scripts/extract-curves.mjs reference/3.json > reference/curves/uncommon.json

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const files = [
  ['reference/3.json', 'uncommon'],
  ['reference/1.json', 'rare'],
  ['reference/2.json', 'epic'],
  ['reference/4.json', 'legendary'],
];

mkdirSync('reference/curves', { recursive: true });

for (const [path, tag] of files) {
  console.error(`Reading ${path} ...`);
  const raw = readFileSync(path, 'utf8');
  const asset = JSON.parse(raw);
  const curves = [];

  const exports = asset.Exports ?? [];
  const imports = asset.Imports ?? [];

  // UAsset package index: +N = exports[N-1], -N = imports[N-1]
  const resolveOuter = (idx) => {
    if (idx === 0) return null;
    if (idx > 0) return exports[idx - 1];
    return imports[-idx - 1];
  };

  const walkChain = (ex) => {
    const chain = [];
    let cur = ex;
    for (let d = 0; d < 10 && cur; d++) {
      chain.push(cur.ObjectName || '?');
      cur = resolveOuter(cur.OuterIndex ?? 0);
    }
    return chain;
  };

  // Find the enclosing emitter (Fountain* name) in the chain
  const emitterFromChain = (chain) => {
    for (const name of chain) {
      if (/^Fountain(_?\d+)?(_\d+)?$/i.test(name)) return name.replace(/_\d+$/, '');
    }
    return null;
  };

  // Walk every Export looking for a Data array that contains a "Curve" struct
  // and a "ShaderLUT" array — that's a Niagara curve asset.
  for (let i = 0; i < exports.length; i++) {
    const ex = exports[i];
    if (!ex?.Data || !Array.isArray(ex.Data)) continue;

    let curveEntry = null;
    let lut = null;
    let lutMinTime = null;
    let lutMaxTime = null;
    let numSamplesMinusOne = null;
    let keys = null;

    for (const prop of ex.Data) {
      if (prop.Name === 'Curve' && prop.StructType === 'RichCurve') {
        curveEntry = prop;
        // keys live at prop.Value[0].Value (Keys array)
        const keysProp = prop.Value?.[0];
        if (keysProp && Array.isArray(keysProp.Value)) {
          keys = keysProp.Value.map(k => {
            const kv = k.Value?.[0]?.Value;
            if (!kv) return null;
            return { t: kv.Time, v: kv.Value, interp: kv.InterpMode };
          }).filter(Boolean);
        }
      }
      if (prop.Name === 'ShaderLUT' && Array.isArray(prop.Value)) {
        lut = prop.Value.map(v => v.Value);
      }
      if (prop.Name === 'LUTMinTime') lutMinTime = prop.Value;
      if (prop.Name === 'LUTMaxTime') lutMaxTime = prop.Value;
      if (prop.Name === 'LUTNumSamplesMinusOne') numSamplesMinusOne = prop.Value;
    }

    if (curveEntry && lut) {
      const chain = walkChain(ex);
      curves.push({
        exportIndex: i,
        objectName: ex.ObjectName,
        chain,
        emitter: emitterFromChain(chain),
        lutMinTime,
        lutMaxTime,
        numSamplesMinusOne,
        keys,
        lut,
      });
    }
  }

  const outPath = `reference/curves/${tag}.json`;
  writeFileSync(outPath, JSON.stringify(curves, null, 2));
  console.error(`  ${tag}: ${curves.length} curves → ${outPath}`);
}

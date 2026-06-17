// Contact-sheet generator. Builds a labeled grid PNG: one ROW per layer role
// (Gradient / Ring / Star / Particles / Full composite), one COLUMN per
// rarity. Each cell is that role rendered in ISOLATION (via the harness
// ?layers= mask) so you can give precise per-layer feedback.
//
// Run `npm run build` first, then:
//   node scripts/contact.mjs            → captures/contact-sheet.png
//   node scripts/contact.mjs mylabel    → captures/mylabel-contact-sheet.png
//
// Individual cells are also kept under captures/cells/.

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'captures');
const CELLS = join(OUT, 'cells');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
};

const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Unique'];
const ROLES = ['Gradient', 'Ring', 'Star', 'Particles', 'Full'];
const VIEWPORT = { width: 1600, height: 900 };
const STEADY_MS = 2600;
// Cell crop — tall enough to fit the longest vertical star beam (Unique).
const CLIP = { x: 560, y: 150, width: 480, height: 600 };

const args = process.argv.slice(2);
const ASSEMBLE_ONLY = args.includes('--assemble'); // reuse existing cells, just rebuild the grid
const label = args.find((a) => !a.startsWith('--')) ?? '';
const prefix = label ? `${label}-` : '';

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      let rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
      if (rel === '/' || rel === '\\') rel = '/index.html';
      const body = await readFile(join(ROOT, rel));
      res.writeHead(200, { 'Content-Type': MIME[extname(rel).toLowerCase()] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

// Map a rarity's layer-kind list onto the five display roles.
function rolesFor(kinds) {
  const ringIdx = kinds.indexOf('ring');
  const starIdx = kinds.indexOf('star');
  const particleIdxs = kinds
    .map((k, i) => ({ k, i }))
    .filter(({ k, i }) => k === 'partic3' || (k === 'partic' && i !== 0))
    .map((o) => o.i);
  return {
    Gradient: [0],
    Ring: ringIdx >= 0 ? [ringIdx] : null,
    Star: starIdx >= 0 ? [starIdx] : null,
    Particles: particleIdxs.length ? particleIdxs : null,
    Full: kinds.map((_, i) => i),
  };
}

const server = await startServer();
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;
await mkdir(CELLS, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });

// Freeze the star breath at its peak (sin = 1 → breathe max) so every cell
// shows the star at the same, fully-extended phase — comparable across tiers.
const FREEZE = Math.PI / 2;

async function gotoSteady(page, rarity, layers) {
  const q = layers ? `&layers=${layers.join(',')}` : '';
  await page.goto(`${baseUrl}/examples/index.html?rarity=${rarity}${q}&freeze=${FREEZE}`, { waitUntil: 'load' });
  try {
    await page.waitForFunction(() => window.riftRenderer && window.riftCache, null, { timeout: 5000 });
    await page.evaluate(() => window.riftRenderer.ready());
  } catch (e) { console.log(`  ! ${rarity} ${layers}: ${e}`); }
  await page.waitForTimeout(STEADY_MS);
}

// cells[role][rarity] = relative cell PNG path (or null)
const cells = Object.fromEntries(ROLES.map((r) => [r, {}]));

if (ASSEMBLE_ONLY) {
  // Reuse cells already on disk — just rebuild the grid.
  for (const rarity of RARITIES) {
    for (const role of ROLES) {
      const rel = `cells/${prefix}${rarity}-${role}.png`;
      cells[role][rarity] = existsSync(join(OUT, rel)) ? rel : null;
    }
  }
  console.log('  (assemble-only: reusing existing cells)');
} else {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  ! pageerror ' + e));

  for (const rarity of RARITIES) {
    // Discover the layer structure for this rarity.
    await gotoSteady(page, rarity, null);
    const kinds = await page.evaluate(() => window.riftCache.config.layers.map((l) => l.kind));
    const roleMap = rolesFor(kinds);

    for (const role of ROLES) {
      const idxs = roleMap[role];
      if (!idxs) { cells[role][rarity] = null; continue; }
      // Re-navigate isolating this role (Full uses all layers).
      await gotoSteady(page, rarity, role === 'Full' ? null : idxs);
      const rel = `cells/${prefix}${rarity}-${role}.png`;
      await page.screenshot({ path: join(OUT, rel), clip: CLIP });
      cells[role][rarity] = rel;
      console.log(`  ${rarity.padEnd(10)} ${role}`);
    }
  }
  await page.close();
}

// ─── Assemble the grid ────────────────────────────────────────────────────
const THUMB_W = 150, THUMB_H = Math.round((CLIP.height / CLIP.width) * THUMB_W); // keep aspect
const headerCell = (txt) => `<th>${txt}</th>`;
const rowHtml = (role) => {
  const tds = RARITIES.map((r) => {
    const src = cells[role][r];
    const inner = src
      ? `<img src="${baseUrl}/captures/${src}" width="${THUMB_W}" height="${THUMB_H}">`
      : `<span class="none">—</span>`;
    return `<td>${inner}</td>`;
  }).join('');
  return `<tr><th class="rowlbl">${role}</th>${tds}</tr>`;
};

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body { margin:0; background:#0a0a0c; color:#cdd; font-family:'Segoe UI',sans-serif; }
  table { border-collapse:collapse; margin:14px; }
  th,td { padding:4px; text-align:center; }
  thead th { color:#88aaff; font-size:14px; padding-bottom:8px; }
  .rowlbl { color:#aab; font-size:13px; text-align:right; padding-right:10px; white-space:nowrap; }
  td { background:#000; border:1px solid #1c1c22; }
  img { display:block; }
  .none { color:#444; display:inline-block; width:${THUMB_W}px; line-height:${THUMB_H}px; }
  caption { color:#667; font-size:12px; padding:8px; caption-side:bottom; }
</style></head><body>
  <table>
    <thead><tr><th></th>${RARITIES.map(headerCell).join('')}</tr></thead>
    <tbody>${ROLES.map(rowHtml).join('')}</tbody>
    <caption>rift-echoes layer contact sheet — rows = layer role, cols = rarity (each cell rendered in isolation)</caption>
  </table>
</body></html>`;

const sheet = await ctx.newPage();
await sheet.setViewportSize({ width: 140 + RARITIES.length * (THUMB_W + 10) + 40, height: 80 + ROLES.length * (THUMB_H + 10) + 40 });
await sheet.setContent(html, { waitUntil: 'load' });
// Wait for every <img> to finish (networkidle is unreliable headless).
await sheet.evaluate(() => Promise.all(
  [...document.images].map((img) => img.complete ? null : new Promise((res) => { img.onload = img.onerror = res; })),
));
const sheetPath = join(OUT, `${prefix}contact-sheet.png`);
await sheet.locator('table').screenshot({ path: sheetPath });
await sheet.close();

await browser.close();
server.close();
console.log(`\ncontact sheet -> ${sheetPath}`);

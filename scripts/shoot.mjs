// Screenshot harness for the loot-drop demo. Builds nothing — run `npm run
// build` first. Serves the repo root over HTTP (so examples/index.html can
// import ../dist/index.js and load ../reference/*.PNG), launches headless
// Chromium with SwiftShader WebGL, and captures each rarity at steady state.
//
// Usage:
//   node scripts/shoot.mjs                 → captures/<rarity>.png (all six)
//   node scripts/shoot.mjs baseline        → captures/baseline-<rarity>.png
//   node scripts/shoot.mjs baseline Epic   → just Epic, labelled "baseline"
//
// Logs console errors + page errors so WebGL failures (e.g. missing float
// ext) surface instead of producing a silent black frame.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'captures');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
};

const ALL_RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Unique'];
const VIEWPORT = { width: 1600, height: 900 };
const STEADY_MS = 2800; // let the continuous emitters fill to steady state

const label = process.argv[2] ?? '';
const onlyRarity = process.argv[3];
const layersArg = process.argv[4]; // e.g. "0" or "0,1" to isolate layers
const freezeArg = process.argv[5]; // breath phase in radians (pins the pulse)
const rarities = onlyRarity ? [onlyRarity] : ALL_RARITIES;
const prefix = label ? `${label}-` : '';
const layersQuery = layersArg ? `&layers=${layersArg}` : '';
const freezeQuery = freezeArg ? `&freeze=${freezeArg}` : '';

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      let rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
      if (rel === '/' || rel === '\\') rel = '/index.html';
      let filePath = join(ROOT, rel);
      const body = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const server = await startServer();
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});

const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });

for (const rarity of rarities) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  const url = `${baseUrl}/examples/index.html?rarity=${rarity}${layersQuery}${freezeQuery}`;
  await page.goto(url, { waitUntil: 'load' });

  // Wait for the renderer to exist + textures to finish loading, then settle.
  try {
    await page.waitForFunction(() => window.riftRenderer, null, { timeout: 5000 });
    await page.evaluate(() => window.riftRenderer.ready());
  } catch (e) {
    errors.push(`ready() wait failed: ${e}`);
  }
  await page.waitForTimeout(STEADY_MS);
  // SwiftShader runs the clamped clock in slow motion, so the wall-clock wait
  // above doesn't reach steady state. Fast-forward the sim deterministically.
  try { await page.evaluate(() => window.riftRenderer.advance(5)); } catch {}
  await page.waitForTimeout(200);

  const file = join(OUT, `${prefix}${rarity}.png`);
  await page.screenshot({ path: file });
  console.log(`${rarity.padEnd(10)} -> ${file}${errors.length ? '  [errors: ' + errors.length + ']' : ''}`);
  for (const e of errors.slice(0, 6)) console.log('   ! ' + e);

  await page.close();
}

await browser.close();
server.close();
console.log('done.');

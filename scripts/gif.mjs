// Records a looping GIF of a single rift echo, encoded in pure Node (gifenc +
// pngjs) — no system ffmpeg needed. Run `npm run build` first.
//
// The breath is driven deterministically by stepping renderer.breathPhase
// through one full 0..2pi cycle across the frames, so the breath loops
// seamlessly; particles drift via advance() (they don't loop, which is fine).
// Frames are captured under headless SwiftShader.
//
// Usage:
//   node scripts/gif.mjs [Rarity] [size] [frames] [out.gif]
//   node scripts/gif.mjs Unique 0.55 48 examples/unique.gif

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import pngjs from 'pngjs';
import gifenc from 'gifenc';
const { PNG } = pngjs;
const { GIFEncoder, quantize, applyPalette } = gifenc;

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const rarity = process.argv[2] ?? 'Unique';
const size = parseFloat(process.argv[3] ?? '0.55');
const FRAMES = parseInt(process.argv[4] ?? '48', 10);
const outRel = process.argv[5] ?? 'examples/unique.gif';
const OUT = join(ROOT, outRel);

const W = 600, H = 600;     // square frame
const FPS = 12;             // playback rate (FRAMES / FPS = loop length in seconds)
const PARTICLE_DT = 0.09;   // sim-seconds of particle drift per frame
const WARM = 4;             // sim-seconds to fill emitters to steady state first

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg' };

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      let rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
      if (rel === '/' || rel === '\\') rel = '/index.html';
      const body = await readFile(join(ROOT, rel));
      res.writeHead(200, { 'Content-Type': MIME[extname(rel).toLowerCase()] ?? 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

const server = await startServer();
const port = server.address().port;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

const url = `http://127.0.0.1:${port}/examples/index.html?rarity=${rarity}&size=${size}`;
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.riftRenderer, null, { timeout: 5000 });
await page.evaluate(() => window.riftRenderer.ready());
await page.addStyleTag({ content: '.panel,.center-marker{display:none!important}' });
await page.evaluate((w) => window.riftRenderer.advance(w), WARM);

const frames = [];
for (let i = 0; i < FRAMES; i++) {
  await page.evaluate(({ i, FRAMES, dt }) => {
    window.riftRenderer.breathPhase = (i / FRAMES) * Math.PI * 2; // one full breath loop
    window.riftRenderer.advance(dt);                              // drift particles
  }, { i, FRAMES, dt: PARTICLE_DT });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  frames.push(await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } }));
  process.stdout.write(`\rcaptured ${i + 1}/${FRAMES}`);
}
process.stdout.write('\n');
if (errors.length) { console.log('page errors:'); errors.slice(0, 6).forEach((e) => console.log('  ! ' + e)); }

await browser.close();
server.close();

// ── Encode (gifenc) ──────────────────────────────────────────────────────────
// Decode the PNG frames to RGBA, build one global palette from a sample of them
// (stable colours across the loop, less flicker), then write each frame.
const rgba = frames.map((buf) => PNG.sync.read(buf).data);

const stride = W * H * 4;
const step = Math.max(1, Math.floor(FRAMES / 8));
const idxs = [];
for (let i = 0; i < FRAMES; i += step) idxs.push(i);
const sample = new Uint8Array(idxs.length * stride);
idxs.forEach((fi, k) => sample.set(rgba[fi], k * stride));
const palette = quantize(sample, 256);

const gif = GIFEncoder();
const delay = Math.round(1000 / FPS);
for (const frame of rgba) {
  const index = applyPalette(frame, palette);
  gif.writeFrame(index, W, H, { palette, delay });
}
gif.finish();
await writeFile(OUT, gif.bytes());

console.log(`wrote ${outRel}  (${(statSync(OUT).size / 1024).toFixed(0)} kB, ${FRAMES} frames @ ${FPS}fps)`);

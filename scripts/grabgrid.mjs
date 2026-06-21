import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };

const server = await new Promise((r) => {
  const s = createServer(async (req, res) => {
    try {
      const p = decodeURIComponent(req.url.split('?')[0]);
      let rel = normalize(p).replace(/^(\.\.[/\\])+/, '');
      if (rel === '/' || rel === '\\') rel = '/index.html';
      const b = await readFile(join(ROOT, rel));
      res.writeHead(200, { 'Content-Type': MIME[extname(rel).toLowerCase()] ?? 'application/octet-stream' });
      res.end(b);
    } catch { res.writeHead(404); res.end('nf'); }
  });
  s.listen(0, '127.0.0.1', () => r(s));
});
const port = server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
await page.goto(`http://127.0.0.1:${port}/examples/grid.html?freeze=${Math.PI / 2}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.riftRenderer, null, { timeout: 5000 });
await page.evaluate(() => window.riftRenderer.ready());
// Grid spawns its caches in a load handler after ready(); give it a beat, then
// fast-forward the sim to steady state (no dependence on headless frame rate).
await page.waitForTimeout(300);
await page.evaluate(() => window.riftRenderer.advance(5));
await page.waitForTimeout(200); // let one raf draw the warmed state
await page.screenshot({ path: join(ROOT, 'captures', 'grid-verify.png') });
await browser.close();
server.close();
console.log('done');

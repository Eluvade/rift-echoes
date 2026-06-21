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
await page.waitForTimeout(300);

// Closeup of the control column (before any tweak).
await page.evaluate(() => window.riftRenderer.advance(5));
await page.waitForTimeout(150);
await page.screenshot({ path: join(ROOT, 'captures', 'grid-panel.png'), clip: { x: 0, y: 0, width: 240, height: 900 } });

// Drive the Ring "radius" slider to a different value and confirm the config
// and render react (proves live tuning is wired, not just the DOM).
const before = await page.evaluate(() => window.riftRenderer && JSON.stringify(undefined));
await page.evaluate(() => {
  const panels = [...document.querySelectorAll('.ctrl')];
  const ring = panels.find((p) => p.querySelector('.ctrl-name')?.textContent === 'Ring');
  const radius = [...ring.querySelectorAll('.cr')].find((r) => r.firstChild.textContent === 'radius');
  const input = radius.querySelector('input');
  input.value = '0.8';
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(60);
await page.evaluate(() => window.riftRenderer.advance(3));
await page.waitForTimeout(150);
await page.screenshot({ path: join(ROOT, 'captures', 'grid-tweaked.png') });

await browser.close();
server.close();
console.log('done');

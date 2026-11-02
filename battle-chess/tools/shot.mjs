// Ad-hoc visual probe: node tools/shot.mjs <outDir> [script]  (expects `npm run preview` running)
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] ?? '.';
const actions = process.argv[3] ?? '';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto('http://127.0.0.1:5180/');
await page.waitForFunction(() => window.__battleChess?.ready, null, { timeout: 30000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(out, 'start.png') });
for (const [i, step] of actions.split(';').filter(Boolean).entries()) {
  const [kind, arg, wait] = step.split(':');
  if (kind === 'click') {
    const p = await page.evaluate((n) => window.__battleChess.squareToClient(n), arg);
    await page.mouse.click(p.x, p.y);
  } else if (kind === 'eval') await page.evaluate(arg);
  else if (kind === 'key') await page.keyboard.press(arg);
  await page.waitForTimeout(Number(wait ?? 300));
  await page.screenshot({ path: path.join(out, `step${i}.png`) });
}
const state = await page.evaluate(() => ({ fen: window.__battleChess.fen(), errors: window.__battleChess.errors, history: window.__battleChess.history() }));
console.log(JSON.stringify(state, null, 1));
console.log(logs.join('\n'));
await browser.close();

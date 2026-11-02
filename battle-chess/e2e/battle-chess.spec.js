// End-to-end checks of the real game in a real browser: clicks land on the WebGL canvas at the
// projected screen position of each square, and the battles are observed as they play.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'e2e-screens';
fs.mkdirSync(SHOTS, { recursive: true });

async function boot(page) {
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__battleChess?.ready, null, { timeout: 60_000 });
  await expect(page.locator('#loading')).toHaveClass(/done/);
  return problems;
}

const bc = (page, fn, arg) => page.evaluate(([f, a]) => window.__battleChess[f](a), [fn, arg]);

async function clickSquare(page, name) {
  const p = await bc(page, 'squareToClient', name);
  await page.mouse.click(p.x, p.y);
}

async function idle(page, timeout = 30_000) {
  await page.waitForFunction(() => !window.__battleChess.busy(), null, { timeout });
}

// Starts sampling every unit's animation, by unit code, until stopSampling().
async function startSampling(page) {
  await page.evaluate(() => {
    window.__seen = {};
    window.__sampler = setInterval(() => {
      for (const u of window.__battleChess.units()) (window.__seen[u.code] ??= new Set()).add(u.animation);
    }, 30);
  });
}
async function stopSampling(page) {
  return page.evaluate(() => {
    clearInterval(window.__sampler);
    return Object.fromEntries(Object.entries(window.__seen).map(([k, v]) => [k, [...v]]));
  });
}

async function setup(page, fen, { mode = 'pvp', speed = 1 } = {}) {
  const problems = await boot(page);
  await page.selectOption('#mode', mode);
  await bc(page, 'setSpeed', speed);
  if (fen) await bc(page, 'load', fen);
  await page.waitForTimeout(300);
  return problems;
}

async function canvasIsDrawn(page) {
  return page.evaluate(() => {
    const c = document.getElementById('stage');
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.canvas.width = 64;
    ctx.canvas.height = 64;
    ctx.drawImage(c, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    const colors = new Set();
    for (let i = 0; i < d.length; i += 4) colors.add((d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4));
    return colors.size;
  });
}

test('loads the board with 32 units and no errors', async ({ page }) => {
  const problems = await boot(page);
  await page.waitForTimeout(2500);
  expect(await bc(page, 'units')).toHaveLength(32);
  await expect(page.locator('#turn-text')).toHaveText('White to move');
  expect(await canvasIsDrawn(page)).toBeGreaterThan(40);
  const codes = (await bc(page, 'units')).map((u) => u.code).sort();
  expect(new Set(codes)).toEqual(new Set(['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP']));
  await page.screenshot({ path: `${SHOTS}/01-start.png` });
  expect(problems).toEqual([]);
  expect(await page.evaluate(() => window.__battleChess.errors)).toEqual([]);
});

test('every unit sheet passes as a sprite and loads', async ({ page }) => {
  await boot(page);
  for (const code of ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP']) {
    const res = await page.request.get(`/sprites/${code}.png`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
  }
});

test('selecting shows legal moves; clicking plays them; the computer replies', async ({ page }) => {
  const problems = await setup(page, null, { mode: 'ai-w' });
  await page.waitForTimeout(1500);
  await clickSquare(page, 'g1');
  expect(await bc(page, 'selected')).toBe('g1');
  expect(await bc(page, 'highlights', 'f3')).toContain('move');
  expect(await bc(page, 'highlights', 'h3')).toContain('move');
  expect(await bc(page, 'highlights', 'g3')).not.toContain('move');
  expect((await bc(page, 'unitAt', 'g1')).animation).toBe('Walk');
  await page.screenshot({ path: `${SHOTS}/02-selected.png` });
  // an illegal destination deselects and changes nothing
  await clickSquare(page, 'g4');
  expect(await bc(page, 'selected')).toBeNull();
  expect(await bc(page, 'history')).toEqual([]);
  // a legal move by two clicks; the knight leaps
  await clickSquare(page, 'g1');
  await startSampling(page);
  await clickSquare(page, 'f3');
  await page.waitForFunction(() => window.__battleChess.history().length >= 2, null, { timeout: 30_000 });
  await idle(page);
  const seen = await stopSampling(page);
  expect(seen.wN).toEqual(expect.arrayContaining(['Jump 2', 'High Jump Land']));
  const history = await bc(page, 'history');
  expect(history[0]).toBe('Nf3');
  expect(await bc(page, 'turn')).toBe('w');
  expect((await bc(page, 'unitAt', 'f3')).code).toBe('wN');
  expect(problems).toEqual([]);
});

const BATTLES = [
  { piece: 'Pawn', fen: '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', from: 'e4', to: 'd5', code: 'wP', victim: 'bP', attack: 'Swing Mid', death: 'Dead' },
  { piece: 'Knight', fen: '4k3/8/8/3p4/8/4N3/8/4K3 w - - 0 1', from: 'e3', to: 'd5', code: 'wN', victim: 'bP', attack: 'Poke Mid', death: 'Bounced to Death' },
  { piece: 'Bishop', fen: '4k3/8/8/8/8/2n5/8/B3K3 w - - 0 1', from: 'a1', to: 'c3', code: 'wB', victim: 'bN', attack: 'Read Book', death: 'Dead' },
  { piece: 'Rook', fen: '4k3/8/8/8/r7/8/8/R3K3 w - - 0 1', from: 'a1', to: 'a4', code: 'wR', victim: 'bR', attack: 'Gun Mid', death: 'Bounced to Death' },
  { piece: 'Queen', fen: '4k3/8/8/8/3b4/8/8/Q3K3 w - - 0 1', from: 'a1', to: 'd4', code: 'wQ', victim: 'bB', attack: 'Cast Execute', death: 'Bounced to Death' },
  { piece: 'King', fen: '4k3/8/8/8/8/8/4q3/4K3 w - - 0 1', from: 'e1', to: 'e2', code: 'wK', victim: 'bQ', attack: 'Swing High', death: 'Bounced to Death' },
  { piece: 'Black pawn', fen: '4k3/8/8/3p4/4P3/8/8/4K3 b - - 0 1', from: 'd5', to: 'e4', code: 'bP', victim: 'wP', attack: 'Swing Mid', death: 'Dead' },
];

for (const b of BATTLES) {
  test(`${b.piece} capture plays a full battle`, async ({ page }) => {
    const problems = await setup(page, b.fen);
    await clickSquare(page, b.from);
    expect(await bc(page, 'selected')).toBe(b.from);
    expect(await bc(page, 'highlights', b.to)).toContain('capture');
    await startSampling(page);
    const started = Date.now();
    await clickSquare(page, b.to);
    await page.waitForFunction(() => window.__battleChess.busy(), null, { timeout: 5000 });
    // grab a frame in the middle of the fight
    await page.waitForFunction((code) => (window.__seen[code] ?? new Set()).has('Taking Damage'), b.victim, { timeout: 15_000 });
    await page.screenshot({ path: `${SHOTS}/battle-${b.piece.replace(' ', '-').toLowerCase()}.png` });
    await idle(page);
    const seen = await stopSampling(page);
    const seconds = (Date.now() - started) / 1000;
    expect(seen[b.code]).toContain(b.attack);
    expect(seen[b.victim]).toEqual(expect.arrayContaining(['Taking Damage', b.death]));
    const unit = await bc(page, 'unitAt', b.to);
    expect(unit.code).toBe(b.code);
    expect(unit.fade).toBe(1);
    expect((await bc(page, 'units')).filter((u) => u.code === b.victim)).toHaveLength(0);
    expect(await bc(page, 'history')).toHaveLength(1);
    const battle = (await page.evaluate(() => window.__battleChess.battles))[0];
    expect(battle.done).toBe(true);
    expect(seconds).toBeLessThan(15);
    expect(problems).toEqual([]);
    expect(await page.evaluate(() => window.__battleChess.errors)).toEqual([]);
  });
}

test('castling moves the king and the rook leaps over', async ({ page }) => {
  const problems = await setup(page, 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  await clickSquare(page, 'e1');
  expect(await bc(page, 'highlights', 'g1')).toContain('move');
  await startSampling(page);
  await clickSquare(page, 'g1');
  await page.waitForTimeout(200);
  await idle(page);
  const seen = await stopSampling(page);
  expect((await bc(page, 'unitAt', 'g1')).code).toBe('wK');
  expect((await bc(page, 'unitAt', 'f1')).code).toBe('wR');
  expect(await bc(page, 'unitAt', 'h1')).toBeNull();
  expect(seen.wR).toContain('Jump 2');
  expect(await bc(page, 'history')).toEqual(['O-O']);
  expect(problems).toEqual([]);
});

test('en passant removes the passed pawn', async ({ page }) => {
  const problems = await setup(page, '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
  await clickSquare(page, 'e5');
  await clickSquare(page, 'd6');
  await page.waitForTimeout(200);
  await idle(page);
  expect((await bc(page, 'unitAt', 'd6')).code).toBe('wP');
  expect(await bc(page, 'unitAt', 'd5')).toBeNull();
  expect(await bc(page, 'history')).toEqual(['exd6']);
  expect(problems).toEqual([]);
});

test('promotion asks for a piece and transforms the unit', async ({ page }) => {
  const problems = await setup(page, '8/P6k/8/8/8/8/8/K7 w - - 0 1');
  await clickSquare(page, 'a7');
  await clickSquare(page, 'a8');
  await expect(page.locator('#promotion')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/promotion-modal.png` });
  await page.locator('#promo-choices button[data-piece="N"]').click();
  await expect(page.locator('#promotion')).toBeHidden();
  await page.waitForTimeout(200);
  await idle(page);
  expect((await bc(page, 'unitAt', 'a8')).code).toBe('wN');
  expect(await bc(page, 'history')).toEqual(['a8=N']);
  expect(problems).toEqual([]);
});

test("fool's mate by clicks ends the game with a checkmate dialog", async ({ page }) => {
  const problems = await setup(page, null, { mode: 'pvp', speed: 2 });
  await page.waitForTimeout(1500);
  for (const [from, to] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) {
    await clickSquare(page, from);
    await clickSquare(page, to);
    await page.waitForTimeout(150);
    await idle(page);
  }
  await expect(page.locator('#game-over')).toBeVisible();
  await expect(page.locator('#game-over-title')).toHaveText('Checkmate!');
  await expect(page.locator('#game-over-text')).toContainText('Black wins');
  await expect(page.locator('#turn-text')).toContainText('Checkmate');
  expect(await bc(page, 'history')).toEqual(['f3', 'e5', 'g4', 'Qh4#']);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/checkmate.png` });
  await page.locator('#game-over-close').click();
  const dancers = (await bc(page, 'units')).filter((u) => u.code[0] === 'b' && u.animation === 'Dancing');
  expect(dancers.length).toBe(16);
  await page.locator('#new-game').click();
  await page.waitForTimeout(500);
  expect(await bc(page, 'history')).toEqual([]);
  expect(await bc(page, 'units')).toHaveLength(32);
  expect(problems).toEqual([]);
});

test('check is announced and the king square marked', async ({ page }) => {
  const problems = await setup(page, '4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
  await clickSquare(page, 'a1');
  await clickSquare(page, 'a8');
  await page.waitForTimeout(200);
  await idle(page);
  await expect(page.locator('#banner')).toHaveText('CHECK!');
  expect(await bc(page, 'highlights', 'e8')).toContain('check');
  await expect(page.locator('#turn')).toHaveClass(/check/);
  expect(problems).toEqual([]);
});

test('undo against the computer takes back both moves', async ({ page }) => {
  const problems = await setup(page, null, { mode: 'ai-w', speed: 2 });
  await page.waitForTimeout(1500);
  await clickSquare(page, 'e2');
  await clickSquare(page, 'e4');
  await page.waitForFunction(() => window.__battleChess.history().length === 2, null, { timeout: 30_000 });
  await idle(page);
  await page.locator('#undo').click();
  await page.waitForTimeout(300);
  expect(await bc(page, 'history')).toEqual([]);
  expect(await bc(page, 'fen')).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  expect(await bc(page, 'units')).toHaveLength(32);
  expect(problems).toEqual([]);
});

test('playing as Black: the computer opens and the camera turns', async ({ page }) => {
  const problems = await setup(page, null, { mode: 'ai-b', speed: 2 });
  await page.waitForFunction(() => window.__battleChess.history().length === 1, null, { timeout: 30_000 });
  await idle(page);
  expect(await bc(page, 'turn')).toBe('b');
  await page.screenshot({ path: `${SHOTS}/as-black.png` });
  expect(problems).toEqual([]);
});

test('computer vs computer plays legal moves with battles off', async ({ page }) => {
  const problems = await setup(page, null, { mode: 'cvc', speed: 0 });
  await page.selectOption('#level', 'easy');
  await page.waitForFunction(() => window.__battleChess.history().length >= 16, null, { timeout: 90_000 });
  const fen = await bc(page, 'fen');
  expect(fen.split(' ')[0].length).toBeGreaterThan(10);
  expect(problems).toEqual([]);
  expect(await page.evaluate(() => window.__battleChess.errors)).toEqual([]);
});

test('camera controls, zoom and toggles work without errors', async ({ page }) => {
  const problems = await setup(page, null, { mode: 'pvp' });
  await page.waitForTimeout(1200);
  const before = await bc(page, 'squareToClient', 'a1');
  await page.keyboard.press('e');
  await page.waitForTimeout(1200);
  const after = await bc(page, 'squareToClient', 'a1');
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(40);
  await page.locator('#flip').click();
  await page.waitForTimeout(1200);
  await page.mouse.move(500, 400);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(600);
  await page.locator('#icons').uncheck();
  await page.locator('#sound').uncheck();
  await page.locator('#battle-cam').uncheck();
  await page.screenshot({ path: `${SHOTS}/rotated.png` });
  // the board still answers clicks after all that
  await clickSquare(page, 'b8');
  expect(await bc(page, 'selected')).toBeNull(); // white to move: a black unit is not selectable
  await clickSquare(page, 'b1');
  expect(await bc(page, 'selected')).toBe('b1');
  expect(problems).toEqual([]);
});

test('new game during a battle cleanly resets', async ({ page }) => {
  const problems = await setup(page, '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1');
  await clickSquare(page, 'e4');
  await clickSquare(page, 'd5');
  await page.waitForTimeout(600);
  expect(await bc(page, 'busy')).toBe(true);
  await page.locator('#new-game').click();
  await page.waitForTimeout(2500);
  expect(await bc(page, 'busy')).toBe(false);
  expect(await bc(page, 'units')).toHaveLength(32);
  expect(await bc(page, 'history')).toEqual([]);
  await clickSquare(page, 'e2');
  await clickSquare(page, 'e4');
  await page.waitForTimeout(200);
  await idle(page);
  expect(await bc(page, 'history')).toEqual(['e4']);
  expect(problems).toEqual([]);
  expect(await page.evaluate(() => window.__battleChess.errors)).toEqual([]);
});

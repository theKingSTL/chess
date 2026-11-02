import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkSheet, decodePng } from '../src/tactics-sprite/check-sheet.mjs';
import { PIECES, SOURCE, TEAMS, buildMap } from '../tools/make-sprites.mjs';

const data = JSON.parse(fs.readFileSync('src/tactics-sprite/tactics-sprite-data.json', 'utf8'));
const base = decodePng(fs.readFileSync('src/tactics-sprite/a1.png'));
const codes = Object.keys(TEAMS).flatMap((t) => Object.keys(PIECES).map((p) => t + p));

describe('unit sheets (public/sprites, from tools/make-sprites.mjs)', () => {
  it('the recolor map covers all 15 colors of a1.png', () => {
    const seen = new Set();
    for (let y = 0; y < base.height; y++)
      for (let x = 0; x < base.width; x++) {
        const [r, g, b, a] = base.at(x, y);
        if (a) seen.add(`${r},${g},${b}`);
      }
    const mapped = new Set(Object.values(SOURCE).flat().map((c) => c.join(',')));
    expect([...seen].filter((c) => !mapped.has(c))).toEqual([]);
    expect(buildMap('w', 'K').size).toBe(15);
  });

  for (const code of codes) {
    it(`${code} passes the kit's sheet check and keeps a1.png's pixels in place`, () => {
      const bytes = fs.readFileSync(`public/sprites/${code}.png`);
      const report = checkSheet(bytes, data.cells);
      expect(report.errors).toEqual([]);
      expect(report.ok).toBe(true);
      const sheet = decodePng(bytes);
      let moved = 0;
      for (let y = 0; y < base.height; y += 1)
        for (let x = 0; x < base.width; x += 1) if ((sheet.at(x, y)[3] > 0) !== (base.at(x, y)[3] > 0)) moved++;
      expect(moved).toBe(0);
    });
  }

  it('teams and pieces are told apart by their colors', () => {
    const at = (code, x, y) => decodePng(fs.readFileSync(`public/sprites/${code}.png`)).at(x, y).slice(0, 3).join(',');
    // find a hair pixel and a dress pixel in a1.png
    let hair;
    let dress;
    for (let y = 0; y < 48 && !(hair && dress); y++)
      for (let x = 0; x < 48; x++) {
        const c = base.at(x, y).slice(0, 3).join(',');
        if (!hair && c === SOURCE.hair[3].join(',')) hair = [x, y];
        if (!dress && c === SOURCE.dress[1].join(',')) dress = [x, y];
      }
    expect(at('wK', ...dress)).not.toBe(at('bK', ...dress));
    const hairs = new Set(Object.keys(PIECES).map((p) => at('w' + p, ...hair)));
    expect(hairs.size).toBe(6);
  });
});

#!/usr/bin/env node
// Builds the 12 Battle Chess unit sheets from the kit's a1.png.
//
// a1.png has 15 colors in 6 groups (hair, skin, dress, blouse, outline). Every sheet here keeps the TYPE1
// tile layout and only swaps those ramps, so every frame and sequence in tactics-sprite-data.json plays on it.
// Team = dress + blouse colors. Piece = hair color. Each output is checked with the kit's checkSheet().
//
//   node tools/make-sprites.mjs           writes public/sprites/*.png and public/sprites/preview.png

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSheet, decodePng } from '../src/tactics-sprite/check-sheet.mjs';
import { encodePng, toRgba } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KIT = path.join(ROOT, 'src', 'tactics-sprite');
const OUT = path.join(ROOT, 'public', 'sprites');

// Source ramps in a1.png, dark to light.
export const SOURCE = {
  hair: [[92, 34, 89], [137, 50, 109], [163, 77, 149], [174, 75, 155], [201, 114, 173]],
  skin: [[218, 123, 196], [245, 173, 222]],
  dress: [[38, 61, 51], [44, 91, 70], [35, 114, 83]],
  cloth: [[136, 137, 136], [184, 185, 184], [224, 225, 224]],
  outline: [[40, 22, 38], [37, 32, 40]],
};

const SKIN = [[206, 140, 112], [246, 204, 176]];

export const TEAMS = {
  w: {
    dress: [[30, 48, 108], [48, 84, 166], [84, 132, 216]],
    cloth: [[156, 136, 92], [210, 196, 152], [248, 242, 220]],
    outline: [[26, 24, 44], [30, 30, 50]],
  },
  b: {
    dress: [[66, 12, 22], [114, 22, 36], [168, 40, 52]],
    cloth: [[46, 44, 54], [80, 78, 90], [122, 120, 134]],
    outline: [[18, 10, 14], [22, 18, 22]],
  },
};

export const PIECES = {
  K: [[108, 70, 12], [166, 114, 22], [204, 150, 36], [218, 168, 50], [248, 216, 112]], // gold
  Q: [[92, 70, 124], [136, 112, 176], [172, 152, 210], [184, 166, 220], [226, 214, 248]], // lavender
  B: [[104, 104, 116], [156, 156, 168], [196, 196, 206], [206, 206, 216], [242, 242, 248]], // snow
  N: [[58, 30, 14], [98, 52, 24], [138, 78, 36], [150, 88, 42], [190, 124, 66]], // chestnut
  R: [[30, 36, 48], [56, 66, 84], [84, 96, 118], [94, 106, 128], [140, 152, 174]], // steel
  P: [[78, 22, 14], [128, 42, 22], [170, 68, 34], [184, 80, 40], [224, 124, 76]], // copper
};

const key = ([r, g, b]) => (r << 16) | (g << 8) | b;

export function buildMap(team, piece) {
  const map = new Map();
  const ramps = { hair: PIECES[piece], skin: SKIN, ...TEAMS[team] };
  for (const [role, colors] of Object.entries(SOURCE)) colors.forEach((c, i) => map.set(key(c), ramps[role][i]));
  return map;
}

export function recolor(rgba, map) {
  const out = new Uint8Array(rgba);
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) {
      out[i] = out[i + 1] = out[i + 2] = 0;
      continue;
    }
    const to = map.get(key([out[i], out[i + 1], out[i + 2]]));
    if (!to) throw new Error(`unmapped color ${out[i]},${out[i + 1]},${out[i + 2]}`);
    out.set(to, i);
    out[i + 3] = 255;
  }
  return out;
}

function main() {
  const data = JSON.parse(fs.readFileSync(path.join(KIT, 'tactics-sprite-data.json'), 'utf8'));
  const image = decodePng(fs.readFileSync(path.join(KIT, 'a1.png')));
  const source = toRgba(image);
  fs.mkdirSync(OUT, { recursive: true });

  // Preview: the SE idle frame region (top-left 48x48 of the sheet) of every unit at 4x.
  const CROP = 48;
  const ZOOM = 4;
  const names = [];
  const previews = [];
  for (const team of Object.keys(TEAMS)) {
    for (const piece of Object.keys(PIECES)) {
      const sheet = recolor(source, buildMap(team, piece));
      const bytes = encodePng(image.width, image.height, sheet);
      const report = checkSheet(bytes, data.cells);
      if (!report.ok) throw new Error(`${team}${piece}: ${report.errors.map((e) => e.message).join('; ')}`);
      fs.writeFileSync(path.join(OUT, `${team}${piece}.png`), bytes);
      names.push(`${team}${piece}`);
      previews.push(sheet);
    }
  }
  const cols = 6;
  const pw = cols * CROP * ZOOM;
  const ph = 2 * CROP * ZOOM;
  const preview = new Uint8Array(pw * ph * 4);
  previews.forEach((sheet, n) => {
    const ox = (n % cols) * CROP * ZOOM;
    const oy = Math.floor(n / cols) * CROP * ZOOM;
    for (let y = 0; y < CROP * ZOOM; y++)
      for (let x = 0; x < CROP * ZOOM; x++) {
        const s = ((Math.floor(y / ZOOM) * image.width + Math.floor(x / ZOOM)) * 4);
        const o = ((oy + y) * pw + ox + x) * 4;
        const a = sheet[s + 3];
        preview.set(a ? [sheet[s], sheet[s + 1], sheet[s + 2], 255] : n < 6 ? [228, 222, 206, 255] : [70, 66, 74, 255], o);
      }
  });
  fs.writeFileSync(path.join(OUT, 'preview.png'), encodePng(pw, ph, preview));
  console.log(`Wrote and checked ${names.length} sheets: ${names.join(' ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

// Chess units: a tactics sprite from the kit, wearing a sheet made for its team and piece
// (tools/make-sprites.mjs), with a little 3D headgear that says what it is, an optional icon, a contact
// shadow and the engine's dither fade for arriving and dying.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FACING_X, FACING_Z, createAtlas } from '../tactics-sprite/tactics-sprite.mjs';
import { createTacticsSprite, prepareSheet } from '../tactics-sprite/tactics-sprite-three.mjs';
import data from '../tactics-sprite/tactics-sprite-data.json';
import { patchSpawnMaterial } from '@engine/meshes/spawn-effect';
import { squarePosition } from './scene.js';

export const atlas = createAtlas(data);
export const GLYPHS = { w: { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' }, b: { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' } };
export const PIECE_NAMES = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight', P: 'Pawn' };
export const HOME_FACING = { w: 3, b: 7 }; // White looks toward +z (Black's side), Black toward -z
const LYING = new Set(['Dead', 'Bounced to Death', 'Sleeping']);

export async function loadAssets(renderer, onProgress = () => {}) {
  const loader = new THREE.TextureLoader();
  const sheets = {};
  const codes = [];
  for (const c of 'wb') for (const p of 'KQRBNP') codes.push(c + p);
  let done = 0;
  await Promise.all(
    codes.map(async (code) => {
      sheets[code] = prepareSheet(await loader.loadAsync(`/sprites/${code}.png`));
      onProgress(++done / (codes.length + 1));
    }),
  );
  const gltf = await new GLTFLoader().loadAsync('/set-items.glb');
  const models = {};
  gltf.scene.traverse((o) => {
    if (o.isMesh) models[o.name] = o.geometry;
  });
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
  pmrem.dispose();
  const metal = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 1, roughness: 0.16, envMap });
  const gold = new THREE.MeshStandardMaterial({ color: 0xf2c14e, metalness: 1, roughness: 0.22, envMap });
  onProgress(1);
  // Every sheet shares a1.png's alpha (tools/make-sprites.mjs swaps colors only), so one mask answers
  // "is this pixel drawn" for all of them. Used to pick a unit only where it is visible.
  const image = sheets.wK.image;
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = image.width;
  maskCanvas.height = image.height;
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  maskCtx.drawImage(image, 0, 0);
  const pixels = maskCtx.getImageData(0, 0, image.width, image.height).data;
  const opaqueAt = (u, v) => {
    const x = Math.min(image.width - 1, Math.max(0, Math.floor(u * image.width)));
    const y = Math.min(image.height - 1, Math.max(0, Math.floor((1 - v) * image.height)));
    return pixels[(y * image.width + x) * 4 + 3] > 0;
  };
  return { sheets, models, metal, gold, envMap, opaqueAt };
}

// ---- headgear ------------------------------------------------------------------------------------
function makeHeadgear(piece, assets) {
  const g = new THREE.Group();
  const lambert = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness: 0.9, roughness: 0.25, envMap: assets.envMap, flatShading: true, ...extra });
  if (piece === 'K') {
    const gold = std(0xf0b93a);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.3, 2.4, 10, 1, true), gold);
    band.material.side = THREE.DoubleSide;
    g.add(band);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.8, 4), gold);
      spike.position.set(Math.cos(a) * 3.3, 2.4, Math.sin(a) * 3.3);
      g.add(spike);
    }
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(1.1), std(0xe2283c, { metalness: 0.2 }));
    gem.position.set(0, 0.2, 3.6);
    g.add(gem);
    const gem2 = gem.clone();
    gem2.position.set(0, 0.2, -3.6);
    g.add(gem2);
  } else if (piece === 'Q') {
    const silver = std(0xd9dcef);
    const band = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.55, 5, 12), silver);
    band.rotation.x = Math.PI / 2;
    g.add(band);
    for (const [a, h] of [[0, 3.2], [Math.PI / 2, 2.2], [-Math.PI / 2, 2.2], [Math.PI, 3.2]]) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.7, h, 4), silver);
      spike.position.set(Math.cos(a) * 3.3, h / 2, Math.sin(a) * 3.3);
      g.add(spike);
    }
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(1.2), std(0x4fb6ff, { metalness: 0.2 }));
    gem.position.set(0, 3.6, 0);
    g.add(gem);
  } else if (piece === 'B') {
    const mitre = new THREE.Mesh(new THREE.ConeGeometry(3.2, 8, 4), lambert(0xf4efe2));
    mitre.scale.set(1, 1, 0.65);
    mitre.rotation.y = Math.PI / 4;
    mitre.position.y = 3.4;
    g.add(mitre);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.9, 7, 4.4), std(0xe9b94a));
    stripe.position.y = 2.6;
    g.add(stripe);
  } else if (piece === 'N') {
    const steel = std(0xa7b2c4);
    const helm = new THREE.Mesh(new THREE.SphereGeometry(3.9, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), steel);
    helm.material.side = THREE.DoubleSide;
    g.add(helm);
    const plume = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3, 7), lambert(0xd83a3a));
    plume.position.set(0, 4.5, -0.6);
    g.add(plume);
  } else if (piece === 'R') {
    const stone = lambert(0x8d8a96);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.9, 3.2, 8), stone);
    tower.position.y = 1;
    g.add(tower);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const merlon = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.8, 1.9), stone);
      merlon.position.set(Math.cos(a) * 2.9, 3.4, Math.sin(a) * 2.9);
      g.add(merlon);
    }
  } else if (piece === 'P') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(3.5, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), lambert(0x6b7280));
    cap.material.side = THREE.DoubleSide;
    g.add(cap);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.5, 10), lambert(0x585e6b));
    g.add(brim);
  }
  return g;
}

function makeBadge(color, piece) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fillStyle = color === 'w' ? '#f3ecd8' : '#1f1a26';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = color === 'w' ? '#4f7fd6' : '#b8303f';
  ctx.stroke();
  ctx.font = '40px "Segoe UI Symbol", "DejaVu Sans", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color === 'w' ? '#1f1a26' : '#f3ecd8';
  ctx.fillText(GLYPHS.b[piece], 32, 35);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true }));
  sprite.scale.set(9, 9, 1);
  sprite.renderOrder = 2e6;
  return sprite;
}

export function facingToward(dx, dz) {
  let best = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < 8; i++) {
    const d = FACING_X[i] * dx + FACING_Z[i] * dz;
    if (d > bestDot + 1e-6) {
      bestDot = d;
      best = i;
    }
  }
  return best;
}

let nextId = 1;

export function createUnit(world, code, square, now) {
  const { scene, assets } = world;
  const color = code[0];
  const sprite = createTacticsSprite(atlas, assets.sheets[code], { facing: HOME_FACING[color], animation: 'Idle', seconds: now });
  // Own materials, so this unit can dither in and out on its own.
  const body = sprite.group.children[0].material.clone();
  const overlay = sprite.group.children[1].material.clone();
  sprite.group.children.forEach((plane, i) => (plane.material = i === 0 ? body : overlay));
  const fadeRefs = [patchSpawnMaterial(body), patchSpawnMaterial(overlay)];
  scene.add(sprite.group);

  const shadow = new THREE.Mesh(world.shadowGeo, world.shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = -10;
  scene.add(shadow);

  const unit = {
    id: nextId++,
    code,
    color,
    piece: code[1],
    square,
    sprite,
    group: sprite.group,
    shadow,
    headgear: null,
    badge: null,
    alive: true,
    fade: 1,
    lift: 0, // height above the board, for jumps
    _headTile: { u: 0, v: -14 },
    setFade(progress) {
      unit.fade = progress;
      for (const ref of fadeRefs) ref.value = progress;
      unit.shadow.material = progress < 1 ? world.shadowFadeMat(progress) : world.shadowMat;
      if (unit.badge) unit.badge.material.opacity = progress;
      if (unit.headgear) unit.headgear.visible = progress > 0.5;
    },
    setPiece(newCode) {
      unit.code = newCode;
      unit.piece = newCode[1];
      body.map = overlay.map = assets.sheets[newCode];
      body.needsUpdate = overlay.needsUpdate = true;
      unit.dressUp();
    },
    dressUp() {
      if (unit.headgear) scene.remove(unit.headgear);
      if (unit.badge) {
        scene.remove(unit.badge);
        unit.badge.material.map.dispose();
      }
      unit.headgear = makeHeadgear(unit.piece, assets);
      unit.badge = makeBadge(unit.color, unit.piece);
      unit.badge.visible = world.showIcons;
      scene.add(unit.headgear, unit.badge);
    },
    place(x, z, lift = 0) {
      unit.lift = lift;
      sprite.group.position.set(x, lift + sprite.standHeight, z);
    },
    placeOn(sq) {
      const p = squarePosition(sq);
      unit.place(p.x, p.z, 0);
    },
    face(dx, dz) {
      if (Math.abs(dx) + Math.abs(dz) < 1e-6) return;
      sprite.player.facing = facingToward(dx, dz);
    },
    faceHome() {
      sprite.player.facing = HOME_FACING[unit.color];
    },
    play(name, options) {
      sprite.play(name, world.clock.now, options);
    },
    position() {
      return new THREE.Vector3(sprite.group.position.x, unit.lift, sprite.group.position.z);
    },
    update(now, camera) {
      const pose = sprite.update(now, camera);
      // Head top: the highest tile of this frame (the body tile on idle frames, the head tile on others).
      let top = null;
      for (let i = 0; i < pose.count; i++) if (!top || pose.tiles[i].y < top.y) top = pose.tiles[i];
      if (top) {
        unit._headTile.u = top.x + top.w / 2;
        unit._headTile.v = top.y + 4;
      }
      if (unit.headgear) {
        sprite.pointAt(unit._headTile.u, unit._headTile.v, 3, unit.headgear.position);
        unit.headgear.visible = unit.alive && unit.fade > 0.5 && !LYING.has(sprite.player.animation.name);
      }
      if (unit.badge) {
        unit.badge.position.copy(sprite.group.position);
        unit.badge.position.y += 30;
        unit.badge.visible = world.showIcons && unit.alive && unit.fade > 0.05;
      }
      const g = sprite.group.position;
      const s = 1 / (1 + unit.lift / 32);
      shadow.position.set(g.x, 0.12, g.z);
      shadow.scale.setScalar(s);
    },
    // The point a projectile or a blow aims at: the middle of the body.
    chest(out = new THREE.Vector3()) {
      return out.set(sprite.group.position.x, sprite.group.position.y + 2, sprite.group.position.z);
    },
    head(out = new THREE.Vector3()) {
      return sprite.pointAt(unit._headTile.u, unit._headTile.v, 0, out);
    },
    // Above the icon: where a damage number floats.
    overhead(out = new THREE.Vector3()) {
      return out.set(sprite.group.position.x, sprite.group.position.y + 40, sprite.group.position.z);
    },
    dispose() {
      unit.alive = false;
      sprite.dispose();
      scene.remove(shadow);
      if (unit.headgear) scene.remove(unit.headgear);
      if (unit.badge) scene.remove(unit.badge);
      body.dispose();
      overlay.dispose();
    },
  };
  unit.dressUp();
  unit.placeOn(square);
  unit.setFade(1);
  return unit;
}

// Shared per-world resources for units.
export function createUnitWorld(scene, assets, clock) {
  const shadowGeo = new THREE.CircleGeometry(9, 20);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
  const fadeMats = new Map();
  return {
    scene,
    assets,
    clock,
    showIcons: true,
    shadowGeo,
    shadowMat,
    shadowFadeMat(progress) {
      const key = Math.round(progress * 10);
      if (!fadeMats.has(key)) fadeMats.set(key, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 * (key / 10), depthWrite: false }));
      return fadeMats.get(key);
    },
  };
}

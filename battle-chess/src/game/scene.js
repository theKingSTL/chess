// The board scene: renderer, the tactical RPG camera, the board, square highlights and picking.
//
// World layout: one square is a 32-unit cube (the kit's `cubeSize`), the board top is y = 0.
// File a..h runs +x..-x and rank 1..8 runs -z..+z, so the camera at step 1 (looking +z) sees White's side
// in front with the a-file on the left, and step 5 sees Black's side.
import * as THREE from 'three';
import { lerp } from './clock.js';

export const TILE = 32;
export const squareX = (sq) => (3.5 - (sq & 7)) * TILE;
export const squareZ = (sq) => ((sq >> 3) - 3.5) * TILE;
export const squarePosition = (sq, y = 0, out = new THREE.Vector3()) => out.set(squareX(sq), y, squareZ(sq));

const BASE_AZIMUTH = Math.atan2(0.5, -0.5);
export const stepAzimuth = (step) => BASE_AZIMUTH + (step * Math.PI) / 4;
const DEFAULT_ELEVATION = 0.62; // ~35 degrees: steeper than the sprites' 23 so the far ranks stay readable

function pixelTexture(size, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  paint(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

// Deterministic noise so every reload draws the same stone.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function stoneTexture(base, seed) {
  return pixelTexture(16, (ctx, size) => {
    const rand = rng(seed);
    const [r, g, b] = base;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const n = (rand() - 0.5) * 18;
        ctx.fillStyle = `rgb(${r + n},${g + n},${b + n})`;
        ctx.fillRect(x, y, 1, 1);
      }
    // bevel: light top-left edge, dark bottom-right edge
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(0, 0, size, 1);
    ctx.fillRect(0, 0, 1, size);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, size - 1, size, 1);
    ctx.fillRect(size - 1, 0, 1, size);
  });
}

function labelTexture(text) {
  return pixelTexture(32, (ctx, size) => {
    ctx.clearRect(0, 0, size, size);
    ctx.font = 'bold 22px Nix8810, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText(text, size / 2 + 1, size / 2 + 2);
    ctx.fillStyle = '#e8d9a8';
    ctx.fillText(text, size / 2, size / 2 + 1);
  });
}

const MARK_STYLE = {
  selected: { color: 0xffd34d, opacity: 0.55 },
  move: { color: 0x58c7ff, opacity: 0.38 },
  capture: { color: 0xff3b47, opacity: 0.55 },
  last: { color: 0xf2e27a, opacity: 0.28 },
  check: { color: 0xff1a2a, opacity: 0.6 },
  hover: { color: 0xffffff, opacity: 0.18 },
};

export function createBoardScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x2a2238, 1.6));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
  sun.position.set(-120, 260, -180);
  scene.add(sun);

  // ---- board -----------------------------------------------------------------------------------
  const board = new THREE.Group();
  scene.add(board);
  const lightTex = stoneTexture([214, 200, 168], 7);
  const darkTex = stoneTexture([98, 82, 112], 11);
  const squareGeo = new THREE.BoxGeometry(TILE, 10, TILE);
  const lightMat = [new THREE.MeshLambertMaterial({ color: 0xb9a98a }), new THREE.MeshLambertMaterial({ map: lightTex })];
  const darkMat = [new THREE.MeshLambertMaterial({ color: 0x4a3d58 }), new THREE.MeshLambertMaterial({ map: darkTex })];
  for (let sq = 0; sq < 64; sq++) {
    const light = ((sq & 7) + (sq >> 3)) % 2 === 1;
    const mats = light ? lightMat : darkMat;
    // Box faces: +x, -x, +y (top), -y, +z, -z
    const mesh = new THREE.Mesh(squareGeo, [mats[0], mats[0], mats[1], mats[0], mats[0], mats[0]]);
    mesh.position.set(squareX(sq), -5, squareZ(sq));
    board.add(mesh);
  }
  const frameTex = stoneTexture([70, 52, 40], 21);
  frameTex.wrapS = frameTex.wrapT = THREE.RepeatWrapping;
  frameTex.repeat.set(18, 18);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(TILE * 9, 12, TILE * 9), new THREE.MeshLambertMaterial({ map: frameTex }));
  frame.position.y = -6.6;
  board.add(frame);
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(TILE * 9.6, 40, TILE * 9.6), new THREE.MeshLambertMaterial({ color: 0x2b2436 }));
  plinth.position.y = -32.6;
  board.add(plinth);

  const labels = [];
  const labelGeo = new THREE.PlaneGeometry(13, 13);
  const addLabel = (text, x, z) => {
    const mesh = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({ map: labelTexture(text), transparent: true, alphaTest: 0.2, depthWrite: false }));
    mesh.rotation.order = 'YXZ';
    mesh.position.set(x, -0.5, z);
    board.add(mesh);
    labels.push(mesh);
  };
  for (let f = 0; f < 8; f++) {
    addLabel('abcdefgh'[f], squareX(f), -TILE * 4.25);
    addLabel('abcdefgh'[f], squareX(f), TILE * 4.25);
  }
  for (let r = 0; r < 8; r++) {
    addLabel(String(r + 1), TILE * 4.25, squareZ(r * 8));
    addLabel(String(r + 1), -TILE * 4.25, squareZ(r * 8));
  }

  // ---- highlights ------------------------------------------------------------------------------
  const markGeo = new THREE.PlaneGeometry(TILE - 2, TILE - 2);
  const dotGeo = new THREE.CircleGeometry(5, 4);
  const pinGeo = new THREE.OctahedronGeometry(2.6);
  pinGeo.scale(1, 1.6, 1);
  const pinMat = (color) => new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95, toneMapped: false });
  const PIN_MATS = { move: pinMat(0x58c7ff), capture: pinMat(0xff3b47), selected: pinMat(0xffd34d) };
  const marks = [];
  for (let sq = 0; sq < 64; sq++) {
    const fill = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }));
    fill.rotation.x = -Math.PI / 2;
    fill.position.set(squareX(sq), 0.15, squareZ(sq));
    fill.renderOrder = -20;
    fill.visible = false;
    const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: 0x58c7ff, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
    dot.rotation.x = -Math.PI / 2;
    dot.position.set(squareX(sq), 0.25, squareZ(sq));
    dot.renderOrder = -19;
    dot.visible = false;
    scene.add(fill, dot);
    const pin = new THREE.Mesh(pinGeo, PIN_MATS.move);
    pin.position.set(squareX(sq), 6, squareZ(sq));
    pin.renderOrder = 3e6;
    pin.visible = false;
    pin.userData.height = 6;
    scene.add(pin);
    marks.push({ fill, dot, pin, kinds: new Set() });
  }
  // A quiet legal move is a dot; every other kind tints the square, the most urgent kind winning.
  const PRIORITY = ['check', 'capture', 'selected', 'last', 'hover'];
  function refreshMark(sq) {
    const m = marks[sq];
    const kind = PRIORITY.find((k) => m.kinds.has(k));
    m.fill.visible = Boolean(kind);
    if (kind) {
      m.fill.material.color.setHex(MARK_STYLE[kind].color);
      m.fill.material.opacity = MARK_STYLE[kind].opacity;
    }
    m.dot.visible = m.kinds.has('move') && !m.kinds.has('capture');
    // Floating cursors, drawn over everything: a tall sprite can hide the floor of the square behind it.
    m.pin.visible = m.kinds.has('move') || m.kinds.has('selected');
    if (m.pin.visible) {
      const kind = m.kinds.has('selected') ? 'selected' : m.kinds.has('capture') ? 'capture' : 'move';
      m.pin.material = PIN_MATS[kind];
      m.pin.userData.height = kind === 'move' ? 6 : 52;
      m.pin.scale.setScalar(kind === 'move' ? 1 : 1.4);
    }
  }
  const highlights = {
    set(kind, squares) {
      for (let sq = 0; sq < 64; sq++) {
        const had = marks[sq].kinds.has(kind);
        const has = squares.includes(sq);
        if (had !== has) {
          if (has) marks[sq].kinds.add(kind);
          else marks[sq].kinds.delete(kind);
          refreshMark(sq);
        }
      }
    },
    clear(kind) {
      highlights.set(kind, []);
    },
    kindsAt: (sq) => [...marks[sq].kinds],
    drawnAt: (sq) => ({ fill: marks[sq].fill.visible, dot: marks[sq].dot.visible, color: marks[sq].fill.material.color.getHexString(), opacity: marks[sq].fill.material.opacity }),
  };

  // ---- camera ----------------------------------------------------------------------------------
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  const view = {
    azimuth: stepAzimuth(0),
    targetAzimuth: stepAzimuth(0),
    elevation: DEFAULT_ELEVATION,
    zoom: 1,
    userZoom: 1,
    battleZoom: 1,
    focus: new THREE.Vector3(0, 0, 0),
    targetFocus: new THREE.Vector3(0, 0, 0),
  };
  let width = 1;
  let height = 1;

  function fitHalfHeight() {
    const aspect = width / height;
    const halfH = (TILE * 9 * Math.SQRT2 * Math.sin(view.elevation) + 70) / 2;
    const halfW = (TILE * 9 * 1.12) / 2;
    return Math.max(halfH, halfW / aspect);
  }

  function updateCamera(dt) {
    const k = 1 - Math.exp(-dt * 6);
    view.azimuth = lerp(view.azimuth, view.targetAzimuth, k);
    view.focus.lerp(view.targetFocus, k);
    view.zoom = lerp(view.zoom, view.userZoom * view.battleZoom, k);
    const half = fitHalfHeight() / view.zoom;
    const aspect = width / height;
    camera.top = half;
    camera.bottom = -half;
    camera.left = -half * aspect;
    camera.right = half * aspect;
    camera.updateProjectionMatrix();
    const distance = 1200;
    const flat = Math.cos(view.elevation) * distance;
    camera.position.set(view.focus.x + Math.sin(view.azimuth) * flat, view.focus.y + Math.sin(view.elevation) * distance, view.focus.z + Math.cos(view.azimuth) * flat);
    camera.lookAt(view.focus);
    camera.updateMatrixWorld();
    // Board labels lie flat, turned so they read upright from the camera.
    for (const label of labels) {
      label.rotation.y = view.azimuth;
      label.rotation.x = -Math.PI / 2;
    }
    // Cursors bob and spin.
    const t = performance.now() / 1000;
    for (const m of marks) {
      if (!m.pin.visible) continue;
      m.pin.position.y = m.pin.userData.height + Math.sin(t * 4) * 1.5;
      m.pin.rotation.y = t * 2;
    }
  }

  function resize() {
    width = canvas.clientWidth || 1;
    height = canvas.clientHeight || 1;
    renderer.setSize(width, height, false);
  }
  resize();
  window.addEventListener('resize', resize);

  // ---- picking ---------------------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  function rayFrom(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster;
  }
  function squareAtWorld(x, z) {
    const f = Math.round(3.5 - x / TILE);
    const r = Math.round(z / TILE + 3.5);
    return f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : -1;
  }
  // `units` is a list of { group, square, opaqueAt }. Returns the square of the unit drawn under the cursor
  // (`sprite`, or -1) and the board square under it (`ground`, or -1).
  function pickAll(clientX, clientY, units = []) {
    const ray = rayFrom(clientX, clientY);
    const meshes = [];
    for (const unit of units) unit.group.traverse((o) => o.isMesh && o.visible && meshes.push(o));
    let sprite = -1;
    for (const h of ray.intersectObjects(meshes, false)) {
      const owner = units.find((u) => h.object.parent === u.group);
      // A tile plane is mostly transparent: only a hit on a drawn pixel of the sheet counts.
      if (owner && owner.square >= 0 && (!owner.opaqueAt || (h.uv && owner.opaqueAt(h.uv.x, h.uv.y)))) {
        sprite = owner.square;
        break;
      }
    }
    const ground = ray.ray.intersectPlane(groundPlane, hit) ? squareAtWorld(hit.x, hit.z) : -1;
    return { sprite, ground };
  }
  function pick(clientX, clientY, units = []) {
    const { sprite, ground } = pickAll(clientX, clientY, units);
    return sprite >= 0 ? sprite : ground;
  }
  const projected = new THREE.Vector3();
  function worldToClient(point) {
    const rect = canvas.getBoundingClientRect();
    projected.copy(point).project(camera);
    return { x: rect.left + ((projected.x + 1) / 2) * rect.width, y: rect.top + ((1 - projected.y) / 2) * rect.height };
  }
  function squareToClient(sq, y = 2) {
    return worldToClient(squarePosition(sq, y, new THREE.Vector3()));
  }

  return {
    renderer,
    scene,
    camera,
    view,
    highlights,
    pick,
    pickAll,
    squareToClient,
    worldToClient,
    updateCamera,
    resize,
    rotate(stepDelta) {
      view.targetAzimuth += (stepDelta * Math.PI) / 4;
    },
    setView(step, elevation) {
      view.azimuth = view.targetAzimuth = stepAzimuth(step);
      if (elevation) view.elevation = elevation;
    },
    setSide(color) {
      const want = stepAzimuth(color === 'w' ? 0 : 4);
      // turn the short way from where the camera is now
      const full = Math.PI * 2;
      const delta = ((((want - view.targetAzimuth) % full) + full * 1.5) % full) - full / 2;
      view.targetAzimuth += delta;
    },
    zoomBy(factor) {
      view.userZoom = Math.min(2.6, Math.max(0.6, view.userZoom * factor));
    },
    focusOn(point, zoom) {
      view.targetFocus.copy(point);
      view.battleZoom = zoom;
    },
    resetFocus() {
      view.targetFocus.set(0, 0, 0);
      view.battleZoom = 1;
    },
  };
}

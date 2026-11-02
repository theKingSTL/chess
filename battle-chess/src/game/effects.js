// Battle effects. Each effect is { update(now) -> boolean alive } in a list the frame loop drives on the
// game clock, so fast battles speed effects up together with the sprites.
//
// Damage digits are the engine's 5x7 bitmaps (three-isometric-engine/debug/damage-counter.js, MIT) and hop
// on its timing: 6px over 12 ticks, then 2px over 8, 48 ticks in all (digits 2 ticks apart here, 4 in the engine).
import * as THREE from 'three';
import { SCALE_X, SCALE_Y } from '../tactics-sprite/tactics-sprite-three.mjs';

const DIGIT_GLYPHS = [
  [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  [0x0e, 0x11, 0x01, 0x06, 0x01, 0x11, 0x0e],
  [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
];
const CELL_W = 7;
const CELL_H = 9;
const HOPS = [
  { ticks: 12, px: 6 },
  { ticks: 8, px: 2 },
];
const COUNTER_TICKS = 48;
function counterHop(ticks, digit) {
  // The engine staggers digits 4 ticks apart; 2 keeps a three-digit number reading as one number.
  let t = ticks - digit * 2;
  if (t < 0) return -1;
  for (const hop of HOPS) {
    if (t < hop.ticks) {
      const s = t / hop.ticks;
      return Math.floor(4 * hop.px * s * (1 - s));
    }
    t -= hop.ticks;
  }
  return 0;
}

function digitTextures() {
  const textures = [];
  for (let digit = 0; digit < 10; digit++) {
    const data = new Uint8Array(CELL_W * CELL_H * 4);
    const on = (x, y) => x >= 0 && x < 5 && y >= 0 && y < 7 && ((DIGIT_GLYPHS[digit][y] >> (4 - x)) & 1) === 1;
    for (let y = 0; y < CELL_H; y++)
      for (let x = 0; x < CELL_W; x++) {
        let edge = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) edge ||= on(x - 1 + dx, y - 1 + dy);
        const o = ((CELL_H - 1 - y) * CELL_W + x) * 4;
        const fill = on(x - 1, y - 1);
        data[o] = fill ? 255 : 0;
        data[o + 1] = fill ? 255 : 0;
        data[o + 2] = fill ? 255 : 0;
        data[o + 3] = edge ? 255 : 0;
      }
    const texture = new THREE.DataTexture(data, CELL_W, CELL_H, THREE.RGBAFormat);
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    textures.push(texture);
  }
  return textures;
}

export function createEffects(scene, clock) {
  const live = [];
  const digits = digitTextures();
  const add = (effect) => {
    live.push(effect);
    return effect;
  };
  const additive = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const sphereGeo = new THREE.SphereGeometry(1, 14, 10);
  const ringGeo = new THREE.RingGeometry(0.8, 1, 32);

  const fx = {
    get count() {
      return live.length;
    },
    update(now, camera) {
      for (let i = live.length - 1; i >= 0; i--) if (!live[i].update(now, camera)) live.splice(i, 1);
    },
    clear() {
      for (const e of live) e.dispose?.();
      live.length = 0;
    },

    // A number hopping over a struck unit. `at` is a function returning the world anchor each frame.
    damage(value, at) {
      const text = String(Math.max(0, Math.round(value)));
      const group = new THREE.Group();
      const sprites = [...text].map((ch, i) => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: digits[Number(ch)], depthTest: false, depthWrite: false, transparent: true, alphaTest: 0.5 }));
        s.scale.set(CELL_W * SCALE_X, CELL_H * SCALE_Y, 1);
        s.renderOrder = 3e6;
        group.add(s);
        return { s, i };
      });
      scene.add(group);
      const start = clock.now;
      const width = text.length * (CELL_W - 1);
      const right = new THREE.Vector3();
      const up = new THREE.Vector3();
      return add({
        update(now, camera) {
          const ticks = (now - start) * 60;
          if (ticks >= COUNTER_TICKS) {
            this.dispose();
            return false;
          }
          group.position.copy(at());
          right.set(1, 0, 0).applyQuaternion(camera.quaternion);
          up.set(0, 1, 0).applyQuaternion(camera.quaternion);
          for (const { s, i } of sprites) {
            const hop = counterHop(ticks, i);
            s.visible = hop >= 0;
            const px = -width / 2 + i * (CELL_W - 1) + CELL_W / 2;
            s.position.copy(right).multiplyScalar(px * SCALE_X).addScaledVector(up, Math.max(0, hop) * SCALE_Y);
          }
          return true;
        },
        dispose() {
          scene.remove(group);
          for (const { s } of sprites) s.material.dispose();
        },
      });
    },

    // A burst of little glowing cubes.
    sparks(origin, { color = 0xffe08a, count = 18, speed = 60, size = 1.4, life = 0.5, up = 30, glow = true } = {}) {
      const mat = glow ? additive(color) : new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
      const bits = [];
      for (let i = 0; i < count; i++) {
        const m = new THREE.Mesh(boxGeo, mat);
        m.scale.setScalar(size * (0.6 + Math.random() * 0.8));
        m.position.copy(origin);
        const a = Math.random() * Math.PI * 2;
        const e = Math.random() * 0.9 + 0.1;
        const v = new THREE.Vector3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)).multiplyScalar(speed * (0.4 + Math.random() * 0.8));
        v.y += up * Math.random();
        bits.push({ m, v });
        scene.add(m);
      }
      const start = clock.now;
      let last = start;
      return add({
        update(now) {
          const t = (now - start) / life;
          const dt = now - last;
          last = now;
          if (t >= 1) {
            this.dispose();
            return false;
          }
          mat.opacity = 1 - t;
          for (const b of bits) {
            b.v.y -= 120 * dt;
            b.m.position.addScaledVector(b.v, dt);
            b.m.rotation.x += dt * 9;
            b.m.rotation.y += dt * 7;
          }
          return true;
        },
        dispose() {
          for (const b of bits) scene.remove(b.m);
          mat.dispose();
        },
      });
    },

    // A glowing orb from `from` to `to()` over `seconds`, along an arc `height` high. Resolves on arrival.
    orb(from, to, { color = 0xffe17a, radius = 3, seconds = 0.55, height = 18 } = {}) {
      const core = new THREE.Mesh(sphereGeo, additive(0xffffff));
      const halo = new THREE.Mesh(sphereGeo, additive(color, 0.55));
      core.scale.setScalar(radius * 0.55);
      halo.scale.setScalar(radius);
      core.renderOrder = halo.renderOrder = 2.5e6;
      scene.add(core, halo);
      const start = clock.now;
      const pos = new THREE.Vector3();
      let lastTrail = 0;
      let arrived = false;
      add({
        update(now) {
          const t = Math.min(1, (now - start) / seconds);
          const end = to();
          pos.lerpVectors(from, end, t);
          pos.y += Math.sin(Math.PI * t) * height;
          core.position.copy(pos);
          halo.position.copy(pos);
          halo.scale.setScalar(radius * (1 + 0.2 * Math.sin(now * 40)));
          if (now - lastTrail > 0.03) {
            lastTrail = now;
            fx.sparks(pos, { color, count: 2, speed: 10, size: 1, life: 0.3, up: 0 });
          }
          if (t >= 1) {
            this.dispose();
            arrived = true;
            return false;
          }
          return true;
        },
        dispose() {
          scene.remove(core, halo);
          core.material.dispose();
          halo.material.dispose();
        },
      });
      return clock.until(() => arrived || clock.now - start > seconds + 0.5);
    },

    // Jagged lightning from the sky onto `target`, with a ground ring.
    lightning(target, { color = 0xb48cff, life = 0.45 } = {}) {
      const group = new THREE.Group();
      const makeBolt = (radius, mat) => {
        const pts = [];
        const top = target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 30, 240, (Math.random() - 0.5) * 30));
        const n = 12;
        for (let i = 0; i <= n; i++) {
          const p = new THREE.Vector3().lerpVectors(top, target, i / n);
          if (i > 0 && i < n) p.add(new THREE.Vector3((Math.random() - 0.5) * 16, 0, (Math.random() - 0.5) * 16));
          pts.push(p);
        }
        return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1), 48, radius, 5, false), mat);
      };
      const outer = additive(color, 0.8);
      const inner = additive(0xffffff);
      group.add(makeBolt(2.6, outer), makeBolt(1, inner));
      const ring = new THREE.Mesh(ringGeo, additive(color, 0.9));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(target.x, 0.4, target.z);
      group.add(ring);
      group.renderOrder = 2.5e6;
      scene.add(group);
      fx.sparks(target, { color, count: 28, speed: 90, size: 1.6, life: 0.6 });
      const start = clock.now;
      return add({
        update(now) {
          const t = (now - start) / life;
          if (t >= 1) {
            this.dispose();
            return false;
          }
          group.children[0].visible = group.children[1].visible = Math.sin(t * 60) > -0.6;
          outer.opacity = 0.8 * (1 - t);
          ring.scale.setScalar(4 + t * 26);
          ring.material.opacity = 0.9 * (1 - t);
          return true;
        },
        dispose() {
          scene.remove(group);
          group.traverse((o) => o.isMesh && (o.geometry !== ringGeo && o.geometry.dispose(), o.material.dispose()));
        },
      });
    },

    // A tracer from the muzzle to the target, two ticks long, plus a flash.
    streak(from, to, { color = 0xffe08a, life = 3 / 60 } = {}) {
      const dir = new THREE.Vector3().subVectors(to, from);
      const length = dir.length();
      const mesh = new THREE.Mesh(boxGeo, additive(color));
      mesh.scale.set(length, 0.7, 0.7);
      mesh.position.copy(from).addScaledVector(dir, 0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize());
      mesh.renderOrder = 2.5e6;
      const flash = new THREE.Mesh(sphereGeo, additive(0xfff2b0));
      flash.scale.setScalar(3.2);
      flash.position.copy(from);
      scene.add(mesh, flash);
      fx.sparks(from, { color: 0xffd36a, count: 8, speed: 40, size: 0.9, life: 0.25, up: 0 });
      const start = clock.now;
      return add({
        update(now) {
          if (now - start > life) {
            this.dispose();
            return false;
          }
          return true;
        },
        dispose() {
          scene.remove(mesh, flash);
          mesh.material.dispose();
          flash.material.dispose();
        },
      });
    },

    // A turning rune circle on the ground under a caster, until `stop()` is called.
    circle(center, { color = 0xffe17a, radius = 14 } = {}) {
      const group = new THREE.Group();
      const ring1 = new THREE.Mesh(ringGeo, additive(color, 0.85));
      const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.62, 6), additive(color, 0.7));
      for (const r of [ring1, ring2]) {
        r.rotation.x = -Math.PI / 2;
        group.add(r);
      }
      group.position.set(center.x, 0.35, center.z);
      group.scale.setScalar(0.01);
      scene.add(group);
      const start = clock.now;
      let stopping = -1;
      let lastSpark = 0;
      const effect = add({
        update(now) {
          const grow = Math.min(1, (now - start) / 0.25);
          const shrink = stopping < 0 ? 1 : 1 - Math.min(1, (now - stopping) / 0.25);
          if (shrink <= 0) {
            this.dispose();
            return false;
          }
          group.scale.setScalar(radius * grow * shrink);
          ring2.rotation.z = now * 2.4;
          ring1.rotation.z = -now * 1.2;
          if (now - lastSpark > 0.05) {
            lastSpark = now;
            const a = Math.random() * Math.PI * 2;
            fx.sparks(new THREE.Vector3(center.x + Math.cos(a) * radius * 0.8, 1, center.z + Math.sin(a) * radius * 0.8), { color, count: 1, speed: 4, size: 1.1, life: 0.5, up: 50 });
          }
          return true;
        },
        dispose() {
          scene.remove(group);
          ring1.material.dispose();
          ring2.material.dispose();
          ring2.geometry.dispose();
        },
      });
      return { stop: () => (stopping = clock.now), effect };
    },

    // A puff of dust where a unit lands.
    dust(at) {
      fx.sparks(new THREE.Vector3(at.x, 1, at.z), { color: 0xb8a68c, count: 10, speed: 22, size: 1.8, life: 0.4, up: 10, glow: false });
    },
  };
  return fx;
}

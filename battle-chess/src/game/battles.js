// Battle choreography. Every move is an async script on the game clock:
//   moving:   pawns, bishops, rooks and kings walk; knights leap; a queen walks short hops and teleports far.
//   fighting: Pawn   walks up and slashes (Swing Mid, sword)
//             Knight leaps in and thrusts (Poke Mid, spear)
//             Bishop reads a holy tome and throws a light orb (Read Book, tome)
//             Rook   fires a rifle from where it stands (Gun Mid, rifle)
//             Queen  casts lightning from the sky (Casting > Casting Loop > Cast Execute)
//             King   strides up and cuts with a katana (Swing High, katana)
// A blow lands on the sequence's own PostGenericAttack event, never a timer of ours, with a timeout only as
// a safety net. The defender flinches (Taking Damage), shows a damage number, falls (Dead or Bounced to
// Death) and dithers out with the engine's spawn effect.
import * as THREE from 'three';
import { atlas } from './units.js';
import { easeInOut, lerp } from './clock.js';
import { squarePosition } from './scene.js';

const TICK = 1 / 60;
const STRIKE_GAP = 24; // the kit's attacker-to-target distance
const WALK_SPEED = 72; // world units per second: one square in ~0.45s, on Walk Fast
export const PIECE_VALUE = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 1000 };
const ticksOf = (name) => atlas.sequences[atlas.animations.get(name.toLowerCase()).front].totalTicks;

export function createBattles(stage) {
  const { clock, fx, audio, assets, scene } = stage;

  const tween = (seconds, fn) => {
    const start = clock.now;
    return clock.until((now) => {
      const t = seconds <= 0 ? 1 : Math.min(1, (now - start) / seconds);
      fn(t);
      return t >= 1;
    });
  };

  function item(unit, model, animation) {
    const mesh = new THREE.Mesh(assets.models[model], assets.metal);
    scene.add(mesh);
    unit.sprite.carry(mesh, animation);
    return () => {
      unit.sprite.release();
      scene.remove(mesh);
    };
  }

  // Resolves on the animation's PostGenericAttack, or after its hit tick plus a margin if a slow frame lost it.
  function untilHit(unit, animation) {
    const hitTick = atlas.animations.get(animation.toLowerCase()).hitTick ?? ticksOf(animation);
    const deadline = clock.now + hitTick * TICK + 0.35;
    return clock.until((now) => unit.sprite.player.events.includes('PostGenericAttack') || now > deadline);
  }

  async function walkTo(unit, x, z) {
    const from = unit.position();
    const dx = x - from.x;
    const dz = z - from.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.5) return;
    unit.face(dx, dz);
    unit.play('Walk Fast');
    let lastStep = -1;
    await tween(distance / WALK_SPEED, (t) => {
      unit.place(lerp(from.x, x, t), lerp(from.z, z, t));
      const step = Math.floor((t * distance) / 16);
      if (step !== lastStep) {
        lastStep = step;
        audio.play('step');
      }
    });
    unit.play('Idle');
  }

  // Jump 2 takes off on the ground for 22 ticks, holds its air pose over the arc, then High Jump Land.
  async function jumpTo(unit, x, z, { height = 40 } = {}) {
    const from = unit.position();
    unit.face(x - from.x, z - from.z);
    unit.play('Jump 2');
    await clock.wait(22 * TICK);
    const distance = Math.hypot(x - from.x, z - from.z);
    const air = Math.max(0.38, distance / 150);
    await tween(air, (t) => unit.place(lerp(from.x, x, t), lerp(from.z, z, t), 4 * (height + distance * 0.12) * t * (1 - t)));
    unit.place(x, z, 0);
    unit.play('High Jump Land', { then: 'Idle' });
    fx.dust(new THREE.Vector3(x, 0, z));
    audio.play('land');
    await clock.wait(14 * TICK);
  }

  async function fadeTo(unit, target, seconds) {
    const start = unit.fade;
    await tween(seconds, (t) => unit.setFade(lerp(start, target, t)));
  }

  async function teleportTo(unit, x, z) {
    const from = unit.position();
    unit.face(x - from.x, z - from.z);
    unit.play('Teleport');
    audio.play('teleport');
    fx.sparks(unit.chest(), { color: 0xc7a6ff, count: 16, speed: 30, up: 40, life: 0.5 });
    await fadeTo(unit, 0, 0.45);
    unit.place(x, z);
    await clock.wait(0.08);
    unit.play('Teleport');
    fx.sparks(unit.chest(), { color: 0xc7a6ff, count: 16, speed: 30, up: 40, life: 0.5 });
    await fadeTo(unit, 1, 0.45);
    unit.play('Idle');
  }

  async function travel(unit, sq, { style } = {}) {
    const p = squarePosition(sq);
    const from = unit.position();
    const tiles = Math.hypot(p.x - from.x, p.z - from.z) / 32;
    const kind = style ?? (unit.piece === 'N' ? 'jump' : unit.piece === 'Q' && tiles > 2.2 ? 'teleport' : 'walk');
    if (stage.speedSetting === 0) {
      await tween(0.22, (t) => unit.place(lerp(from.x, p.x, easeInOut(t)), lerp(from.z, p.z, easeInOut(t))));
    } else if (kind === 'jump') await jumpTo(unit, p.x, p.z);
    else if (kind === 'teleport') await teleportTo(unit, p.x, p.z);
    else await walkTo(unit, p.x, p.z);
    unit.square = sq;
    unit.placeOn(sq);
  }

  async function hurt(defender, attacker, { big = false } = {}) {
    const a = attacker.position();
    const d = defender.position();
    defender.face(a.x - d.x, a.z - d.z);
    defender.play('Taking Damage', { then: 'Idle', duration: 0.5 });
    fx.sparks(defender.chest(), { color: big ? 0xd9c2ff : 0xfff0a0, count: big ? 26 : 18, speed: big ? 80 : 60 });
    fx.damage(PIECE_VALUE[defender.piece], () => defender.overhead());
    audio.play('hit');
    stage.shake?.(big ? 5 : 3);
    await clock.wait(0.5);
  }

  async function die(defender, { bounce = false } = {}) {
    const name = bounce ? 'Bounced to Death' : 'Dead';
    defender.play(name);
    audio.play('death');
    await clock.wait(Math.min(1.1, ticksOf(name) * TICK + 0.25));
    await fadeTo(defender, 0, 0.6);
    defender.alive = false;
    stage.removeUnit(defender);
  }

  // Where a melee attacker stands to strike: STRIKE_GAP short of the defender, on the line between them.
  function strikePoint(attacker, defender) {
    const a = attacker.position();
    const d = defender.position();
    const dir = new THREE.Vector3(a.x - d.x, 0, a.z - d.z);
    if (dir.lengthSq() < 1) dir.set(0, 0, attacker.color === 'w' ? -1 : 1);
    dir.normalize();
    return { x: d.x + dir.x * STRIKE_GAP, z: d.z + dir.z * STRIKE_GAP };
  }

  async function melee(attacker, defender, animation, model, approach = 'walk') {
    const p = strikePoint(attacker, defender);
    const a = attacker.position();
    if (Math.hypot(p.x - a.x, p.z - a.z) > 2) {
      if (approach === 'jump') await jumpTo(attacker, p.x, p.z);
      else await walkTo(attacker, p.x, p.z);
    }
    const d = defender.position();
    attacker.face(d.x - p.x, d.z - p.z);
    defender.face(p.x - d.x, p.z - d.z);
    const drop = item(attacker, model, animation);
    attacker.play(animation, { then: 'Idle' });
    audio.play('swing');
    await untilHit(attacker, animation);
    const hit = hurt(defender, attacker);
    hit.catch(() => {}); // awaited below; this keeps an abort in the next wait from leaving it unhandled
    await clock.wait(Math.max(0, (ticksOf(animation) - (atlas.animations.get(animation.toLowerCase()).hitTick ?? 0)) * TICK));
    drop();
    await hit;
  }

  const ATTACKS = {
    async P(attacker, defender) {
      await melee(attacker, defender, 'Swing Mid', 'sword');
      await die(defender);
    },
    async K(attacker, defender) {
      await melee(attacker, defender, 'Swing High', 'katana');
      await die(defender, { bounce: true });
    },
    async N(attacker, defender) {
      await melee(attacker, defender, 'Poke Mid', 'spear', 'jump');
      await die(defender, { bounce: true });
    },
    async B(attacker, defender) {
      const a = attacker.position();
      const d = defender.position();
      attacker.face(d.x - a.x, d.z - a.z);
      defender.face(a.x - d.x, a.z - d.z);
      const circle = fx.circle(a, { color: 0xffe17a });
      const drop = item(attacker, 'tome', 'Read Book');
      attacker.play('Read Book', { then: 'Idle' });
      audio.play('magic');
      await untilHit(attacker, 'Read Book');
      circle.stop();
      drop();
      audio.play('magic');
      await fx.orb(attacker.head(), () => defender.chest(), { color: 0xffe17a, seconds: Math.max(0.35, a.distanceTo(d) / 260) });
      await hurt(defender, attacker);
      await die(defender);
    },
    async R(attacker, defender) {
      const a = attacker.position();
      const d = defender.position();
      attacker.face(d.x - a.x, d.z - a.z);
      defender.face(a.x - d.x, a.z - d.z);
      const mesh = new THREE.Mesh(assets.models.rifle, assets.metal);
      scene.add(mesh);
      attacker.sprite.carry(mesh, 'Gun Mid');
      attacker.play('Gun Mid', { then: 'Idle' });
      // The muzzle flashes 2 ticks before the hit, as on the kit's Gun card.
      const hitTick = atlas.animations.get('gun mid').hitTick;
      const fireAt = clock.now + (hitTick - 2) * TICK;
      await clock.until((now) => now >= fireAt);
      const muzzle = new THREE.Vector3(1, 0, 0).applyQuaternion(mesh.quaternion).multiplyScalar(9).add(mesh.position);
      fx.streak(muzzle, defender.chest());
      audio.play('gun');
      await untilHit(attacker, 'Gun Mid');
      const hit = hurt(defender, attacker);
      hit.catch(() => {});
      await clock.wait(0.45);
      attacker.sprite.release();
      scene.remove(mesh);
      await hit;
      await die(defender, { bounce: true });
    },
    async Q(attacker, defender) {
      const a = attacker.position();
      const d = defender.position();
      attacker.face(d.x - a.x, d.z - a.z);
      defender.face(a.x - d.x, a.z - d.z);
      const circle = fx.circle(a, { color: 0xb48cff, radius: 16 });
      attacker.play('Casting', { then: 'Casting Loop' });
      audio.play('magic');
      await clock.wait(Math.max(0.9, ticksOf('Casting') * TICK + 0.5));
      attacker.play('Cast Execute', { then: 'Idle' });
      circle.stop();
      await clock.wait(0.18);
      fx.lightning(defender.position().setY(0), { color: 0xb48cff });
      stage.flash?.();
      audio.play('thunder');
      await hurt(defender, attacker, { big: true });
      await die(defender, { bounce: true });
    },
  };

  // Instant capture when battles are off: a quick spark and fade.
  async function quickCapture(attacker, defender) {
    fx.sparks(defender.chest(), { count: 10 });
    audio.play('hit');
    await fadeTo(defender, 0, 0.2);
    defender.alive = false;
    stage.removeUnit(defender);
  }

  async function promote(unit, code) {
    const at = unit.position();
    if (stage.speedSetting === 0) {
      unit.setPiece(code);
      audio.play('promote');
      return;
    }
    const circle = fx.circle(at, { color: 0x7fe6ff });
    unit.play('Casting', { then: 'Casting Loop' });
    audio.play('magic');
    await clock.wait(0.6);
    await fadeTo(unit, 0, 0.35);
    unit.setPiece(code);
    fx.sparks(unit.chest(), { color: 0x7fe6ff, count: 30, speed: 70, up: 40, life: 0.7 });
    await fadeTo(unit, 1, 0.35);
    circle.stop();
    unit.play('Found Item', { then: 'Idle' });
    audio.play('promote');
    await clock.wait(0.8);
  }

  return {
    // Plays one chess move. `move` is the engine's move; `capturedUnit` the unit on move.capturedSquare.
    async play(move, attacker, capturedUnit, rookUnit) {
      const battleCam = stage.battleCam && capturedUnit && stage.speedSetting !== 0;
      if (capturedUnit) {
        if (battleCam) {
          const mid = attacker.position().add(capturedUnit.position()).multiplyScalar(0.5);
          mid.y = 10;
          stage.focusOn(mid, 1.9);
        }
        if (stage.speedSetting === 0) await quickCapture(attacker, capturedUnit);
        else await ATTACKS[attacker.piece](attacker, capturedUnit);
      }
      if (move.castle && rookUnit) {
        const rookTo = move.castle === 'K' ? move.from + 1 : move.from - 1;
        await Promise.all([travel(attacker, move.to, { style: 'walk' }), (async () => {
          await clock.wait(0.15);
          await travel(rookUnit, rookTo, { style: 'jump' });
        })()]);
        rookUnit.faceHome();
      } else {
        await travel(attacker, move.to);
      }
      if (move.promotion) await promote(attacker, attacker.color + move.promotion);
      attacker.faceHome();
      attacker.play('Idle');
      if (battleCam) stage.resetFocus();
    },
    async celebrate(winners, loserKing) {
      if (loserKing) {
        loserKing.play('Critical');
        fx.sparks(loserKing.chest(), { color: 0xff5566, count: 20 });
      }
      for (const u of winners) u.play('Dancing');
    },
    jumpTo,
    walkTo,
    teleportTo,
  };
}

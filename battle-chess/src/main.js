import './style.css';
import { Chess, sqIndex, sqName } from './chess/engine.js';
import { createClock } from './game/clock.js';
import { createBoardScene } from './game/scene.js';
import { GLYPHS, PIECE_NAMES, createUnit, createUnitWorld, loadAssets } from './game/units.js';
import { createEffects } from './game/effects.js';
import { createAudio } from './game/audio.js';
import { PIECE_VALUE, createBattles } from './game/battles.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const ui = {
  loading: $('loading'),
  loadingText: $('loading-text'),
  turn: $('turn'),
  turnText: $('turn-text'),
  banner: $('banner'),
  mode: $('mode'),
  level: $('level'),
  newGame: $('new-game'),
  undo: $('undo'),
  speed: $('battle-speed'),
  battleCam: $('battle-cam'),
  icons: $('icons'),
  sound: $('sound'),
  moves: $('moves'),
  capturedByWhite: $('captured-b'),
  capturedByBlack: $('captured-w'),
  promotion: $('promotion'),
  promoChoices: $('promo-choices'),
  gameOver: $('game-over'),
  gameOverTitle: $('game-over-title'),
  gameOverText: $('game-over-text'),
};

// ---- test & debug surface ------------------------------------------------------------------------
const debug = { ready: false, errors: [], battles: [], frames: 0 };
window.__battleChess = debug;
window.addEventListener('error', (e) => debug.errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => {
  // An AbortError is how New Game / Undo stops a battle mid-flight: expected, not a fault.
  if (e.reason?.name === 'AbortError') return e.preventDefault();
  debug.errors.push(String(e.reason?.message ?? e.reason));
});

async function start() {
  const board = createBoardScene(canvas);
  const clock = createClock();
  const audio = createAudio();
  const assets = await loadAssets(board.renderer, (p) => (ui.loadingText.textContent = `Mustering the armies… ${Math.round(p * 100)}%`));
  const world = createUnitWorld(board.scene, assets, clock);
  const fx = createEffects(board.scene, clock);

  let shake = 0;
  const flashEl = document.createElement('div');
  flashEl.style.cssText = 'position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;transition:opacity 250ms;z-index:5';
  document.getElementById('app').appendChild(flashEl);

  const state = {
    chess: new Chess(),
    units: new Array(64).fill(null),
    allUnits: new Set(),
    selected: -1,
    legal: [],
    busy: false,
    gen: 0,
    aiRequest: 0,
    sans: [],
    captured: { w: [], b: [] }, // pieces each side has taken
    over: null,
    mode: ui.mode.value,
    level: ui.level.value,
    pendingPromotion: null,
  };

  const stage = {
    clock,
    fx,
    audio,
    assets,
    scene: board.scene,
    speedSetting: 1,
    battleCam: true,
    focusOn: (p, z) => board.focusOn(p, z),
    resetFocus: () => board.resetFocus(),
    shake: (amount) => (shake = Math.max(shake, amount)),
    flash: () => {
      flashEl.style.transition = 'none';
      flashEl.style.opacity = '0.35';
      requestAnimationFrame(() => {
        flashEl.style.transition = 'opacity 300ms';
        flashEl.style.opacity = '0';
      });
    },
    removeUnit(unit) {
      unit.dispose();
      state.allUnits.delete(unit);
    },
  };
  const battles = createBattles(stage);

  // ---- helpers -----------------------------------------------------------------------------------
  const humanColors = () => ({ 'ai-w': ['w'], 'ai-b': ['b'], pvp: ['w', 'b'], cvc: [] })[state.mode];
  const isHumanTurn = () => humanColors().includes(state.chess.turn);
  const sideToMoveName = (c) => (c === 'w' ? 'White' : 'Black');

  function spawnUnits({ fadeIn }) {
    for (const u of state.allUnits) u.dispose();
    state.allUnits.clear();
    state.units.fill(null);
    state.chess.board.forEach((code, sq) => {
      if (!code) return;
      const unit = createUnit(world, code, sq, clock.now);
      state.units[sq] = unit;
      state.allUnits.add(unit);
      if (fadeIn) {
        unit.setFade(0);
        const delay = (code[0] === 'w' ? sq >> 3 : 7 - (sq >> 3)) * 0.08 + (sq & 7) * 0.03;
        const begin = clock.now + delay;
        clock.until((now) => {
          const t = Math.min(1, Math.max(0, (now - begin) / 0.6));
          if (unit.alive) unit.setFade(t);
          return t >= 1;
        }).catch(() => {});
      }
    });
  }

  function updateHud() {
    const { chess } = state;
    const status = chess.status();
    ui.turn.dataset.color = chess.turn;
    ui.turn.classList.toggle('check', status.check && !status.over);
    let text = `${sideToMoveName(chess.turn)} to move`;
    if (!status.over && !isHumanTurn()) text = `${sideToMoveName(chess.turn)} is thinking…`;
    if (state.busy && state.battleBy) text = `${sideToMoveName(state.battleBy)} attacks!`;
    else if (status.over) text = status.reason === 'checkmate' ? `Checkmate · ${sideToMoveName(status.winner)} wins` : `Draw · ${status.reason}`;
    ui.turnText.textContent = text;
    ui.turn.dataset.color = state.busy && state.battleBy ? state.battleBy : status.over && status.winner ? status.winner : chess.turn;
    ui.undo.disabled = state.busy || state.sans.length === 0 || state.mode === 'cvc';

    ui.moves.innerHTML = '';
    for (let i = 0; i < state.sans.length; i += 2) {
      const li = document.createElement('li');
      for (const san of state.sans.slice(i, i + 2)) {
        const span = document.createElement('span');
        span.textContent = san;
        if (san.includes('x')) span.className = 'capture';
        li.appendChild(span);
      }
      ui.moves.appendChild(li);
    }
    ui.moves.scrollTop = ui.moves.scrollHeight;

    const material = (list) => list.reduce((s, p) => s + ({ P: 1, N: 3, B: 3, R: 5, Q: 9 })[p], 0);
    const diff = material(state.captured.w) - material(state.captured.b);
    const order = 'QRBNP';
    const render = (el, list, enemy, adv) => {
      el.innerHTML = '';
      el.append(...[...list].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((p) => GLYPHS[enemy][p]).join(''));
      if (adv > 0) {
        const s = document.createElement('span');
        s.className = 'adv';
        s.textContent = `+${adv}`;
        el.appendChild(s);
      }
    };
    render(ui.capturedByWhite, state.captured.w, 'b', diff);
    render(ui.capturedByBlack, state.captured.b, 'w', -diff);

    // last move + check marks
    const last = chess.history[chess.history.length - 1]?.move;
    board.highlights.set('last', last ? [last.from, last.to] : []);
    board.highlights.set('check', status.check ? [chess.kingSquare(chess.turn)] : []);
  }

  let bannerTimer = 0;
  function banner(text, kind = '') {
    ui.banner.textContent = text;
    ui.banner.className = `banner ${kind}`;
    ui.banner.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => (ui.banner.hidden = true), 1600);
  }

  function select(sq) {
    if (state.selected >= 0 && state.units[state.selected]) state.units[state.selected].play('Idle');
    state.selected = sq;
    state.legal = sq >= 0 ? state.chess.moves({ square: sq }) : [];
    board.highlights.set('selected', sq >= 0 ? [sq] : []);
    board.highlights.set('move', [...new Set(state.legal.map((m) => m.to))]);
    board.highlights.set('capture', [...new Set(state.legal.filter((m) => m.captured).map((m) => m.to))]);
    if (sq >= 0 && state.units[sq]) state.units[sq].play('Walk', { loop: true });
  }

  // ---- moves -------------------------------------------------------------------------------------
  async function commit(move) {
    const gen = state.gen;
    const { chess } = state;
    select(-1);
    state.busy = true;
    const san = chess.san(move);
    const attacker = state.units[move.from];
    const victim = move.capturedSquare >= 0 ? state.units[move.capturedSquare] : null;
    const rookFrom = move.castle ? (move.castle === 'K' ? move.from + 3 : move.from - 4) : -1;
    const rook = rookFrom >= 0 ? state.units[rookFrom] : null;
    chess.make(move);
    state.sans.push(san);
    if (move.captured) state.captured[move.piece[0]].push(move.captured[1]);
    // The model moves at once; the units catch up during the battle.
    state.units[move.from] = null;
    if (move.capturedSquare >= 0) state.units[move.capturedSquare] = null;
    state.units[move.to] = attacker;
    if (rook) {
      state.units[rookFrom] = null;
      state.units[move.castle === 'K' ? move.from + 1 : move.from - 1] = rook;
    }
    state.battleBy = move.captured ? move.piece[0] : null;
    updateHud();
    board.highlights.set('check', []); // shown once the units have arrived, in afterMove
    const record = { san, piece: move.piece, captured: move.captured, startedAt: clock.now, done: false };
    debug.battles.push(record);
    try {
      await battles.play(move, attacker, victim, rook);
    } catch (error) {
      if (error.name !== 'AbortError') {
        debug.errors.push(String(error.stack ?? error));
        console.error(error);
      }
      return;
    }
    if (gen !== state.gen) return;
    record.done = true;
    record.seconds = clock.now - record.startedAt;
    state.busy = false;
    state.battleBy = null;
    afterMove();
  }

  function afterMove() {
    const { chess } = state;
    const status = chess.status();
    updateHud();
    if (status.over) {
      state.over = status;
      const winners = status.winner ? [...state.allUnits].filter((u) => u.color === status.winner) : [];
      const loserKing = status.winner ? state.units[chess.kingSquare(chess.turn)] : null;
      battles.celebrate(winners, loserKing);
      audio.play(status.winner ? 'victory' : 'draw');
      ui.gameOverTitle.textContent = status.reason === 'checkmate' ? 'Checkmate!' : 'Draw';
      ui.gameOverText.textContent = status.reason === 'checkmate' ? `${sideToMoveName(status.winner)} wins in ${Math.ceil(state.sans.length / 2)} moves.` : `The game is drawn by ${status.reason}.`;
      ui.gameOver.hidden = false;
      return;
    }
    if (status.check) {
      banner('CHECK!');
      audio.play('check');
      const king = state.units[chess.kingSquare(chess.turn)];
      king?.play('Defend', { then: 'Idle' });
    }
    if (!isHumanTurn()) requestAiMove();
  }

  const worker = new Worker(new URL('./chess/ai-worker.js', import.meta.url), { type: 'module' });
  const pendingAi = new Map();
  worker.onmessage = ({ data }) => {
    const resolve = pendingAi.get(data.id);
    pendingAi.delete(data.id);
    resolve?.(data);
  };
  async function requestAiMove() {
    const id = ++state.aiRequest;
    const gen = state.gen;
    const fen = state.chess.fen();
    state.busy = true;
    updateHud();
    const startedAt = performance.now();
    const reply = await new Promise((resolve) => {
      pendingAi.set(id, resolve);
      worker.postMessage({ id, fen, level: state.level });
    });
    const minThink = 350 - (performance.now() - startedAt);
    if (minThink > 0) await new Promise((r) => setTimeout(r, minThink));
    if (id !== state.aiRequest || gen !== state.gen || state.chess.fen() !== fen) return;
    state.busy = false;
    if (reply.error || !reply.move) {
      debug.errors.push(`AI: ${reply.error ?? 'no move'}`);
      return;
    }
    const move = state.chess.find(reply.move.from, reply.move.to, reply.move.promotion);
    if (move) commit(move);
  }

  function newGame() {
    state.gen++;
    state.aiRequest++;
    clock.abort();
    fx.clear();
    board.resetFocus();
    state.chess = new Chess();
    state.sans = [];
    state.captured = { w: [], b: [] };
    state.over = null;
    state.busy = false;
    state.battleBy = null;
    state.mode = ui.mode.value;
    state.level = ui.level.value;
    ui.gameOver.hidden = true;
    ui.promotion.hidden = true;
    debug.battles.length = 0;
    select(-1);
    spawnUnits({ fadeIn: true });
    board.setSide(state.mode === 'ai-b' ? 'b' : 'w');
    updateHud();
    if (!isHumanTurn()) {
      const gen = state.gen;
      clock.wait(1).then(() => gen === state.gen && requestAiMove(), () => {});
    }
  }

  function undo() {
    if (state.busy || !state.sans.length) return;
    state.gen++;
    state.aiRequest++;
    clock.abort();
    fx.clear();
    // Against the computer, take back the computer's reply as well, back to your own turn.
    let plies = 1;
    if (state.mode === 'ai-w' || state.mode === 'ai-b') plies = state.chess.turn === humanColors()[0] ? 2 : 1;
    plies = Math.min(plies, state.sans.length);
    for (let i = 0; i < plies; i++) {
      const m = state.chess.undo();
      state.sans.pop();
      if (m?.captured) state.captured[m.piece[0]].pop();
    }
    state.over = null;
    ui.gameOver.hidden = true;
    select(-1);
    spawnUnits({ fadeIn: false });
    updateHud();
    if (!isHumanTurn() && state.mode !== 'pvp') requestAiMove();
  }

  function choosePromotion(color) {
    return new Promise((resolve) => {
      ui.promoChoices.innerHTML = '';
      for (const p of 'QRBN') {
        const b = document.createElement('button');
        b.dataset.piece = p;
        b.innerHTML = `<span class="glyph">${GLYPHS[color][p]}</span><span>${PIECE_NAMES[p]}</span>`;
        b.onclick = () => {
          ui.promotion.hidden = true;
          resolve(p);
        };
        ui.promoChoices.appendChild(b);
      }
      ui.promotion.hidden = false;
    });
  }

  async function clickSquare(sq) {
    audio.unlock();
    if (sq < 0 || state.busy || state.over || !ui.promotion.hidden || !isHumanTurn()) return;
    const { chess } = state;
    const targets = state.legal.filter((m) => m.to === sq);
    if (state.selected >= 0 && targets.length) {
      let move = targets[0];
      if (move.promotion) {
        const gen = state.gen;
        const piece = await choosePromotion(chess.turn);
        if (gen !== state.gen) return;
        move = targets.find((m) => m.promotion === piece);
      }
      commit(move);
      return;
    }
    const code = chess.get(sq);
    if (code && code[0] === chess.turn && sq !== state.selected) {
      select(sq);
      audio.play('select');
    } else {
      if (state.selected >= 0 && sq !== state.selected) audio.play('deny');
      select(-1);
    }
  }

  // ---- input -------------------------------------------------------------------------------------
  const pickables = () => [...state.allUnits].filter((u) => u.alive && u.square >= 0).map((u) => ({ group: u.group, square: state.units.indexOf(u), opaqueAt: assets.opaqueAt })).filter((u) => u.square >= 0);
  // A legal destination under the cursor beats a unit drawn over it; otherwise the unit drawn there wins.
  const pickSquare = (e) => {
    const { sprite, ground } = board.pickAll(e.clientX, e.clientY, pickables());
    if (state.selected >= 0 && ground >= 0 && state.legal.some((m) => m.to === ground) && !state.legal.some((m) => m.to === sprite)) return ground;
    return sprite >= 0 ? sprite : ground;
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    clickSquare(pickSquare(e));
  });
  canvas.addEventListener('pointermove', (e) => {
    const sq = pickSquare(e);
    board.highlights.set('hover', sq >= 0 && isHumanTurn() && !state.busy ? [sq] : []);
  });
  canvas.addEventListener('pointerleave', () => board.highlights.clear('hover'));
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    board.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLSelectElement) return;
    if (e.key === 'q' || e.key === 'Q') board.rotate(-1);
    else if (e.key === 'e' || e.key === 'E') board.rotate(1);
    else if (e.key === 'f' || e.key === 'F') board.rotate(4);
    else if (e.key === 'Escape') select(-1);
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    }
  });
  $('rot-left').onclick = () => board.rotate(-1);
  $('rot-right').onclick = () => board.rotate(1);
  $('flip').onclick = () => board.rotate(4);
  ui.newGame.onclick = () => {
    audio.unlock();
    newGame();
  };
  $('game-over-new').onclick = newGame;
  $('game-over-close').onclick = () => (ui.gameOver.hidden = true);
  ui.undo.onclick = undo;
  ui.mode.onchange = newGame;
  ui.level.onchange = () => (state.level = ui.level.value);
  const applySpeed = () => {
    const v = Number(ui.speed.value);
    stage.speedSetting = v;
    clock.speed = v === 2 ? 2.2 : 1;
  };
  ui.speed.onchange = applySpeed;
  ui.battleCam.onchange = () => (stage.battleCam = ui.battleCam.checked);
  ui.icons.onchange = () => (world.showIcons = ui.icons.checked);
  ui.sound.onchange = () => (audio.enabled = ui.sound.checked);
  applySpeed();

  // ---- frame loop --------------------------------------------------------------------------------
  let lastMs = performance.now();
  board.renderer.setAnimationLoop((ms) => {
    const dt = Math.max(0, (ms - lastMs) / 1000);
    lastMs = ms;
    clock.tick(dt);
    board.updateCamera(dt);
    if (shake > 0.05) {
      board.camera.position.x += (Math.random() - 0.5) * shake;
      board.camera.position.y += (Math.random() - 0.5) * shake;
      board.camera.updateMatrixWorld();
      shake *= Math.exp(-dt * 12);
    }
    for (const unit of state.allUnits) unit.update(clock.now, board.camera);
    fx.update(clock.now, board.camera);
    board.renderer.render(board.scene, board.camera);
    debug.frames++;
  });

  // ---- debug hooks used by the Playwright suite ---------------------------------------------------
  Object.assign(debug, {
    fen: () => state.chess.fen(),
    status: () => state.chess.status(),
    busy: () => state.busy,
    turn: () => state.chess.turn,
    history: () => [...state.sans],
    selected: () => (state.selected >= 0 ? sqName(state.selected) : null),
    squareToClient: (name) => {
      // Occupied squares: the unit's head, the part least covered by the unit in front. Empty: the floor.
      const unit = state.units[sqIndex(name)];
      if (!unit) return board.squareToClient(sqIndex(name));
      return board.worldToClient(unit.head().add({ x: 0, y: -3, z: 0 }));
    },
    highlights: (name) => board.highlights.kindsAt(sqIndex(name)),
    floorToClient: (name) => board.squareToClient(sqIndex(name), 0.3),
    drawn: (name) => board.highlights.drawnAt(sqIndex(name)),
    units: () =>
      [...state.allUnits].map((u) => ({ code: u.code, square: state.units.indexOf(u) >= 0 ? sqName(state.units.indexOf(u)) : null, animation: u.sprite.player.animation.name, fade: u.fade, facing: u.sprite.player.facing })),
    unitAt: (name) => {
      const u = state.units[sqIndex(name)];
      return u ? { code: u.code, animation: u.sprite.player.animation.name, fade: u.fade } : null;
    },
    effects: () => fx.count,
    renderInfo: () => ({ ...board.renderer.info.render, programs: board.renderer.info.programs?.length, cam: board.camera.position.toArray(), zoom: board.view.zoom, focus: board.view.focus.toArray(), clock: clock.now }),
    load(fen) {
      newGame();
      state.chess = new Chess(fen);
      spawnUnits({ fadeIn: false });
      updateHud();
      if (!isHumanTurn()) requestAiMove();
    },
    setSpeed(value) {
      ui.speed.value = String(value);
      applySpeed();
    },
    rotate: (n) => board.rotate(n),
    setView: (step, elevation) => board.setView(step, elevation),
    pieceValue: PIECE_VALUE,
  });

  newGame();
  ui.loading.classList.add('done');
  debug.ready = true;
}

start().catch((error) => {
  console.error(error);
  debug.errors.push(String(error?.stack ?? error));
  ui.loading.classList.add('error');
  ui.loadingText.textContent = `Could not start: ${error.message}`;
});

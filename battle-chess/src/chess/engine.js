// Chess rules: legal move generation, make/undo, SAN, FEN, and game-end detection.
//
// Squares are 0..63: index = rank * 8 + file, a1 = 0, h1 = 7, a8 = 56. A piece is a two-letter string,
// color then type: 'wK', 'bP'. Empty is null. A move is
//   { from, to, piece, captured, capturedSquare, promotion, castle, enPassant, double }
// where castle is 'K' or 'Q', and capturedSquare differs from `to` only for en passant.

export const FILES = 'abcdefgh';
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

export const fileOf = (sq) => sq & 7;
export const rankOf = (sq) => sq >> 3;
export const sqName = (sq) => FILES[fileOf(sq)] + (rankOf(sq) + 1);
export const sqIndex = (name) => FILES.indexOf(name[0]) + (Number(name[1]) - 1) * 8;
const at = (f, r) => (f < 0 || f > 7 || r < 0 || r > 7 ? -1 : r * 8 + f);
const other = (c) => (c === 'w' ? 'b' : 'w');

// Moving from or to one of these squares removes the listed castling rights.
const RIGHTS_TOUCH = { 0: 'Q', 4: 'KQ', 7: 'K', 56: 'q', 60: 'kq', 63: 'k' };

export class Chess {
  constructor(fen = START_FEN) {
    this.load(fen);
  }

  load(fen) {
    const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/);
    this.board = new Array(64).fill(null);
    const rows = placement.split('/');
    if (rows.length !== 8) throw new Error(`bad FEN: ${fen}`);
    rows.forEach((row, i) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) f += Number(ch);
        else {
          const color = ch === ch.toUpperCase() ? 'w' : 'b';
          this.board[(7 - i) * 8 + f] = color + ch.toUpperCase();
          f++;
        }
      }
    });
    this.turn = turn === 'b' ? 'b' : 'w';
    this.castling = castling && castling !== '-' ? castling : '';
    this.ep = ep && ep !== '-' ? sqIndex(ep) : -1;
    this.halfmove = Number(half ?? 0);
    this.fullmove = Number(full ?? 1);
    this.history = [];
    this.positions = [this.positionKey()];
  }

  fen() {
    const rows = [];
    for (let r = 7; r >= 0; r--) {
      let row = '';
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.board[r * 8 + f];
        if (!p) empty++;
        else {
          if (empty) row += empty;
          empty = 0;
          row += p[0] === 'w' ? p[1] : p[1].toLowerCase();
        }
      }
      rows.push(row + (empty || ''));
    }
    return `${rows.join('/')} ${this.turn} ${this.castling || '-'} ${this.ep >= 0 ? sqName(this.ep) : '-'} ${this.halfmove} ${this.fullmove}`;
  }

  // Repetition key: placement, side, castling and a *capturable* en passant square only.
  positionKey() {
    let ep = '-';
    if (this.ep >= 0) {
      const dir = this.turn === 'w' ? -1 : 1;
      const r = rankOf(this.ep) + dir;
      for (const df of [-1, 1]) {
        const s = at(fileOf(this.ep) + df, r);
        if (s >= 0 && this.board[s] === this.turn + 'P') ep = sqName(this.ep);
      }
    }
    return `${this.fen().split(' ').slice(0, 3).join(' ')} ${ep}`;
  }

  get(sq) {
    return this.board[sq];
  }

  kingSquare(color) {
    return this.board.indexOf(color + 'K');
  }

  // True when `by` attacks `sq`.
  attacked(sq, by) {
    const f = fileOf(sq);
    const r = rankOf(sq);
    const b = this.board;
    const pr = by === 'w' ? r - 1 : r + 1;
    for (const df of [-1, 1]) {
      const s = at(f + df, pr);
      if (s >= 0 && b[s] === by + 'P') return true;
    }
    for (const [df, dr] of KNIGHT) {
      const s = at(f + df, r + dr);
      if (s >= 0 && b[s] === by + 'N') return true;
    }
    for (const [df, dr] of KING) {
      const s = at(f + df, r + dr);
      if (s >= 0 && b[s] === by + 'K') return true;
    }
    for (const [dirs, kinds] of [[ROOK, 'RQ'], [BISHOP, 'BQ']]) {
      for (const [df, dr] of dirs) {
        for (let k = 1; ; k++) {
          const s = at(f + df * k, r + dr * k);
          if (s < 0) break;
          const p = b[s];
          if (p) {
            if (p[0] === by && kinds.includes(p[1])) return true;
            break;
          }
        }
      }
    }
    return false;
  }

  inCheck(color = this.turn) {
    return this.attacked(this.kingSquare(color), other(color));
  }

  pseudoMoves(color = this.turn) {
    const moves = [];
    const b = this.board;
    const add = (from, to, extra = {}) => moves.push({ from, to, piece: b[from], captured: b[to] ?? null, capturedSquare: b[to] ? to : -1, promotion: null, castle: null, enPassant: false, double: false, ...extra });
    for (let from = 0; from < 64; from++) {
      const p = b[from];
      if (!p || p[0] !== color) continue;
      const f = fileOf(from);
      const r = rankOf(from);
      const type = p[1];
      if (type === 'P') {
        const dir = color === 'w' ? 1 : -1;
        const startRank = color === 'w' ? 1 : 6;
        const lastRank = color === 'w' ? 7 : 0;
        const pushPromos = (to, extra = {}) => {
          if (rankOf(to) === lastRank) for (const promotion of ['Q', 'R', 'B', 'N']) add(from, to, { ...extra, promotion });
          else add(from, to, extra);
        };
        const one = at(f, r + dir);
        if (one >= 0 && !b[one]) {
          pushPromos(one);
          const two = at(f, r + 2 * dir);
          if (r === startRank && !b[two]) add(from, two, { double: true });
        }
        for (const df of [-1, 1]) {
          const to = at(f + df, r + dir);
          if (to < 0) continue;
          if (b[to] && b[to][0] !== color) pushPromos(to);
          else if (to === this.ep) {
            const cap = at(f + df, r);
            add(from, to, { enPassant: true, captured: b[cap], capturedSquare: cap });
          }
        }
      } else if (type === 'N' || type === 'K') {
        for (const [df, dr] of type === 'N' ? KNIGHT : KING) {
          const to = at(f + df, r + dr);
          if (to >= 0 && (!b[to] || b[to][0] !== color)) add(from, to);
        }
        if (type === 'K') {
          const home = color === 'w' ? 4 : 60;
          const [kRight, qRight] = color === 'w' ? ['K', 'Q'] : ['k', 'q'];
          const enemy = other(color);
          if (from === home && !this.attacked(home, enemy)) {
            if (this.castling.includes(kRight) && !b[home + 1] && !b[home + 2] && b[home + 3] === color + 'R' && !this.attacked(home + 1, enemy) && !this.attacked(home + 2, enemy)) add(from, home + 2, { castle: 'K' });
            if (this.castling.includes(qRight) && !b[home - 1] && !b[home - 2] && !b[home - 3] && b[home - 4] === color + 'R' && !this.attacked(home - 1, enemy) && !this.attacked(home - 2, enemy)) add(from, home - 2, { castle: 'Q' });
          }
        }
      } else {
        const dirs = type === 'R' ? ROOK : type === 'B' ? BISHOP : [...ROOK, ...BISHOP];
        for (const [df, dr] of dirs) {
          for (let k = 1; ; k++) {
            const to = at(f + df * k, r + dr * k);
            if (to < 0) break;
            if (b[to]) {
              if (b[to][0] !== color) add(from, to);
              break;
            }
            add(from, to);
          }
        }
      }
    }
    return moves;
  }

  moves({ square } = {}) {
    const color = this.turn;
    const legal = [];
    for (const m of this.pseudoMoves(color)) {
      if (square !== undefined && m.from !== square) continue;
      this.make(m, false);
      if (!this.inCheck(color)) legal.push(m);
      this.undo();
    }
    return legal;
  }

  // record=false skips the repetition key: legality checks and search do not need it.
  make(m, record = true) {
    const b = this.board;
    const color = m.piece[0];
    this.history.push({ move: m, castling: this.castling, ep: this.ep, halfmove: this.halfmove, fullmove: this.fullmove, record });
    if (m.capturedSquare >= 0) b[m.capturedSquare] = null;
    b[m.to] = m.promotion ? color + m.promotion : m.piece;
    b[m.from] = null;
    if (m.castle) {
      const [rf, rt] = m.castle === 'K' ? [m.from + 3, m.from + 1] : [m.from - 4, m.from - 1];
      b[rt] = b[rf];
      b[rf] = null;
    }
    for (const sq of [m.from, m.to]) {
      const lost = RIGHTS_TOUCH[sq];
      if (lost) this.castling = [...this.castling].filter((c) => !lost.includes(c)).join('');
    }
    this.ep = m.double ? (m.from + m.to) / 2 : -1;
    this.halfmove = m.piece[1] === 'P' || m.captured ? 0 : this.halfmove + 1;
    if (color === 'b') this.fullmove++;
    this.turn = other(color);
    if (record) this.positions.push(this.positionKey());
  }

  undo() {
    const last = this.history.pop();
    if (!last) return null;
    const { move: m } = last;
    const b = this.board;
    b[m.from] = m.piece;
    b[m.to] = null;
    if (m.capturedSquare >= 0) b[m.capturedSquare] = m.captured;
    if (m.castle) {
      const [rf, rt] = m.castle === 'K' ? [m.from + 3, m.from + 1] : [m.from - 4, m.from - 1];
      b[rf] = b[rt];
      b[rt] = null;
    }
    this.castling = last.castling;
    this.ep = last.ep;
    this.halfmove = last.halfmove;
    this.fullmove = last.fullmove;
    this.turn = m.piece[0];
    if (last.record) this.positions.pop();
    return m;
  }

  // Standard Algebraic Notation for a legal move in the current position.
  san(m) {
    let s;
    if (m.castle) s = m.castle === 'K' ? 'O-O' : 'O-O-O';
    else {
      const type = m.piece[1];
      const capture = Boolean(m.captured);
      if (type === 'P') {
        s = (capture ? FILES[fileOf(m.from)] + 'x' : '') + sqName(m.to) + (m.promotion ? '=' + m.promotion : '');
      } else {
        const rivals = this.moves().filter((o) => o.piece === m.piece && o.to === m.to && o.from !== m.from);
        let dis = '';
        if (rivals.length) {
          const sameFile = rivals.some((o) => fileOf(o.from) === fileOf(m.from));
          const sameRank = rivals.some((o) => rankOf(o.from) === rankOf(m.from));
          if (!sameFile) dis = FILES[fileOf(m.from)];
          else if (!sameRank) dis = String(rankOf(m.from) + 1);
          else dis = sqName(m.from);
        }
        s = type + dis + (capture ? 'x' : '') + sqName(m.to);
      }
    }
    this.make(m, false);
    if (this.inCheck()) s += this.moves().length ? '+' : '#';
    this.undo();
    return s;
  }

  // Finds the legal move matching from/to (and promotion, default queen).
  find(from, to, promotion) {
    const options = this.moves({ square: from }).filter((m) => m.to === to);
    if (!options.length) return null;
    return options.find((m) => m.promotion === (promotion ?? (options[0].promotion ? 'Q' : null))) ?? null;
  }

  insufficientMaterial() {
    const pieces = [];
    this.board.forEach((p, sq) => {
      if (p && p[1] !== 'K') pieces.push([p, sq]);
    });
    if (pieces.length === 0) return true;
    if (pieces.some(([p]) => 'PRQ'.includes(p[1]))) return false;
    if (pieces.length === 1) return true; // K+minor vs K
    // Only bishops, all on one square color.
    if (pieces.every(([p]) => p[1] === 'B')) {
      const shade = (sq) => (fileOf(sq) + rankOf(sq)) % 2;
      return pieces.every(([, sq]) => shade(sq) === shade(pieces[0][1]));
    }
    return false;
  }

  repetitions() {
    const now = this.positions[this.positions.length - 1];
    return this.positions.filter((k) => k === now).length;
  }

  // { over, result: '1-0' | '0-1' | '1/2-1/2' | null, reason, check }
  status() {
    const check = this.inCheck();
    const any = this.moves().length > 0;
    if (!any && check) return { over: true, result: this.turn === 'w' ? '0-1' : '1-0', reason: 'checkmate', check, winner: other(this.turn) };
    if (!any) return { over: true, result: '1/2-1/2', reason: 'stalemate', check };
    if (this.insufficientMaterial()) return { over: true, result: '1/2-1/2', reason: 'insufficient material', check };
    if (this.halfmove >= 100) return { over: true, result: '1/2-1/2', reason: 'fifty-move rule', check };
    if (this.repetitions() >= 3) return { over: true, result: '1/2-1/2', reason: 'threefold repetition', check };
    return { over: false, result: null, reason: null, check };
  }

  perft(depth) {
    if (depth === 0) return 1;
    let n = 0;
    for (const m of this.moves()) {
      this.make(m, false);
      n += depth === 1 ? 1 : this.perft(depth - 1);
      this.undo();
    }
    return n;
  }
}

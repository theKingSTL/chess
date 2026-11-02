// Computer opponent: negamax alpha-beta with quiescence search, MVV-LVA ordering, piece-square tables
// and iterative deepening under a time budget. Pure functions over the Chess class, so it runs in a worker.
import { Chess } from './engine.js';

const VALUE = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
const MATE = 100000;

// Piece-square tables from White's side, a8 first (row 0 = rank 8). Black reads them mirrored.
const PST = {
  P: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  N: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  B: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  R: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  Q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  K: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
  KE: [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50],
};

const pstIndex = (sq, color) => (color === 'w' ? (7 - (sq >> 3)) * 8 + (sq & 7) : (sq >> 3) * 8 + (sq & 7));

// Score from the side to move's point of view.
export function evaluate(chess) {
  let score = 0;
  let material = 0;
  for (const p of chess.board) if (p && p[1] !== 'K' && p[1] !== 'P') material += VALUE[p[1]];
  const endgame = material <= 1300;
  chess.board.forEach((p, sq) => {
    if (!p) return;
    const table = p[1] === 'K' && endgame ? PST.KE : PST[p[1]];
    const v = VALUE[p[1]] + table[pstIndex(sq, p[0])];
    score += p[0] === 'w' ? v : -v;
  });
  return chess.turn === 'w' ? score : -score;
}

const orderScore = (m) => (m.captured ? 10 * VALUE[m.captured[1]] - VALUE[m.piece[1]] + 10000 : 0) + (m.promotion ? VALUE[m.promotion] + 9000 : 0);

class Search {
  constructor(chess, deadline, maxNodes) {
    this.chess = chess;
    this.deadline = deadline;
    this.maxNodes = maxNodes;
    this.nodes = 0;
    this.stopped = false;
  }

  timeUp() {
    if ((this.nodes & 1023) === 0 && (Date.now() > this.deadline || this.nodes > this.maxNodes)) this.stopped = true;
    return this.stopped;
  }

  legal(captureOnly = false) {
    const c = this.chess;
    const color = c.turn;
    const out = [];
    for (const m of c.pseudoMoves(color)) {
      if (captureOnly && !m.captured && !m.promotion) continue;
      c.make(m, false);
      if (!c.inCheck(color)) out.push(m);
      c.undo();
    }
    return out.sort((a, b) => orderScore(b) - orderScore(a));
  }

  quiesce(alpha, beta, ply) {
    this.nodes++;
    if (this.timeUp()) return 0;
    const stand = evaluate(this.chess);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (ply > 8) return alpha;
    for (const m of this.legal(true)) {
      this.chess.make(m, false);
      const score = -this.quiesce(-beta, -alpha, ply + 1);
      this.chess.undo();
      if (this.stopped) return 0;
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  negamax(depth, alpha, beta, ply, first) {
    this.nodes++;
    if (this.timeUp()) return 0;
    const moves = this.legal();
    if (!moves.length) return this.chess.inCheck() ? -MATE + ply : 0;
    if (this.chess.halfmove >= 100) return 0;
    if (depth === 0) return this.quiesce(alpha, beta, 0);
    if (first) moves.sort((a, b) => (a.from === first.from && a.to === first.to && a.promotion === first.promotion ? -1 : b.from === first.from && b.to === first.to && b.promotion === first.promotion ? 1 : 0));
    let best = -Infinity;
    for (const m of moves) {
      this.chess.make(m, false);
      const score = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
      this.chess.undo();
      if (this.stopped) return 0;
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    return best;
  }

  root(depth, previousBest) {
    const moves = this.legal();
    if (previousBest) moves.sort((a, b) => (a === previousBest ? -1 : b === previousBest ? 1 : 0));
    let best = null;
    let bestScore = -Infinity;
    let alpha = -Infinity;
    const scored = [];
    for (const m of moves) {
      this.chess.make(m, false);
      const score = -this.negamax(depth - 1, -Infinity, -alpha, 1);
      this.chess.undo();
      if (this.stopped) return null;
      scored.push([m, score]);
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
      if (score > alpha) alpha = score;
    }
    return { move: best, score: bestScore, scored, moves };
  }
}

// Levels: depth cap, time budget (ms) and how much randomness picks among near-best moves.
export const LEVELS = {
  easy: { depth: 1, timeMs: 300, slack: 120 },
  normal: { depth: 3, timeMs: 1500, slack: 15 },
  hard: { depth: 5, timeMs: 3500, slack: 0 },
};

// Returns { from, to, promotion, score, depth } for the side to move, or null with no legal move.
export function chooseMove(fen, level = 'normal', random = Math.random) {
  const { depth: maxDepth, timeMs, slack } = LEVELS[level] ?? LEVELS.normal;
  const chess = new Chess(fen);
  const search = new Search(chess, Date.now() + timeMs, 4_000_000);
  let result = null;
  for (let depth = 1; depth <= maxDepth; depth++) {
    const r = search.root(depth, result?.move);
    if (!r) break;
    result = { ...r, depth };
    if (Math.abs(r.score) > MATE - 100) break;
  }
  if (!result || !result.move) return null;
  let pick = result.move;
  if (slack > 0) {
    const near = result.scored.filter(([, s]) => s >= result.score - slack);
    pick = near[Math.floor(random() * near.length)][0];
  }
  return { from: pick.from, to: pick.to, promotion: pick.promotion, score: result.score, depth: result.depth };
}

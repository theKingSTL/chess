import { describe, expect, it } from 'vitest';
import { Chess, START_FEN, sqIndex } from '../src/chess/engine.js';
import { chooseMove, evaluate } from '../src/chess/ai.js';

const play = (chess, ...sans) => {
  for (const san of sans) {
    const move = chess.moves().find((m) => chess.san(m) === san);
    if (!move) throw new Error(`illegal ${san} in ${chess.fen()}`);
    chess.make(move);
  }
  return chess;
};

describe('perft (move generator against published counts)', () => {
  it('start position', () => {
    const c = new Chess();
    expect(c.perft(1)).toBe(20);
    expect(c.perft(2)).toBe(400);
    expect(c.perft(3)).toBe(8902);
    expect(c.perft(4)).toBe(197281);
  });
  it('kiwipete: castling, en passant, promotion, pins', () => {
    const c = new Chess('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
    expect(c.perft(1)).toBe(48);
    expect(c.perft(2)).toBe(2039);
    expect(c.perft(3)).toBe(97862);
  });
  it('position 3: en passant discovered checks', () => {
    const c = new Chess('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
    expect(c.perft(4)).toBe(43238);
  });
  it('position 4: promotions and castling under check', () => {
    const c = new Chess('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1');
    expect(c.perft(3)).toBe(9467);
  });
  it('position 5', () => {
    const c = new Chess('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8');
    expect(c.perft(3)).toBe(62379);
  });
  it('make/undo restores the position exactly', () => {
    const c = new Chess('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
    const before = c.fen();
    for (const m of c.moves()) {
      c.make(m);
      c.undo();
      expect(c.fen()).toBe(before);
    }
  });
});

describe('rules', () => {
  it('FEN round trip', () => {
    expect(new Chess().fen()).toBe(START_FEN);
  });
  it("fool's mate is checkmate for black", () => {
    const c = play(new Chess(), 'f3', 'e5', 'g4', 'Qh4#');
    expect(c.status()).toMatchObject({ over: true, reason: 'checkmate', result: '0-1', winner: 'b' });
  });
  it('stalemate', () => {
    const c = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(c.status()).toMatchObject({ over: true, reason: 'stalemate' });
  });
  it('castling both sides, and rights are lost after a rook moves', () => {
    const c = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const sans = c.moves().map((m) => c.san(m));
    expect(sans).toContain('O-O');
    expect(sans).toContain('O-O-O');
    play(c, 'Rh2');
    expect(c.castling).toBe('Qkq');
    play(c, 'O-O-O');
    expect(c.get(sqIndex('c8'))).toBe('bK');
    expect(c.get(sqIndex('d8'))).toBe('bR');
  });
  it('cannot castle through check', () => {
    const c = new Chess('4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1');
    const sans = c.moves().map((m) => c.san(m));
    expect(sans).not.toContain('O-O');
  });
  it('en passant capture removes the passed pawn', () => {
    const c = play(new Chess(), 'e4', 'a6', 'e5', 'd5');
    const ep = c.moves().find((m) => m.enPassant);
    expect(c.san(ep)).toBe('exd6');
    c.make(ep);
    expect(c.get(sqIndex('d5'))).toBeNull();
    expect(c.get(sqIndex('d6'))).toBe('wP');
  });
  it('promotion offers four pieces and SAN shows it', () => {
    const c = new Chess('8/P7/8/8/8/8/8/k6K w - - 0 1');
    const promos = c.moves().filter((m) => m.promotion);
    expect(promos.map((m) => m.promotion).sort()).toEqual(['B', 'N', 'Q', 'R']);
    expect(c.san(c.find(sqIndex('a7'), sqIndex('a8'), 'N'))).toBe('a8=N');
    expect(c.find(sqIndex('a7'), sqIndex('a8')).promotion).toBe('Q');
  });
  it('SAN disambiguation', () => {
    const c = new Chess('k7/8/8/8/8/8/8/KN3N2 w - - 0 1');
    const sans = c.moves().map((m) => c.san(m));
    expect(sans).toContain('Nbd2');
    expect(sans).toContain('Nfd2');
  });
  it('insufficient material', () => {
    expect(new Chess('k7/8/8/8/8/8/8/KB6 w - - 0 1').status().reason).toBe('insufficient material');
    expect(new Chess('k7/8/8/8/8/8/8/KR6 w - - 0 1').status().over).toBe(false);
  });
  it('threefold repetition', () => {
    const c = play(new Chess(), 'Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8');
    expect(c.status().reason).toBe('threefold repetition');
  });
  it('fifty-move rule', () => {
    expect(new Chess('k7/8/8/8/8/8/8/KR6 w - - 100 80').status().reason).toBe('fifty-move rule');
  });
});

describe('AI', () => {
  it('evaluates the start position as level', () => {
    expect(evaluate(new Chess())).toBe(0);
  });
  it('takes a free queen', () => {
    const m = chooseMove('k7/8/8/3q4/8/8/8/K2R4 w - - 0 1', 'normal', () => 0);
    expect([m.from, m.to]).toEqual([sqIndex('d1'), sqIndex('d5')]);
  });
  it('finds mate in one', () => {
    const m = chooseMove('6k1/5ppp/8/8/8/8/8/K3R3 w - - 0 1', 'normal', () => 0);
    expect(m.to).toBe(sqIndex('e8'));
  });
  it('returns a legal move at every level and null when mated', () => {
    for (const level of ['easy', 'normal', 'hard']) {
      const c = new Chess();
      const m = chooseMove(c.fen(), level);
      expect(c.find(m.from, m.to, m.promotion)).not.toBeNull();
    }
    expect(chooseMove('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3')).toBeNull();
  });
});

"""2D-array chess engine.

board[row][col]: row 0 is rank 8 (top of the screen), col 0 is the a-file.
Pieces are 2-character strings like 'wp', 'bK'; an empty square is '--'.
A square is a (row, col) tuple. A move is ((r1, c1), (r2, c2), promo)
where promo is None or one of 'Q', 'R', 'B', 'N'.
"""

KNIGHT_STEPS = ((-2, -1), (-2, 1), (-1, -2), (-1, 2), (1, -2), (1, 2), (2, -1), (2, 1))
KING_STEPS = ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1))
ROOK_DIRS = ((-1, 0), (1, 0), (0, -1), (0, 1))
BISHOP_DIRS = ((-1, -1), (-1, 1), (1, -1), (1, 1))

# Moving from or to one of these squares loses the listed castling rights.
RIGHTS_LOST = {
    (7, 4): {"wK", "wQ"}, (7, 7): {"wK"}, (7, 0): {"wQ"},
    (0, 4): {"bK", "bQ"}, (0, 7): {"bK"}, (0, 0): {"bQ"},
}


def on_board(r, c):
    return 0 <= r < 8 and 0 <= c < 8


class GameState:
    def __init__(self):
        self.board = [
            ["bR", "bN", "bB", "bQ", "bK", "bB", "bN", "bR"],
            ["bp", "bp", "bp", "bp", "bp", "bp", "bp", "bp"],
            ["--", "--", "--", "--", "--", "--", "--", "--"],
            ["--", "--", "--", "--", "--", "--", "--", "--"],
            ["--", "--", "--", "--", "--", "--", "--", "--"],
            ["--", "--", "--", "--", "--", "--", "--", "--"],
            ["wp", "wp", "wp", "wp", "wp", "wp", "wp", "wp"],
            ["wR", "wN", "wB", "wQ", "wK", "wB", "wN", "wR"],
        ]
        self.white_to_move = True
        self.castling = {"wK", "wQ", "bK", "bQ"}   # castling rights still available
        self.ep_square = None                      # square a pawn may capture onto en passant
        self.move_log = []
        self._undo = []
        self._legal = None                         # cache of legal moves for this position

    # ---- loading a position (handy for testing) ----
    def load_fen(self, fen):
        parts = fen.split()
        self.board = []
        for rank in parts[0].split("/"):
            row = []
            for ch in rank:
                if ch.isdigit():
                    row += ["--"] * int(ch)
                else:
                    row.append(("w" if ch.isupper() else "b") + ("p" if ch in "pP" else ch.upper()))
            self.board.append(row)
        self.white_to_move = parts[1] == "w"
        self.castling = {name for ch, name in (("K", "wK"), ("Q", "wQ"), ("k", "bK"), ("q", "bQ"))
                         if ch in parts[2]}
        self.ep_square = None
        if parts[3] != "-":
            self.ep_square = (8 - int(parts[3][1]), "abcdefgh".index(parts[3][0]))
        self.move_log, self._undo, self._legal = [], [], None

    # ---- check detection ----
    def find_king(self, color):
        for r in range(8):
            for c in range(8):
                if self.board[r][c] == color + "K":
                    return r, c

    def is_attacked(self, r, c, by):
        """Is square (r, c) attacked by color `by` ('w' or 'b')?"""
        board = self.board
        pr = r + 1 if by == "w" else r - 1            # row a pawn of `by` would attack from
        for pc in (c - 1, c + 1):
            if on_board(pr, pc) and board[pr][pc] == by + "p":
                return True
        for dr, dc in KNIGHT_STEPS:
            if on_board(r + dr, c + dc) and board[r + dr][c + dc] == by + "N":
                return True
        for dr, dc in KING_STEPS:
            if on_board(r + dr, c + dc) and board[r + dr][c + dc] == by + "K":
                return True
        for dirs, attackers in ((ROOK_DIRS, (by + "R", by + "Q")),
                                (BISHOP_DIRS, (by + "B", by + "Q"))):
            for dr, dc in dirs:
                rr, cc = r + dr, c + dc
                while on_board(rr, cc):
                    if board[rr][cc] != "--":
                        if board[rr][cc] in attackers:
                            return True
                        break
                    rr += dr
                    cc += dc
        return False

    def in_check(self):
        me, enemy = ("w", "b") if self.white_to_move else ("b", "w")
        kr, kc = self.find_king(me)
        return self.is_attacked(kr, kc, enemy)

    # ---- move generation ----
    def _pseudo_legal(self):
        """Every move that follows piece rules (may still leave own king in check)."""
        me, enemy = ("w", "b") if self.white_to_move else ("b", "w")
        moves = []
        for r in range(8):
            for c in range(8):
                piece = self.board[r][c]
                if piece[0] != me:
                    continue
                kind = piece[1]
                if kind == "p":
                    self._pawn_moves(r, c, me, enemy, moves)
                elif kind == "N":
                    self._step_moves(r, c, me, KNIGHT_STEPS, moves)
                elif kind == "K":
                    self._step_moves(r, c, me, KING_STEPS, moves)
                    self._castle_moves(me, enemy, moves)
                else:
                    dirs = ROOK_DIRS if kind == "R" else BISHOP_DIRS if kind == "B" else ROOK_DIRS + BISHOP_DIRS
                    self._slide_moves(r, c, me, dirs, moves)
        return moves

    def _pawn_moves(self, r, c, me, enemy, moves):
        board = self.board
        step = -1 if me == "w" else 1
        start_row = 6 if me == "w" else 1
        last_row = 0 if me == "w" else 7
        r2 = r + step

        def add(row, col):
            if row == last_row:
                moves.extend(((r, c), (row, col), p) for p in "QRBN")   # promotion
            else:
                moves.append(((r, c), (row, col), None))

        if board[r2][c] == "--":
            add(r2, c)
            if r == start_row and board[r + 2 * step][c] == "--":
                moves.append(((r, c), (r + 2 * step, c), None))
        for c2 in (c - 1, c + 1):
            if 0 <= c2 < 8 and (board[r2][c2][0] == enemy or (r2, c2) == self.ep_square):
                add(r2, c2)

    def _step_moves(self, r, c, me, steps, moves):
        for dr, dc in steps:
            r2, c2 = r + dr, c + dc
            if on_board(r2, c2) and self.board[r2][c2][0] != me:
                moves.append(((r, c), (r2, c2), None))

    def _slide_moves(self, r, c, me, dirs, moves):
        for dr, dc in dirs:
            r2, c2 = r + dr, c + dc
            while on_board(r2, c2):
                target = self.board[r2][c2]
                if target[0] == me:
                    break
                moves.append(((r, c), (r2, c2), None))
                if target != "--":
                    break                                  # captured a piece, stop here
                r2 += dr
                c2 += dc

    def _castle_moves(self, me, enemy, moves):
        row = 7 if me == "w" else 0
        b = self.board[row]
        if b[4] != me + "K" or not (self.castling & {me + "K", me + "Q"}):
            return
        if self.is_attacked(row, 4, enemy):                # can't castle out of check
            return
        if (me + "K" in self.castling and b[7] == me + "R" and b[5] == b[6] == "--"
                and not self.is_attacked(row, 5, enemy) and not self.is_attacked(row, 6, enemy)):
            moves.append(((row, 4), (row, 6), None))
        if (me + "Q" in self.castling and b[0] == me + "R" and b[1] == b[2] == b[3] == "--"
                and not self.is_attacked(row, 3, enemy) and not self.is_attacked(row, 2, enemy)):
            moves.append(((row, 4), (row, 2), None))

    def legal_moves(self):
        """Pseudo-legal moves that don't leave the mover's own king attacked."""
        if self._legal is None:
            me, enemy = ("w", "b") if self.white_to_move else ("b", "w")
            snap = self._snapshot()
            legal = []
            for m in self._pseudo_legal():
                self._apply(m)
                kr, kc = self.find_king(me)
                if not self.is_attacked(kr, kc, enemy):
                    legal.append(m)
                self._restore(snap)
            self._legal = legal
        return self._legal

    def is_checkmate(self):
        return not self.legal_moves() and self.in_check()

    def is_stalemate(self):
        return not self.legal_moves() and not self.in_check()

    # ---- making / undoing moves ----
    def _snapshot(self):
        return ([row[:] for row in self.board], self.white_to_move, set(self.castling), self.ep_square)

    def _restore(self, snap):
        board, self.white_to_move, castling, self.ep_square = snap
        self.board = [row[:] for row in board]
        self.castling = set(castling)
        self._legal = None

    def _apply(self, move):
        """Update the board for a move: capture, en passant, castling and promotion included."""
        (r1, c1), (r2, c2), promo = move
        board = self.board
        piece = board[r1][c1]
        color, kind = piece[0], piece[1]

        if kind == "p" and (r2, c2) == self.ep_square and c1 != c2:
            board[r1][c2] = "--"                           # en passant: remove the pawn beside us

        board[r1][c1] = "--"
        board[r2][c2] = color + promo if promo else piece

        if kind == "K" and abs(c2 - c1) == 2:              # castling: also move the rook
            if c2 > c1:
                board[r1][5], board[r1][7] = board[r1][7], "--"
            else:
                board[r1][3], board[r1][0] = board[r1][0], "--"

        self.ep_square = ((r1 + r2) // 2, c1) if kind == "p" and abs(r2 - r1) == 2 else None
        self.castling -= RIGHTS_LOST.get((r1, c1), set()) | RIGHTS_LOST.get((r2, c2), set())
        self.white_to_move = not self.white_to_move

    def make_move(self, move):
        self._undo.append(self._snapshot())
        self._apply(move)
        self.move_log.append(move)
        self._legal = None

    def undo_move(self):
        if self._undo:
            self._restore(self._undo.pop())
            self.move_log.pop()
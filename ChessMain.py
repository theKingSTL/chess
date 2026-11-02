import pygame as p
import ChessEngine

DIMENSION = 8
WIDTH = HEIGHT = 512
SQ_SIZE = HEIGHT // DIMENSION
MAX_FPS = 60
ANIM_MS = 220           # how long a move takes to slide, in milliseconds
IMAGES = {}


def load_images():
    pieces = ['bB', 'bK', 'bN', 'bp', 'bQ', 'bR', 'wB', 'wK', 'wN', 'wp', 'wQ', 'wR']
    for piece in pieces:
        IMAGES[piece] = p.transform.smoothscale(
            p.image.load("images/" + piece + ".svg"),
            (SQ_SIZE, SQ_SIZE))


def square_rect(r, c):
    return p.Rect(c * SQ_SIZE, r * SQ_SIZE, SQ_SIZE, SQ_SIZE)


# ------------------------------------------------------------- animation
def start_animation(gs, move):
    """Call BEFORE gs.make_move(move): records what is sliding where, and what gets captured."""
    (r1, c1), (r2, c2), _ = move
    board = gs.board
    piece = board[r1][c1]
    movers = [(piece, (r1, c1), (r2, c2))]           # (image code, from square, to square)
    captured = None                                  # (image code, square) stays until arrival

    if board[r2][c2] != "--":
        captured = (board[r2][c2], (r2, c2))
    elif piece[1] == "p" and c1 != c2:               # en passant: victim is beside, not on target
        captured = (board[r1][c2], (r1, c2))

    if piece[1] == "K" and abs(c2 - c1) == 2:        # castling: the rook slides too
        rook_from, rook_to = ((r1, 7), (r1, 5)) if c2 > c1 else ((r1, 0), (r1, 3))
        movers.append((piece[0] + "R", rook_from, rook_to))

    return {"movers": movers, "captured": captured, "start": p.time.get_ticks(), "t": 0.0}


# --------------------------------------------------------------- drawing
def draw_game_state(screen, gs, selected, targets, anim):
    draw_board(screen)
    if anim is None:
        draw_highlights(screen, gs, selected)
    draw_pieces(screen, gs.board, anim)
    draw_dots(screen, gs.board, targets)


def draw_board(screen):
    colors = [p.Color("white"), p.Color("gray")]
    for r in range(DIMENSION):
        for c in range(DIMENSION):
            color = colors[(r + c) % 2]
            p.draw.rect(screen, color, square_rect(r, c))


def draw_highlights(screen, gs, selected):
    overlay = p.Surface((SQ_SIZE, SQ_SIZE), p.SRCALPHA)
    if gs.in_check():                                # red square under the king in check
        overlay.fill((255, 0, 0, 130))
        screen.blit(overlay, square_rect(*gs.find_king("w" if gs.white_to_move else "b")))
    if selected is not None:                         # yellow square under the selected piece
        overlay.fill((255, 255, 0, 130))
        screen.blit(overlay, square_rect(*selected))


def draw_pieces(screen, board, anim):
    sliding_to = {to for _, _, to in anim["movers"]} if anim else set()
    for r in range(DIMENSION):
        for c in range(DIMENSION):
            piece = board[r][c]
            if piece != "--" and (r, c) not in sliding_to:
                screen.blit(IMAGES[piece], square_rect(r, c))

    if anim:
        if anim["captured"]:                         # victim stays until the mover arrives
            piece, (r, c) = anim["captured"]
            screen.blit(IMAGES[piece], square_rect(r, c))
        t = anim["t"]
        ease = t * t * (3 - 2 * t)                   # smooth start and stop
        for piece, frm, to in anim["movers"]:
            ax, ay = square_rect(*frm).topleft
            bx, by = square_rect(*to).topleft
            screen.blit(IMAGES[piece], (ax + (bx - ax) * ease, ay + (by - ay) * ease))


def draw_dots(screen, board, targets):
    """Dot on every square the selected piece can go to; a ring around pieces it can capture."""
    for r, c in targets:
        dot = p.Surface((SQ_SIZE, SQ_SIZE), p.SRCALPHA)
        center = (SQ_SIZE // 2, SQ_SIZE // 2)
        if board[r][c] != "--":                      # capture -> ring
            p.draw.circle(dot, (0, 0, 0, 90), center, SQ_SIZE // 2 - 2, 6)
        else:                                        # empty square -> filled dot
            p.draw.circle(dot, (0, 0, 0, 90), center, SQ_SIZE // 6)
        screen.blit(dot, square_rect(r, c))


def draw_message(screen, text):
    font = p.font.SysFont("Arial", 32, True)
    surf = font.render(text, True, p.Color("black"))
    rect = surf.get_rect(center=(WIDTH // 2, HEIGHT // 2))
    box = rect.inflate(40, 24)
    p.draw.rect(screen, p.Color("white"), box)
    p.draw.rect(screen, p.Color("black"), box, 3)
    screen.blit(surf, rect)


def game_over_text(gs):
    if gs.legal_moves():
        return None
    if gs.in_check():
        return "Checkmate! " + ("Black" if gs.white_to_move else "White") + " wins"
    return "Stalemate - draw"


# ------------------------------------------------------------------ main
def main():
    p.init()
    screen = p.display.set_mode((WIDTH, HEIGHT))
    p.display.set_caption("Chess  (Z = undo, R = restart)")
    clock = p.time.Clock()
    gs = ChessEngine.GameState()
    load_images()
    selected = None          # (row, col) of the clicked piece
    targets = set()          # (row, col) squares that piece can legally move to
    anim = None              # the move currently sliding, if any
    running = True
    while running:
        for e in p.event.get():
            if e.type == p.QUIT:
                running = False

            elif e.type == p.MOUSEBUTTONDOWN and anim is None and game_over_text(gs) is None:
                x, y = e.pos
                square = (y // SQ_SIZE, x // SQ_SIZE)
                if selected is not None and square in targets:
                    # promotions auto-queen: pick the Queen version of the move
                    move = next(m for m in gs.legal_moves()
                                if m[0] == selected and m[1] == square and m[2] in (None, "Q"))
                    anim = start_animation(gs, move)     # must come before make_move
                    gs.make_move(move)
                    selected, targets = None, set()
                elif gs.board[square[0]][square[1]][0] == ("w" if gs.white_to_move else "b"):
                    selected = square
                    targets = {m[1] for m in gs.legal_moves() if m[0] == square}
                else:
                    selected, targets = None, set()

            elif e.type == p.KEYDOWN:
                if e.key == p.K_z:                       # undo one move (instant)
                    gs.undo_move()
                    anim, selected, targets = None, None, set()
                elif e.key == p.K_r:                     # restart
                    gs = ChessEngine.GameState()
                    anim, selected, targets = None, None, set()

        if anim:                                         # advance the slide
            anim["t"] = min(1.0, (p.time.get_ticks() - anim["start"]) / ANIM_MS)
            if anim["t"] >= 1.0:
                anim = None

        draw_game_state(screen, gs, selected, targets, anim)
        msg = game_over_text(gs) if anim is None else None
        if msg:
            draw_message(screen, msg)
        clock.tick(MAX_FPS)
        p.display.flip()
    p.quit()


if __name__ == "__main__":
    main()
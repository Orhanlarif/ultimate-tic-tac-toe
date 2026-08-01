export type Player = "X" | "O";
export type Cell = Player | null;
export type BoardWinner = Player | "draw" | null;

/** Local board index 0-8 (row-major). */
export type BoardIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
/** Cell index within a local board 0-8 (row-major). */
export type CellIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface Move {
  board: BoardIndex;
  cell: CellIndex;
}

export type GameStatus = "in_progress" | "won" | "draw";

export interface GameState {
  /** 9 local boards, each with 9 cells. */
  boards: Cell[][];
  /** Winner of each local board. */
  boardWinners: BoardWinner[];
  currentPlayer: Player;
  /** Next required board, or null when any open board is allowed. */
  activeBoard: BoardIndex | null;
  status: GameStatus;
  winner: Player | null;
  moveCount: number;
  moves: Move[];
}

export interface ApplyMoveResult {
  ok: true;
  state: GameState;
  wonBoard: BoardIndex | null;
}

export interface ApplyMoveError {
  ok: false;
  error: string;
}

const WIN_LINES: readonly [CellIndex, CellIndex, CellIndex][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

export function emptyBoard(): Cell[] {
  return Array.from({ length: 9 }, () => null);
}

export function createGame(): GameState {
  return {
    boards: Array.from({ length: 9 }, () => emptyBoard()),
    boardWinners: Array.from({ length: 9 }, () => null),
    currentPlayer: "X",
    activeBoard: null,
    status: "in_progress",
    winner: null,
    moveCount: 0,
    moves: [],
  };
}

export function cloneState(state: GameState): GameState {
  return {
    boards: state.boards.map((b) => [...b]),
    boardWinners: [...state.boardWinners],
    currentPlayer: state.currentPlayer,
    activeBoard: state.activeBoard,
    status: state.status,
    winner: state.winner,
    moveCount: state.moveCount,
    moves: state.moves.map((m) => ({ ...m })),
  };
}

function isBoardIndex(n: number): n is BoardIndex {
  return Number.isInteger(n) && n >= 0 && n <= 8;
}

function isCellIndex(n: number): n is CellIndex {
  return Number.isInteger(n) && n >= 0 && n <= 8;
}

export function getLocalWinner(board: Cell[]): BoardWinner {
  for (const [a, b, c] of WIN_LINES) {
    const v = board[a];
    if (v && v === board[b] && v === board[c]) {
      return v;
    }
  }
  if (board.every((cell) => cell !== null)) {
    return "draw";
  }
  return null;
}

export function getMetaWinner(boardWinners: BoardWinner[]): BoardWinner {
  const meta: Cell[] = boardWinners.map((w) => (w === "X" || w === "O" ? w : null));
  for (const [a, b, c] of WIN_LINES) {
    const v = meta[a];
    if (v && v === meta[b] && v === meta[c]) {
      return v;
    }
  }
  if (boardWinners.every((w) => w !== null)) {
    return "draw";
  }
  return null;
}

export function isBoardPlayable(state: GameState, board: BoardIndex): boolean {
  return state.boardWinners[board] === null;
}

export function isLegalMove(state: GameState, move: Move): boolean {
  if (state.status !== "in_progress") return false;
  if (!isBoardIndex(move.board) || !isCellIndex(move.cell)) return false;
  if (!isBoardPlayable(state, move.board)) return false;
  if (state.activeBoard !== null && state.activeBoard !== move.board) return false;
  return state.boards[move.board]![move.cell] === null;
}

export function getLegalMoves(state: GameState): Move[] {
  if (state.status !== "in_progress") return [];

  const boards: BoardIndex[] =
    state.activeBoard !== null
      ? [state.activeBoard]
      : ([0, 1, 2, 3, 4, 5, 6, 7, 8] as BoardIndex[]);

  const moves: Move[] = [];
  for (const board of boards) {
    if (!isBoardPlayable(state, board)) continue;
    const local = state.boards[board]!;
    for (let cell = 0; cell < 9; cell++) {
      if (local[cell] === null) {
        moves.push({ board, cell: cell as CellIndex });
      }
    }
  }
  return moves;
}

function nextActiveBoard(state: GameState, sentTo: BoardIndex): BoardIndex | null {
  if (isBoardPlayable(state, sentTo)) {
    return sentTo;
  }
  return null;
}

export function applyMove(
  state: GameState,
  move: Move,
): ApplyMoveResult | ApplyMoveError {
  if (!isLegalMove(state, move)) {
    return { ok: false, error: "Illegal move" };
  }

  const next = cloneState(state);
  next.boards[move.board]![move.cell] = next.currentPlayer;
  next.moves.push({ board: move.board, cell: move.cell });
  next.moveCount += 1;

  let wonBoard: BoardIndex | null = null;
  const localResult = getLocalWinner(next.boards[move.board]!);
  if (localResult !== null) {
    next.boardWinners[move.board] = localResult;
    wonBoard = move.board;
  }

  const meta = getMetaWinner(next.boardWinners);
  if (meta === "X" || meta === "O") {
    next.status = "won";
    next.winner = meta;
    next.activeBoard = null;
  } else if (meta === "draw") {
    next.status = "draw";
    next.winner = null;
    next.activeBoard = null;
  } else {
    next.currentPlayer = next.currentPlayer === "X" ? "O" : "X";
    next.activeBoard = nextActiveBoard(next, move.cell);
  }

  return { ok: true, state: next, wonBoard };
}

export function applyMoves(moves: Move[]): ApplyMoveResult | ApplyMoveError {
  let state = createGame();
  let lastWon: BoardIndex | null = null;
  for (const move of moves) {
    const result = applyMove(state, move);
    if (!result.ok) return result;
    state = result.state;
    lastWon = result.wonBoard;
  }
  return { ok: true, state, wonBoard: lastWon };
}

export function serializeState(state: GameState): string {
  return JSON.stringify(state);
}

export function deserializeState(raw: string): GameState {
  const parsed = JSON.parse(raw) as GameState;
  return cloneState(parsed);
}

export function opponent(player: Player): Player {
  return player === "X" ? "O" : "X";
}

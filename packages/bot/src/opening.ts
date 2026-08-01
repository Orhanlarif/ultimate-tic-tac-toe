import type { GameState, Move } from "@uttt/game-engine";

/** Strong first-move candidates for empty board. */
const FIRST_MOVES: Move[] = [
  { board: 4, cell: 4 },
  { board: 4, cell: 0 },
  { board: 4, cell: 2 },
  { board: 4, cell: 6 },
  { board: 4, cell: 8 },
  { board: 0, cell: 4 },
  { board: 2, cell: 4 },
  { board: 6, cell: 4 },
  { board: 8, cell: 4 },
];

const CENTER_CORNER_REPLIES: Move[] = [
  { board: 4, cell: 0 },
  { board: 4, cell: 2 },
  { board: 4, cell: 6 },
  { board: 4, cell: 8 },
];

const CENTER_EDGE_REPLIES: Move[] = [
  { board: 4, cell: 1 },
  { board: 4, cell: 3 },
  { board: 4, cell: 5 },
  { board: 4, cell: 7 },
];

export interface OpeningOptions {
  /** Prefer the single strongest book move (Hard). */
  principal?: boolean;
}

/**
 * Returns an opening suggestion when the position is still in the tiny book,
 * otherwise null so search can take over.
 */
export function openingMove(
  state: GameState,
  rng: () => number,
  opts?: OpeningOptions,
): Move | null {
  const principal = opts?.principal ?? false;

  if (state.moveCount === 0) {
    if (principal) return { board: 4, cell: 4 };
    const weights = FIRST_MOVES.map((m) =>
      m.board === 4 && m.cell === 4 ? 3.2 : m.board === 4 ? 1.4 : 1,
    );
    return weightedPick(FIRST_MOVES, weights, rng);
  }

  // Reply when opponent opened dead-center and we must play in board 4.
  if (
    state.moveCount === 1 &&
    state.moves[0]?.board === 4 &&
    state.moves[0]?.cell === 4 &&
    state.activeBoard === 4
  ) {
    if (principal) return { board: 4, cell: 0 };
    // Prefer corners; keep a little edge variety.
    const replies = [...CENTER_CORNER_REPLIES, ...CENTER_EDGE_REPLIES];
    const weights = replies.map((m) =>
      CENTER_CORNER_REPLIES.some((c) => c.board === m.board && c.cell === m.cell)
        ? 2.2
        : 1,
    );
    return weightedPick(replies, weights, rng);
  }

  // Third-ply continuation after center → corner reply: send to that corner board.
  if (
    state.moveCount === 2 &&
    state.moves[0]?.board === 4 &&
    state.moves[0]?.cell === 4 &&
    state.moves[1]?.board === 4 &&
    CENTER_CORNER_REPLIES.some(
      (c) =>
        c.board === state.moves[1]!.board && c.cell === state.moves[1]!.cell,
    ) &&
    state.activeBoard === state.moves[1]!.cell
  ) {
    const target = state.moves[1]!.cell;
    const continueCenter: Move = { board: target, cell: 4 };
    if (principal) return continueCenter;
    const alts: Move[] = [
      continueCenter,
      { board: target, cell: 0 },
      { board: target, cell: 2 },
      { board: target, cell: 6 },
      { board: target, cell: 8 },
    ];
    const weights = [2.5, 1, 1, 1, 1];
    return weightedPick(alts, weights, rng);
  }

  return null;
}

function weightedPick(moves: Move[], weights: number[], rng: () => number): Move {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng() * total;
  for (let i = 0; i < moves.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return moves[i]!;
  }
  return moves[moves.length - 1]!;
}

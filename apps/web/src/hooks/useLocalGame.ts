"use client";

import {
  applyMove,
  applyMoves,
  createGame,
  type GameState,
  type Move,
} from "@uttt/game-engine";
import { useCallback, useMemo, useState } from "react";

export interface LocalScores {
  X: number;
  O: number;
  draw: number;
}

interface LocalGame {
  state: GameState;
  scores: LocalScores;
}

function finishedAs(state: GameState): keyof LocalScores | null {
  if (state.status === "won" && state.winner) return state.winner;
  if (state.status === "draw") return "draw";
  return null;
}

function bump(
  scores: LocalScores,
  key: keyof LocalScores,
  delta: number,
): LocalScores {
  const next: LocalScores = { ...scores };
  next[key] = Math.max(0, next[key] + delta);
  return next;
}

function freshGame(scores: LocalScores): LocalGame {
  return { state: createGame(), scores };
}

/**
 * Two players sharing one device. No seats and no clock: whoever is to move
 * owns the board, so the caller passes `state.currentPlayer` as `youAre`.
 */
export function useLocalGame() {
  const [game, setGame] = useState<LocalGame>(() =>
    freshGame({ X: 0, O: 0, draw: 0 }),
  );

  const play = useCallback((board: number, cell: number) => {
    setGame((prev) => {
      const result = applyMove(prev.state, {
        board: board as Move["board"],
        cell: cell as Move["cell"],
      });
      if (!result.ok) return prev;
      const finished = finishedAs(result.state);
      return {
        state: result.state,
        scores: finished ? bump(prev.scores, finished, 1) : prev.scores,
      };
    });
  }, []);

  const undo = useCallback(() => {
    setGame((prev) => {
      if (prev.state.moves.length === 0) return prev;
      const replay = applyMoves(prev.state.moves.slice(0, -1));
      if (!replay.ok) return prev;
      // Taking back the move that ended the game also takes back its scoreline.
      const finished = finishedAs(prev.state);
      return {
        state: replay.state,
        scores: finished ? bump(prev.scores, finished, -1) : prev.scores,
      };
    });
  }, []);

  const newGame = useCallback(() => {
    setGame((prev) => freshGame(prev.scores));
  }, []);

  const resetScores = useCallback(() => {
    setGame(() => freshGame({ X: 0, O: 0, draw: 0 }));
  }, []);

  const lastMove = useMemo(() => {
    const { moves } = game.state;
    return moves.length > 0 ? moves[moves.length - 1]! : null;
  }, [game.state]);

  return {
    state: game.state,
    scores: game.scores,
    lastMove,
    canUndo: game.state.moves.length > 0,
    hasScores: game.scores.X + game.scores.O + game.scores.draw > 0,
    play,
    undo,
    newGame,
    resetScores,
  };
}

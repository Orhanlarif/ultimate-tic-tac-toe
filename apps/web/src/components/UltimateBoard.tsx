"use client";

import type { BoardWinner, Cell, Player } from "@uttt/game-engine";
import { Mark } from "@/components/Marks";

interface Props {
  boards: Cell[][];
  boardWinners: BoardWinner[];
  activeBoard: number | null;
  currentPlayer: Player;
  youAre: Player;
  disabled: boolean;
  lastMove?: { board: number; cell: number } | null;
  showLegalHints?: boolean;
  onMove: (board: number, cell: number) => void;
}

export function UltimateBoard({
  boards,
  boardWinners,
  activeBoard,
  currentPlayer,
  youAre,
  disabled,
  lastMove,
  showLegalHints = false,
  onMove,
}: Props) {
  const myTurn = !disabled && currentPlayer === youAre;

  return (
    <div
      role="grid"
      aria-label="Ultimate Tic Tac Toe board"
      className="ultimate-board"
      data-free={activeBoard === null ? "true" : undefined}
    >
      {boards.map((local, bi) => {
        const winner = boardWinners[bi];
        const isActive =
          winner === null && (activeBoard === null || activeBoard === bi);
        const playable = myTurn && isActive;

        return (
          <div
            key={bi}
            role="group"
            aria-label={`Board ${bi + 1}${winner ? ` won by ${winner}` : ""}`}
            className={[
              "local-board",
              isActive ? "is-available" : "",
              playable ? "is-playable" : "",
              winner ? "is-finished" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {local.map((cell, ci) => {
              const isLast = lastMove?.board === bi && lastMove?.cell === ci;
              const canClick = playable && cell === null;
              const hint = showLegalHints && canClick;
              return (
                <button
                  key={ci}
                  type="button"
                  disabled={!canClick}
                  aria-label={`Cell ${ci + 1}${cell ? ` ${cell}` : hint ? " legal" : ""}`}
                  onClick={() => onMove(bi, ci)}
                  className={[
                    "board-cell",
                    cell === "X" ? "cell-x" : "",
                    cell === "O" ? "cell-o" : "",
                    canClick ? "can-play" : "",
                    isLast ? "is-last" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {cell ? <Mark player={cell} /> : null}
                  {hint && !cell && <span aria-hidden className="legal-hint" />}
                </button>
              );
            })}
            {winner && winner !== "draw" && (
              <div
                aria-hidden
                className={`board-result ${winner === "X" ? "result-x" : "result-o"}`}
              >
                <Mark player={winner} />
              </div>
            )}
            {winner === "draw" && (
              <div aria-hidden className="board-result result-draw">
                =
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

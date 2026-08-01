"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { UltimateBoard } from "@/components/UltimateBoard";
import { useLocalGame } from "@/hooks/useLocalGame";

export default function LocalPlayPage() {
  const t = useTranslations("play");
  const {
    state,
    scores,
    lastMove,
    canUndo,
    hasScores,
    play,
    undo,
    newGame,
    resetScores,
  } = useLocalGame();

  const ended = state.status !== "in_progress";
  const heading = !ended
    ? t(state.currentPlayer === "X" ? "localTurnX" : "localTurnO")
    : state.winner
      ? t("localWinner", { player: state.winner })
      : t("draw");

  return (
    <div className="game-page">
      <div className="game-header">
        <div className="game-header-copy">
          <div className="badge badge-warn">{t("localBadge")}</div>
          <h1 className={state.currentPlayer === "X" ? "turn-x" : "turn-o"}>
            {heading}
          </h1>
          <p className="muted page-subtitle">
            {ended ? t("localEndedHint") : t("localPassHint")}
          </p>
        </div>
        <div className="game-actions">
          {ended ? (
            <button className="btn btn-primary" type="button" onClick={newGame}>
              {t("newGame")}
            </button>
          ) : (
            <button
              className="btn btn-ghost"
              type="button"
              onClick={undo}
              disabled={!canUndo}
            >
              {t("undo")}
            </button>
          )}
          {!ended && canUndo && (
            <button className="btn btn-ghost" type="button" onClick={newGame}>
              {t("newGame")}
            </button>
          )}
          <Link className="btn btn-ghost" href="/">
            {t("backHome")}
          </Link>
        </div>
      </div>

      <div className="game-stage">
        <div className="scoreboard" role="status" aria-label={t("scoreTitle")}>
          <span className="scoreboard-title">{t("scoreTitle")}</span>
          <div className="scoreboard-grid">
            <div
              className="score-cell is-x"
              aria-label={`${t("scoreWins", { player: "X" })}: ${scores.X}`}
            >
              <span className="score-cell-label" aria-hidden>
                X
              </span>
              <span className="score-cell-value" aria-hidden>
                {scores.X}
              </span>
            </div>
            <div
              className="score-cell"
              aria-label={`${t("scoreDraws")}: ${scores.draw}`}
            >
              <span className="score-cell-label" aria-hidden>
                {t("scoreDraws")}
              </span>
              <span className="score-cell-value" aria-hidden>
                {scores.draw}
              </span>
            </div>
            <div
              className="score-cell is-o"
              aria-label={`${t("scoreWins", { player: "O" })}: ${scores.O}`}
            >
              <span className="score-cell-label" aria-hidden>
                O
              </span>
              <span className="score-cell-value" aria-hidden>
                {scores.O}
              </span>
            </div>
          </div>
          {hasScores && (
            <button
              className="scoreboard-reset"
              type="button"
              onClick={resetScores}
            >
              {t("resetScores")}
            </button>
          )}
        </div>

        <p className="muted active-board-label">
          {t("activeBoard")}:{" "}
          {state.activeBoard === null ? t("anyBoard") : `#${state.activeBoard + 1}`}
        </p>

        <UltimateBoard
          boards={state.boards}
          boardWinners={state.boardWinners}
          activeBoard={state.activeBoard}
          currentPlayer={state.currentPlayer}
          youAre={state.currentPlayer}
          disabled={ended}
          lastMove={lastMove}
          showLegalHints
          onMove={play}
        />
      </div>
    </div>
  );
}

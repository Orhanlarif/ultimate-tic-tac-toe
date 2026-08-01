"use client";

import type { Difficulty } from "@uttt/bot";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { IconShuffle } from "@/components/icons";
import { Mark } from "@/components/Marks";
import { UltimateBoard } from "@/components/UltimateBoard";
import { useBotGame, type SeatChoice } from "@/hooks/useBotGame";

const SEAT_CHOICES = [
  { value: "random", label: "seatRandom", hint: "seatRandomHint" },
  { value: "X", label: "seatX", hint: "seatXHint" },
  { value: "O", label: "seatO", hint: "seatOHint" },
] as const satisfies ReadonlyArray<{
  value: SeatChoice;
  label: string;
  hint: string;
}>;

export default function BotPlayPage() {
  const t = useTranslations("play");
  const {
    phase,
    difficulty,
    setDifficulty,
    seatChoice,
    setSeatChoice,
    youAre,
    state,
    lastMove,
    endedReason,
    start,
    rematch,
    resign,
    backToSetup,
    onMove,
  } = useBotGame();

  const resultTitle =
    state.status === "draw" || !state.winner
      ? t("draw")
      : state.winner === youAre
        ? t("youWin")
        : t("youLose");

  const endReasonLabel =
    endedReason === "resign"
      ? t("reasonResign")
      : endedReason === "normal"
        ? t("reasonNormal")
        : null;

  if (phase === "setup") {
    return (
      <div className="card setup-card">
        <h1>{t("botTitle")}</h1>
        <p className="muted">{t("botIntro")}</p>

        <div className="form-field">
          <span>{t("difficulty")}</span>
          <div className="difficulty-picker" role="radiogroup" aria-label={t("difficulty")}>
            {(
              [
                ["easy", "easyHint"],
                ["medium", "mediumHint"],
                ["hard", "hardHint"],
              ] as const
            ).map(([value, hint]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={difficulty === value}
                className={`difficulty-option level-${value} ${difficulty === value ? "is-selected" : ""}`}
                onClick={() => setDifficulty(value as Difficulty)}
              >
                <strong>{t(value)}</strong>
                <span>{t(hint)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="form-field">
          <span>{t("youPlayAs")}</span>
          <div className="seat-picker" role="radiogroup" aria-label={t("youPlayAs")}>
            {SEAT_CHOICES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={seatChoice === value}
                aria-label={t(label)}
                title={t(label)}
                className={`seat-option ${seatChoice === value ? "is-selected" : ""}`}
                onClick={() => setSeatChoice(value)}
              >
                {value === "random" ? (
                  <span className="seat-shuffle" aria-hidden="true">
                    <IconShuffle />
                  </span>
                ) : (
                  <Mark player={value} />
                )}
              </button>
            ))}
          </div>
          <span className="form-hint">
            {t(SEAT_CHOICES.find((s) => s.value === seatChoice)!.hint)}
          </span>
        </div>

        <button className="btn btn-primary btn-lg" type="button" onClick={() => start()}>
          {t("startBot")}
        </button>
        <Link className="btn btn-ghost" href="/">
          {t("backHome")}
        </Link>
      </div>
    );
  }

  return (
    <div className="game-page">
      <div className="game-header">
        <div className="game-header-copy">
          <h1>
            {phase === "ended"
              ? resultTitle
              : phase === "bot_thinking"
                ? t("botThinking")
                : state.currentPlayer === youAre
                  ? t("yourTurn")
                  : t("botThinking")}
          </h1>
          {phase === "ended" && endReasonLabel && (
            <p className="muted page-subtitle">{endReasonLabel}</p>
          )}
        </div>
        <div className="game-actions">
          {(phase === "playing" || phase === "bot_thinking") && (
            <button className="btn btn-danger" type="button" onClick={resign}>
              {t("resign")}
            </button>
          )}
          {phase === "ended" && (
            <>
              <button className="btn btn-primary" type="button" onClick={rematch}>
                {t("rematch")}
              </button>
              <button className="btn btn-ghost" type="button" onClick={backToSetup}>
                {t("changeDifficulty")}
              </button>
              <Link className="btn btn-ghost" href="/">
                {t("backHome")}
              </Link>
            </>
          )}
        </div>
      </div>

      <div className="game-stage">
        <p className="muted active-board-label">
          {t("activeBoard")}:{" "}
          {state.activeBoard === null ? t("anyBoard") : `#${state.activeBoard + 1}`}
        </p>

        <UltimateBoard
          boards={state.boards}
          boardWinners={state.boardWinners}
          activeBoard={state.activeBoard}
          currentPlayer={state.currentPlayer}
          youAre={youAre}
          disabled={phase !== "playing"}
          lastMove={lastMove}
          showLegalHints
          onMove={onMove}
        />
      </div>
    </div>
  );
}

"use client";

import type { QueueMode } from "@uttt/contracts";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";
import { ClockBar } from "@/components/ClockBar";
import { PlayerAvatar } from "@/components/Marks";
import { UltimateBoard } from "@/components/UltimateBoard";
import { useOnlinePlay } from "@/hooks/useOnlinePlay";

function PlayInner() {
  const t = useTranslations("play");
  const a = useTranslations("app");
  const params = useSearchParams();
  const router = useRouter();
  const mode = (params.get("mode") === "ranked" ? "ranked" : "casual") as QueueMode;

  const {
    phase,
    error,
    match,
    ratingDelta,
    isGuest,
    serverOffsetMs,
    start,
    onMove,
    resign,
    cancelQueue,
  } = useOnlinePlay(mode);

  const lastMove = useMemo(() => {
    if (!match?.moves.length) return null;
    return match.moves[match.moves.length - 1]!;
  }, [match]);

  const resultTitle = useMemo(() => {
    if (!match || match.status === "in_progress") return null;
    if (match.status === "draw" || !match.winner) return t("draw");
    return match.winner === match.youAre ? t("youWin") : t("youLose");
  }, [match, t]);

  const endReasonLabel = useMemo(() => {
    if (!match?.endedReason) return null;
    switch (match.endedReason) {
      case "resign":
        return t("reasonResign");
      case "timeout":
        return t("reasonTimeout");
      case "disconnect":
        return t("reasonDisconnect");
      default:
        return t("reasonNormal");
    }
  }, [match?.endedReason, t]);

  const errorText =
    error === "guestCasualOnly"
      ? t("guestCasualOnly")
      : error === "reconnect"
        ? t("reconnect")
        : error;

  function handleCancel() {
    cancelQueue();
    router.push("/");
  }

  return (
    <div className="game-page">
      <div className="game-header">
        <div className="game-header-copy">
          {mode === "ranked" && (
            <div className="badge badge-x">{t("rankedBadge")}</div>
          )}
          <h1>
            {phase === "queued" || phase === "connecting"
              ? t("searching")
              : phase === "ended"
                ? resultTitle
                : match?.currentPlayer === match?.youAre
                  ? t("yourTurn")
                  : t("opponentTurn")}
          </h1>
          {phase === "ended" && endReasonLabel && (
            <p className="muted page-subtitle">{endReasonLabel}</p>
          )}
        </div>
        <div className="game-actions">
          {(phase === "queued" || phase === "connecting") && (
            <button className="btn btn-ghost" type="button" onClick={handleCancel}>
              {t("cancel")}
            </button>
          )}
          {phase === "playing" && (
            <button className="btn btn-danger" type="button" onClick={resign}>
              {t("resign")}
            </button>
          )}
          {phase === "ended" && (
            <>
              <button className="btn btn-primary" type="button" onClick={() => void start()}>
                {t("findNewMatch")}
              </button>
              <Link className="btn btn-ghost" href="/">
                {t("backHome")}
              </Link>
            </>
          )}
          {phase === "error" && (
            <button className="btn btn-primary" type="button" onClick={() => void start()}>
              {t("findNewMatch")}
            </button>
          )}
        </div>
      </div>

      {errorText && (
        <div className="card card-error">
          {errorText}
          {isGuest && mode === "ranked" && (
            <div style={{ marginTop: "0.75rem" }}>
              <Link className="btn btn-primary" href="/login?next=/play?mode=ranked">
                {a("signIn")}
              </Link>
            </div>
          )}
        </div>
      )}

      {match && (
        <>
          <div className="players-bar">
            <div
              className={`player-chip is-x ${match.currentPlayer === "X" ? "is-active" : ""}`}
            >
              <PlayerAvatar name={match.players.X.displayName} player="X" />
              <div className="player-chip-meta">
                <strong>{match.players.X.displayName}</strong>
                <span>
                  X
                  {match.players.X.rating != null ? ` · ${match.players.X.rating}` : ""}
                  {match.youAre === "X" ? ` · ${t("youLabel")}` : ""}
                </span>
              </div>
            </div>
            <span className="vs-pill">VS</span>
            <div
              className={`player-chip is-o ${match.currentPlayer === "O" ? "is-active" : ""}`}
            >
              <PlayerAvatar name={match.players.O.displayName} player="O" />
              <div className="player-chip-meta">
                <strong>{match.players.O.displayName}</strong>
                <span>
                  O
                  {match.players.O.rating != null ? ` · ${match.players.O.rating}` : ""}
                  {match.youAre === "O" ? ` · ${t("youLabel")}` : ""}
                </span>
              </div>
            </div>
          </div>

          <ClockBar
            clock={match.clock}
            youAre={match.youAre}
            serverOffsetMs={serverOffsetMs}
          />

          <div className="game-stage">
            <p className="muted active-board-label">
              {t("activeBoard")}:{" "}
              {match.activeBoard === null ? t("anyBoard") : `#${match.activeBoard + 1}`}
            </p>

            <UltimateBoard
              boards={match.boards}
              boardWinners={match.boardWinners}
              activeBoard={match.activeBoard}
              currentPlayer={match.currentPlayer}
              youAre={match.youAre}
              disabled={phase !== "playing"}
              lastMove={lastMove}
              showLegalHints
              onMove={onMove}
            />
          </div>

          {ratingDelta && (
            <div className="card rating-delta">
              {t("ratingChange")}: {ratingDelta.before} → {ratingDelta.after} (
              {ratingDelta.after - ratingDelta.before >= 0 ? "+" : ""}
              {ratingDelta.after - ratingDelta.before})
            </div>
          )}
        </>
      )}

      {(phase === "queued" || phase === "connecting") && !match && (
        <div className="card queue-card">
          <div className="spinner" aria-hidden />
          <p>{t("searching")}</p>
        </div>
      )}
    </div>
  );
}

export default function PlayPage() {
  return (
    <Suspense fallback={<div className="card queue-card"><div className="spinner" /></div>}>
      <PlayInner />
    </Suspense>
  );
}

"use client";

import { ROOM_CODE_LENGTH } from "@uttt/contracts";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ClockBar } from "@/components/ClockBar";
import { PlayerAvatar } from "@/components/Marks";
import { UltimateBoard } from "@/components/UltimateBoard";
import { useRoom } from "@/hooks/useRoom";

function inviteUrl(code: string): string {
  if (typeof window === "undefined") return `/play/room/${code}`;
  return `${window.location.origin}/play/room/${code}`;
}

export function RoomLobby({
  autoCreate = false,
  joinCode = null,
}: {
  autoCreate?: boolean;
  joinCode?: string | null;
}) {
  const t = useTranslations("play");
  const router = useRouter();
  const [codeInput, setCodeInput] = useState(joinCode ?? "");
  const [copied, setCopied] = useState(false);

  const {
    phase,
    error,
    room,
    match,
    serverOffsetMs,
    create,
    leave,
    rematch,
    onMove,
    resign,
  } = useRoom({ autoCreate, joinCode });

  // Put the code in the address bar so the tab is refreshable and shareable.
  // A router navigation would swap /play/room for /play/room/[code], remounting
  // this component and dropping the socket the room was just created on.
  useEffect(() => {
    if (!room) return;
    const target = `/play/room/${room.code}`;
    if (window.location.pathname !== target) {
      window.history.replaceState(null, "", target);
    }
  }, [room]);

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

  const errorText = useMemo(() => {
    if (!error) return null;
    switch (error) {
      case "ROOM_NOT_FOUND":
        return t("roomNotFound");
      case "ROOM_FULL":
        return t("roomFull");
      case "ROOM_BUSY":
        return t("roomBusy");
      case "ROOM_UNAVAILABLE":
        return t("roomUnavailable");
      case "BAD_REQUEST":
        return t("roomBadCode");
      case "roomExpired":
        return t("roomExpired");
      case "roomLeft":
        return t("roomLeft");
      case "reconnect":
        return t("reconnect");
      default:
        return error;
    }
  }, [error, t]);

  const youReady =
    room &&
    (room.youAre === "host"
      ? room.host.wantsRematch
      : room.guest?.wantsRematch);
  const themReady =
    room &&
    (room.youAre === "host"
      ? room.guest?.wantsRematch
      : room.host.wantsRematch);

  const hostLabel =
    room?.youAre === "host"
      ? t("roomYou")
      : (room?.host.player.displayName ?? t("roomHost"));
  const guestLabel =
    room?.youAre === "guest"
      ? t("roomYou")
      : (room?.guest?.player.displayName ?? t("roomGuest"));

  async function copyInvite() {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(inviteUrl(room.code));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // The code itself is still visible.
    }
  }

  async function shareInvite() {
    if (!room) return;
    const url = inviteUrl(room.code);
    if (navigator.share) {
      try {
        await navigator.share({
          title: t("roomShareTitle"),
          text: t("roomShareBody", { code: room.code }),
          url,
        });
        return;
      } catch {
        // Cancelled or unsupported — fall back to copy.
      }
    }
    await copyInvite();
  }

  function handleLeave() {
    leave();
    router.replace("/play/room");
  }

  function handleJoinSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = codeInput.trim().toUpperCase();
    if (code.length !== ROOM_CODE_LENGTH) return;
    router.replace(`/play/room/${code}`);
  }

  if (
    phase === "idle" ||
    (phase === "connecting" && !room && !autoCreate && !joinCode)
  ) {
    return (
      <div className="card setup-card">
        <h1>{t("roomTitle")}</h1>
        <p className="muted">{t("roomIntro")}</p>
        {errorText && <p style={{ color: "var(--danger)", margin: 0 }}>{errorText}</p>}
        <button
          className="btn btn-primary btn-lg"
          type="button"
          onClick={() => void create()}
          disabled={phase === "connecting"}
        >
          {t("roomCreate")}
        </button>
        <hr className="divider" />
        <form className="room-join-form" onSubmit={handleJoinSubmit}>
          <label className="form-field">
            <span>{t("roomEnterCode")}</span>
            <input
              className="input room-code-input"
              value={codeInput}
              onChange={(e) =>
                setCodeInput(
                  e.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, "")
                    .slice(0, ROOM_CODE_LENGTH),
                )
              }
              placeholder={t("roomCodePlaceholder")}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={ROOM_CODE_LENGTH}
              inputMode="text"
            />
          </label>
          <button
            className="btn btn-secondary"
            type="submit"
            disabled={codeInput.length !== ROOM_CODE_LENGTH}
          >
            {t("roomJoin")}
          </button>
        </form>
        <Link className="btn btn-ghost" href="/">
          {t("backHome")}
        </Link>
      </div>
    );
  }

  if (phase === "connecting" && !room) {
    return (
      <div className="card setup-card queue-card">
        <div className="spinner" aria-hidden />
        <p>{t("roomConnecting")}</p>
      </div>
    );
  }

  if (phase === "closed" || phase === "error") {
    return (
      <div className="card setup-card">
        <h1>{t("roomTitle")}</h1>
        {errorText && <p style={{ color: "var(--danger)", margin: 0 }}>{errorText}</p>}
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => void create()}
        >
          {t("roomCreate")}
        </button>
        <Link className="btn btn-ghost" href="/play/room">
          {t("roomBack")}
        </Link>
        <Link className="btn btn-ghost" href="/">
          {t("backHome")}
        </Link>
      </div>
    );
  }

  if ((phase === "lobby" || phase === "ended") && room) {
    const waitingForGuest = !room.guest;
    const played = room.score.host + room.score.guest + room.score.draw;

    return (
      <div className="game-page">
        <div className="game-header">
          <div className="game-header-copy">
            <div className="badge badge-o">{t("roomBadge")}</div>
            <h1>
              {phase === "ended"
                ? resultTitle
                : waitingForGuest
                  ? t("roomWaiting")
                  : played === 0
                    ? t("roomStarting")
                    : t("roomReadyTitle")}
            </h1>
            {phase === "ended" && endReasonLabel && (
              <p className="muted page-subtitle">{endReasonLabel}</p>
            )}
          </div>
          <div className="game-actions">
            {/*
              Only the first game auto-starts, so anyone sitting in an idle room
              with an opponent needs this button — not just the pair that has
              a result on screen.
            */}
            {room.guest && (
              <button
                className={youReady ? "btn btn-secondary" : "btn btn-primary"}
                type="button"
                onClick={rematch}
              >
                {youReady ? t("roomReadyCancel") : t("roomReady")}
              </button>
            )}
            <button className="btn btn-ghost" type="button" onClick={handleLeave}>
              {t("roomLeave")}
            </button>
          </div>
        </div>

        {errorText && <div className="card card-error">{errorText}</div>}

        <div className="card room-panel">
          <div className="room-code-block">
            <span className="muted">{t("roomCodeLabel")}</span>
            <strong className="room-code">{room.code}</strong>
            <div className="game-actions">
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => void shareInvite()}
              >
                {t("roomShare")}
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => void copyInvite()}
              >
                {copied ? t("roomCopied") : t("roomCopyLink")}
              </button>
            </div>
          </div>

          <div className="room-members">
            <div className="room-member">
              <span className="badge">{t("roomHost")}</span>
              <div className="room-member-row">
                <PlayerAvatar name={room.host.player.displayName} />
                <div>
                  <strong>{room.host.player.displayName}</strong>
                  <div className="muted" style={{ fontSize: "0.85rem" }}>
                    {room.host.online ? t("roomOnline") : t("roomOffline")}
                    {room.host.wantsRematch ? ` · ${t("roomIsReady")}` : ""}
                  </div>
                </div>
              </div>
            </div>
            <div className="room-member">
              <span className="badge">{t("roomGuest")}</span>
              {room.guest ? (
                <div className="room-member-row">
                  <PlayerAvatar name={room.guest.player.displayName} />
                  <div>
                    <strong>{room.guest.player.displayName}</strong>
                    <div className="muted" style={{ fontSize: "0.85rem" }}>
                      {room.guest.online ? t("roomOnline") : t("roomOffline")}
                      {room.guest.wantsRematch ? ` · ${t("roomIsReady")}` : ""}
                    </div>
                  </div>
                </div>
              ) : (
                <span className="muted">{t("roomGuestEmpty")}</span>
              )}
            </div>
          </div>

          <div className="scoreboard" role="status" aria-label={t("scoreTitle")}>
            <span className="scoreboard-title">{t("scoreTitle")}</span>
            <div className="scoreboard-grid">
              <div
                className={`score-cell ${room.youAre === "host" ? "is-you" : ""}`}
                aria-label={`${hostLabel}: ${room.score.host}`}
              >
                <span className="score-cell-label" aria-hidden>
                  {hostLabel}
                </span>
                <span className="score-cell-value" aria-hidden>
                  {room.score.host}
                </span>
              </div>
              <div
                className="score-cell"
                aria-label={`${t("scoreDraws")}: ${room.score.draw}`}
              >
                <span className="score-cell-label" aria-hidden>
                  {t("scoreDraws")}
                </span>
                <span className="score-cell-value" aria-hidden>
                  {room.score.draw}
                </span>
              </div>
              <div
                className={`score-cell ${room.youAre === "guest" ? "is-you" : ""}`}
                aria-label={`${guestLabel}: ${room.score.guest}`}
              >
                <span className="score-cell-label" aria-hidden>
                  {guestLabel}
                </span>
                <span className="score-cell-value" aria-hidden>
                  {room.score.guest}
                </span>
              </div>
            </div>
          </div>

          {room.guest && (
            <p className="muted room-hint">
              {played === 0 && phase !== "ended"
                ? t("roomFirstGameHint")
                : youReady && themReady
                  ? t("roomStarting")
                  : youReady
                    ? t("roomWaitingThem")
                    : themReady
                      ? t("roomTheyReady")
                      : t("roomRematchHint")}
            </p>
          )}
        </div>

        {match && phase === "ended" && (
          <div className="game-stage">
            <UltimateBoard
              boards={match.boards}
              boardWinners={match.boardWinners}
              activeBoard={match.activeBoard}
              currentPlayer={match.currentPlayer}
              youAre={match.youAre}
              disabled
              lastMove={lastMove}
              onMove={() => {}}
            />
          </div>
        )}
      </div>
    );
  }

  if (match && room) {
    return (
      <div className="game-page">
        <div className="game-header">
          <div className="game-header-copy">
            <div className="badge badge-o">
              {t("roomBadge")} · {room.code}
            </div>
            <h1>
              {phase === "ended"
                ? resultTitle
                : match.currentPlayer === match.youAre
                  ? t("yourTurn")
                  : t("opponentTurn")}
            </h1>
          </div>
          <div className="game-actions">
            {phase === "playing" && (
              <button className="btn btn-danger" type="button" onClick={resign}>
                {t("resign")}
              </button>
            )}
            <button className="btn btn-ghost" type="button" onClick={handleLeave}>
              {t("roomLeave")}
            </button>
          </div>
        </div>

        {errorText && <div className="card card-error">{errorText}</div>}

        <div className="players-bar">
          <div
            className={`player-chip is-x ${match.currentPlayer === "X" ? "is-active" : ""}`}
          >
            <PlayerAvatar name={match.players.X.displayName} player="X" />
            <div className="player-chip-meta">
              <strong>{match.players.X.displayName}</strong>
              <span>
                X{match.youAre === "X" ? ` · ${t("youLabel")}` : ""}
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
                O{match.youAre === "O" ? ` · ${t("youLabel")}` : ""}
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
            {match.activeBoard === null
              ? t("anyBoard")
              : `#${match.activeBoard + 1}`}
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
      </div>
    );
  }

  return (
    <div className="card setup-card queue-card">
      <div className="spinner" aria-hidden />
      <p>{t("roomConnecting")}</p>
    </div>
  );
}

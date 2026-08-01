import type {
  ClockState,
  EndReason,
  MatchMode,
  MatchSnapshot,
  PublicPlayer,
} from "@uttt/contracts";
import { DISCONNECT_GRACE_MS } from "@uttt/contracts";
import {
  applyMove,
  createGame,
  type GameState,
  type Move,
  type Player,
} from "@uttt/game-engine";
import { v4 as uuid } from "uuid";
import {
  afterMove,
  createClock,
  freezeClock,
  startClock,
  tickClock,
} from "./clock.js";
import type { MatchPlayer } from "./queue.js";
import { toPublicPlayer } from "./queue.js";

export interface LiveMatch {
  id: string;
  mode: MatchMode;
  players: { X: MatchPlayer; O: MatchPlayer };
  sockets: { X: string; O: string };
  state: GameState;
  clock: ClockState;
  endedReason?: EndReason;
  disconnectDeadline: { X: number | null; O: number | null };
  ratingApplied: boolean;
  clockStarted: boolean;
}

export class MatchManager {
  private matches = new Map<string, LiveMatch>();
  private byUser = new Map<string, string>();

  /**
   * `seatForA` pins the first player to a seat; rooms use it to alternate who
   * starts. Omitting it flips a coin, which is what matchmaking wants.
   * The mode defaults to the unrated side on purpose.
   */
  create(
    a: MatchPlayer,
    b: MatchPlayer,
    mode: MatchMode = "casual",
    seatForA?: Player,
  ): LiveMatch {
    const xFirst = seatForA ? seatForA === "X" : Math.random() < 0.5;
    const playerX = xFirst ? a : b;
    const playerO = xFirst ? b : a;
    const match: LiveMatch = {
      id: uuid(),
      mode,
      players: { X: playerX, O: playerO },
      sockets: { X: playerX.socketId, O: playerO.socketId },
      state: createGame(),
      clock: createClock(true),
      disconnectDeadline: { X: null, O: null },
      ratingApplied: false,
      clockStarted: false,
    };
    this.matches.set(match.id, match);
    this.byUser.set(playerX.userId, match.id);
    this.byUser.set(playerO.userId, match.id);
    return match;
  }

  /** Start the match clock when both players have been notified. */
  beginClock(match: LiveMatch, now = Date.now()): void {
    if (match.clockStarted || match.state.status !== "in_progress") return;
    match.clock = startClock(match.clock, now);
    match.clockStarted = true;
  }

  get(matchId: string): LiveMatch | undefined {
    return this.matches.get(matchId);
  }

  getByUser(userId: string): LiveMatch | undefined {
    const id = this.byUser.get(userId);
    return id ? this.matches.get(id) : undefined;
  }

  /**
   * A finished match stays addressable for a while so late reconnects can still
   * read the result. Anything that asks "is this player busy?" must ignore
   * those, otherwise a player is locked out of a new room or queue until the
   * corpse is collected.
   */
  getLiveByUser(userId: string): LiveMatch | undefined {
    const match = this.getByUser(userId);
    return match?.state.status === "in_progress" ? match : undefined;
  }

  seatOf(match: LiveMatch, userId: string): Player | null {
    if (match.players.X.userId === userId) return "X";
    if (match.players.O.userId === userId) return "O";
    return null;
  }

  snapshot(match: LiveMatch, forUserId: string): MatchSnapshot {
    const youAre = this.seatOf(match, forUserId) ?? "X";
    const { clock } = tickClock(match.clock);
    return {
      matchId: match.id,
      mode: match.mode,
      youAre,
      players: {
        X: toPublicPlayer(match.players.X),
        O: toPublicPlayer(match.players.O),
      },
      boards: match.state.boards,
      boardWinners: match.state.boardWinners,
      currentPlayer: match.state.currentPlayer,
      activeBoard: match.state.activeBoard,
      status: match.state.status,
      winner: match.state.winner,
      moveCount: match.state.moveCount,
      moves: match.state.moves,
      clock,
      endedReason: match.endedReason,
    };
  }

  playMove(
    matchId: string,
    userId: string,
    moveNumber: number,
    move: Move,
  ): { ok: true; match: LiveMatch } | { ok: false; error: string } {
    const match = this.matches.get(matchId);
    if (!match) return { ok: false, error: "Match not found" };
    if (match.state.status !== "in_progress") {
      return { ok: false, error: "Match already ended" };
    }

    const seat = this.seatOf(match, userId);
    if (!seat) return { ok: false, error: "Not a player" };
    if (seat !== match.state.currentPlayer) {
      return { ok: false, error: "Not your turn" };
    }
    if (moveNumber !== match.state.moveCount + 1) {
      return { ok: false, error: "Stale move number" };
    }

    if (!match.clockStarted) {
      this.beginClock(match);
    }

    const { clock, timedOut } = tickClock(match.clock);
    match.clock = clock;
    if (timedOut) {
      this.end(match, timedOut === "X" ? "O" : "X", "timeout");
      return { ok: true, match };
    }

    const result = applyMove(match.state, move);
    if (!result.ok) return { ok: false, error: result.error };

    match.state = result.state;
    if (result.state.status === "in_progress") {
      match.clock = afterMove(match.clock, result.state.currentPlayer);
    } else {
      this.end(match, result.state.winner, "normal");
    }
    return { ok: true, match };
  }

  resign(matchId: string, userId: string): LiveMatch | null {
    const match = this.matches.get(matchId);
    if (!match || match.state.status !== "in_progress") return null;
    const seat = this.seatOf(match, userId);
    if (!seat) return null;
    const winner = seat === "X" ? "O" : "X";
    this.end(match, winner, "resign");
    return match;
  }

  /**
   * Only the authoritative seat socket may start a disconnect forfeit timer.
   * Stale/orphan sockets are ignored.
   */
  onDisconnect(
    userId: string,
    socketId: string,
    now = Date.now(),
  ): LiveMatch | null {
    const match = this.getByUser(userId);
    if (!match || match.state.status !== "in_progress") return null;
    const seat = this.seatOf(match, userId);
    if (!seat) return null;
    if (match.sockets[seat] !== socketId) {
      return null;
    }
    match.disconnectDeadline[seat] = now + DISCONNECT_GRACE_MS;
    return match;
  }

  onReconnect(userId: string, socketId: string): LiveMatch | null {
    const match = this.getByUser(userId);
    if (!match) return null;
    const seat = this.seatOf(match, userId);
    if (!seat) return null;
    match.sockets[seat] = socketId;
    match.disconnectDeadline[seat] = null;
    return match;
  }

  /** Check disconnect deadlines and timeouts; returns ended matches. */
  sweep(now = Date.now()): LiveMatch[] {
    const ended: LiveMatch[] = [];
    for (const match of this.matches.values()) {
      if (match.state.status !== "in_progress") continue;

      for (const seat of ["X", "O"] as const) {
        const dl = match.disconnectDeadline[seat];
        if (dl && now >= dl) {
          this.end(match, seat === "X" ? "O" : "X", "disconnect");
          ended.push(match);
          break;
        }
      }
      if (match.state.status !== "in_progress") continue;

      if (!match.clockStarted) continue;

      const { clock, timedOut } = tickClock(match.clock, now);
      match.clock = clock;
      if (timedOut) {
        this.end(match, timedOut === "X" ? "O" : "X", "timeout");
        ended.push(match);
      }
    }
    return ended;
  }

  end(match: LiveMatch, winner: Player | null, reason: EndReason): void {
    if (match.state.status !== "in_progress" && match.endedReason) return;
    match.state = {
      ...match.state,
      status: winner ? "won" : "draw",
      winner,
    };
    match.endedReason = reason;
    match.clock = freezeClock(match.clock);
  }

  remove(matchId: string): void {
    const match = this.matches.get(matchId);
    if (!match) return;
    // A room rematch can start before this match is collected, in which case
    // the player already points at the newer match and must not be unlinked.
    for (const seat of ["X", "O"] as const) {
      const { userId } = match.players[seat];
      if (this.byUser.get(userId) === matchId) this.byUser.delete(userId);
    }
    this.matches.delete(matchId);
  }

  listActive(): LiveMatch[] {
    return [...this.matches.values()];
  }
}

export type { PublicPlayer };
export { DISCONNECT_GRACE_MS };

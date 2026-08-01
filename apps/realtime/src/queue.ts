import type { LeagueTier, PublicPlayer, QueueMode } from "@uttt/contracts";
import type { Socket } from "socket.io";

/** Everything a live match needs about a player, however they got there. */
export interface MatchPlayer {
  userId: string;
  displayName: string;
  isGuest: boolean;
  rating: number;
  rd: number;
  volatility: number;
  league: LeagueTier;
  placementGames: number;
  socketId: string;
}

export interface QueuedPlayer extends MatchPlayer {
  mode: QueueMode;
  joinedAt: number;
  expandMs: number;
}

export class MatchmakingQueue {
  private casual: QueuedPlayer[] = [];
  private ranked: QueuedPlayer[] = [];

  enqueue(player: QueuedPlayer): void {
    this.leave(player.userId);
    if (player.mode === "casual") this.casual.push(player);
    else this.ranked.push(player);
  }

  leave(userId: string): void {
    this.casual = this.casual.filter((p) => p.userId !== userId);
    this.ranked = this.ranked.filter((p) => p.userId !== userId);
  }

  /** Remove queue entry only if this socket owns it. */
  leaveBySocket(userId: string, socketId: string): boolean {
    const remove = (list: QueuedPlayer[]) => {
      const idx = list.findIndex(
        (p) => p.userId === userId && p.socketId === socketId,
      );
      if (idx >= 0) {
        list.splice(idx, 1);
        return true;
      }
      return false;
    };
    return remove(this.casual) || remove(this.ranked);
  }

  updateSocket(userId: string, socketId: string): void {
    for (const list of [this.casual, this.ranked]) {
      const p = list.find((x) => x.userId === userId);
      if (p) p.socketId = socketId;
    }
  }

  get(userId: string): QueuedPlayer | undefined {
    return (
      this.casual.find((p) => p.userId === userId) ??
      this.ranked.find((p) => p.userId === userId)
    );
  }

  /** Drop entries whose socket is no longer connected. */
  pruneDisconnected(isConnected: (socketId: string) => boolean): void {
    this.casual = this.casual.filter((p) => isConnected(p.socketId));
    this.ranked = this.ranked.filter((p) => isConnected(p.socketId));
  }

  /** Try to pair players; expands rating window over time for ranked. */
  tryMatch(
    mode: QueueMode,
    now = Date.now(),
    isConnected?: (socketId: string) => boolean,
  ): [QueuedPlayer, QueuedPlayer] | null {
    if (isConnected) this.pruneDisconnected(isConnected);

    const list = mode === "casual" ? this.casual : this.ranked;
    if (list.length < 2) return null;

    if (mode === "casual") {
      const a = list.shift()!;
      const b = list.shift()!;
      return [a, b];
    }

    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      const waited = now - a.joinedAt;
      const window = 100 + Math.floor(waited / 5000) * 50 + a.expandMs;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]!;
        if (Math.abs(a.rating - b.rating) <= window) {
          list.splice(j, 1);
          list.splice(i, 1);
          return [a, b];
        }
      }
    }
    return null;
  }

  size(mode: QueueMode): number {
    return mode === "casual" ? this.casual.length : this.ranked.length;
  }
}

export function toPublicPlayer(p: MatchPlayer): PublicPlayer {
  return {
    id: p.userId,
    displayName: p.displayName,
    isGuest: p.isGuest,
    rating: p.isGuest ? undefined : Math.round(p.rating),
    league: p.isGuest ? undefined : p.league,
  };
}

export type AuthedSocket = Socket & {
  data: {
    user: {
      userId: string;
      displayName: string;
      isGuest: boolean;
      rating: number;
      rd: number;
      volatility: number;
      league: LeagueTier;
      placementGames: number;
    };
  };
};

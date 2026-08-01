import { CHALLENGE_TTL_MS } from "@uttt/contracts";
import { randomUUID } from "node:crypto";
import type { MatchPlayer } from "./queue.js";

export interface Challenge {
  id: string;
  /**
   * Snapshot of the challenger taken when they asked. The socket is refreshed
   * on accept, since they may have moved to another tab in the meantime.
   */
  from: MatchPlayer;
  toUserId: string;
  expiresAt: number;
}

/** In-memory book of direct play requests between friends. */
export class ChallengeBook {
  private byId = new Map<string, Challenge>();

  /**
   * Asking twice replaces the first request rather than stacking a second card
   * on the other player's screen.
   */
  create(from: MatchPlayer, toUserId: string, now = Date.now()): Challenge {
    const previous = this.between(from.userId, toUserId);
    if (previous) this.byId.delete(previous.id);

    const challenge: Challenge = {
      id: randomUUID(),
      from,
      toUserId,
      expiresAt: now + CHALLENGE_TTL_MS,
    };
    this.byId.set(challenge.id, challenge);
    return challenge;
  }

  get(id: string): Challenge | undefined {
    return this.byId.get(id);
  }

  remove(id: string): void {
    this.byId.delete(id);
  }

  /** The pending request in one direction, if there is one. */
  between(fromUserId: string, toUserId: string): Challenge | undefined {
    for (const challenge of this.byId.values()) {
      if (challenge.from.userId === fromUserId && challenge.toUserId === toUserId) {
        return challenge;
      }
    }
    return undefined;
  }

  /** Every request this player is part of, in either direction. */
  involving(userId: string): Challenge[] {
    const out: Challenge[] = [];
    for (const challenge of this.byId.values()) {
      if (challenge.from.userId === userId || challenge.toUserId === userId) {
        out.push(challenge);
      }
    }
    return out;
  }

  /** Drops timed-out requests and returns them so both sides can be told. */
  sweep(now = Date.now()): Challenge[] {
    const dropped: Challenge[] = [];
    for (const challenge of [...this.byId.values()]) {
      if (challenge.expiresAt > now) continue;
      this.byId.delete(challenge.id);
      dropped.push(challenge);
    }
    return dropped;
  }

  size(): number {
    return this.byId.size;
  }
}

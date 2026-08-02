import type { EndReason } from "@uttt/contracts";
import type { Db } from "@uttt/db";
import { matches, moves, ratings, seasons, users } from "@uttt/db";
import {
  DEFAULT_RATING,
  PLACEMENT_GAMES,
  applyMutualUpdate,
  leagueFromRating,
  scoreFromResult,
  visibleRating,
} from "@uttt/rating";
import { and, desc, eq, gte } from "drizzle-orm";
import type { LiveMatch } from "./match.js";

export async function ensureActiveSeason(db: Db) {
  const existing = await db
    .select()
    .from(seasons)
    .where(eq(seasons.isActive, true))
    .limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db
    .insert(seasons)
    .values({
      name: "Season 1",
      startsAt: new Date(),
      isActive: true,
    })
    .returning();
  return created!;
}

export async function ensureUser(
  db: Db,
  opts: {
    id: string;
    displayName: string;
    isGuest: boolean;
    username?: string;
  },
) {
  const found = await db.select().from(users).where(eq(users.id, opts.id)).limit(1);
  if (found[0]) return found[0];

  const username =
    opts.username ??
    (opts.isGuest
      ? `guest_${opts.id.slice(0, 8)}`
      : opts.displayName.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20) ||
        `user_${opts.id.slice(0, 8)}`);

  try {
    const [created] = await db
      .insert(users)
      .values({
        id: opts.id,
        username,
        displayName: opts.displayName,
        isGuest: opts.isGuest,
      })
      .returning();
    return created!;
  } catch {
    const again = await db.select().from(users).where(eq(users.id, opts.id)).limit(1);
    return again[0]!;
  }
}

export async function getOrCreateRating(db: Db, userId: string, seasonId: string) {
  const existing = await db
    .select()
    .from(ratings)
    .where(and(eq(ratings.userId, userId), eq(ratings.seasonId, seasonId)))
    .limit(1);
  if (existing[0]) return existing[0];

  try {
    const [created] = await db
      .insert(ratings)
      .values({
        userId,
        seasonId,
        rating: DEFAULT_RATING.rating,
        rd: DEFAULT_RATING.rd,
        volatility: DEFAULT_RATING.volatility,
        league: leagueFromRating(DEFAULT_RATING.rating),
        placementGames: 0,
      })
      .returning();
    return created!;
  } catch {
    const again = await db
      .select()
      .from(ratings)
      .where(and(eq(ratings.userId, userId), eq(ratings.seasonId, seasonId)))
      .limit(1);
    return again[0]!;
  }
}

export async function persistMatchStart(
  db: Db,
  match: LiveMatch,
  seasonId: string | null,
) {
  await db.insert(matches).values({
    id: match.id,
    mode: match.mode,
    status: "in_progress",
    playerXId: match.players.X.userId,
    playerOId: match.players.O.userId,
    seasonId: match.mode === "ranked" ? seasonId : null,
    ratingXBefore: match.players.X.rating,
    ratingOBefore: match.players.O.rating,
    moveCount: 0,
  });
}

/**
 * Only the move row is written here. `matches.move_count` is read from
 * finished games alone, and `finalizeMatch` sets it from the final state, so
 * bumping it on every move was a second round trip nobody reads.
 */
export async function persistMove(
  db: Db,
  matchId: string,
  moveNumber: number,
  player: string,
  board: number,
  cell: number,
) {
  await db.insert(moves).values({
    matchId,
    moveNumber,
    player,
    board,
    cell,
  });
}

export async function finalizeMatch(
  db: Db,
  match: LiveMatch,
  seasonId: string | null,
): Promise<{
  xDelta?: { before: number; after: number };
  oDelta?: { before: number; after: number };
}> {
  if (match.ratingApplied) return {};

  const result =
    match.state.winner === "X" ? "X" : match.state.winner === "O" ? "O" : "draw";
  const reason: EndReason = match.endedReason ?? "normal";

  const canRate =
    match.mode === "ranked" &&
    Boolean(seasonId) &&
    !match.players.X.isGuest &&
    !match.players.O.isGuest;

  // Claim the match row first so concurrent finalizers no-op
  const claimed = await db
    .update(matches)
    .set({
      status: "completed",
      result,
      endReason: reason,
      moveCount: match.state.moveCount,
      finalState: match.state,
      endedAt: new Date(),
      ratingApplied: Boolean(canRate),
    })
    .where(and(eq(matches.id, match.id), eq(matches.status, "in_progress")))
    .returning({ id: matches.id });

  if (claimed.length === 0) {
    match.ratingApplied = true;
    return {};
  }

  let ratingXAfter: number | null = null;
  let ratingOAfter: number | null = null;
  let xDelta: { before: number; after: number } | undefined;
  let oDelta: { before: number; after: number } | undefined;

  if (canRate && seasonId) {
    const rx = await getOrCreateRating(db, match.players.X.userId, seasonId);
    const ro = await getOrCreateRating(db, match.players.O.userId, seasonId);

    const scoreX = scoreFromResult("X", result);
    const updated = applyMutualUpdate(
      { rating: rx.rating, rd: rx.rd, volatility: rx.volatility },
      { rating: ro.rating, rd: ro.rd, volatility: ro.volatility },
      scoreX,
    );

    const px = Math.min(PLACEMENT_GAMES, rx.placementGames + 1);
    const po = Math.min(PLACEMENT_GAMES, ro.placementGames + 1);

    await db
      .update(ratings)
      .set({
        rating: updated.a.rating,
        rd: updated.a.rd,
        volatility: updated.a.volatility,
        league: leagueFromRating(updated.a.rating),
        placementGames: px,
        wins: rx.wins + (result === "X" ? 1 : 0),
        losses: rx.losses + (result === "O" ? 1 : 0),
        draws: rx.draws + (result === "draw" ? 1 : 0),
        updatedAt: new Date(),
      })
      .where(
        and(eq(ratings.userId, match.players.X.userId), eq(ratings.seasonId, seasonId)),
      );

    await db
      .update(ratings)
      .set({
        rating: updated.b.rating,
        rd: updated.b.rd,
        volatility: updated.b.volatility,
        league: leagueFromRating(updated.b.rating),
        placementGames: po,
        wins: ro.wins + (result === "O" ? 1 : 0),
        losses: ro.losses + (result === "X" ? 1 : 0),
        draws: ro.draws + (result === "draw" ? 1 : 0),
        updatedAt: new Date(),
      })
      .where(
        and(eq(ratings.userId, match.players.O.userId), eq(ratings.seasonId, seasonId)),
      );

    ratingXAfter = updated.a.rating;
    ratingOAfter = updated.b.rating;
    xDelta = {
      before: visibleRating({
        rating: rx.rating,
        rd: rx.rd,
        volatility: rx.volatility,
      }),
      after: visibleRating(updated.a),
    };
    oDelta = {
      before: visibleRating({
        rating: ro.rating,
        rd: ro.rd,
        volatility: ro.volatility,
      }),
      after: visibleRating(updated.b),
    };

    await db
      .update(matches)
      .set({
        ratingXAfter,
        ratingOAfter,
        ratingApplied: true,
      })
      .where(eq(matches.id, match.id));
  }

  match.ratingApplied = true;
  return { xDelta, oDelta };
}

export async function getLeaderboard(db: Db, seasonId: string, limit = 50) {
  const rows = await db
    .select({
      userId: ratings.userId,
      rating: ratings.rating,
      wins: ratings.wins,
      losses: ratings.losses,
      draws: ratings.draws,
      placementGames: ratings.placementGames,
      displayName: users.displayName,
      username: users.username,
    })
    .from(ratings)
    .innerJoin(users, eq(users.id, ratings.userId))
    .where(
      and(
        eq(ratings.seasonId, seasonId),
        gte(ratings.placementGames, PLACEMENT_GAMES),
      ),
    )
    .orderBy(desc(ratings.rating))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    league: leagueFromRating(r.rating),
  }));
}

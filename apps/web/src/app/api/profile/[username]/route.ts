import { auth } from "@/auth";
import { createDb, friendships, matches, ratings, seasons, users } from "@uttt/db";
import { and, desc, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ username: string }> },
) {
  const { username } = await ctx.params;
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
  const db = createDb(process.env.DATABASE_URL);
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [season] = await db
    .select()
    .from(seasons)
    .where(eq(seasons.isActive, true))
    .limit(1);

  let rating = null;
  if (season) {
    const [r] = await db
      .select()
      .from(ratings)
      .where(and(eq(ratings.userId, user.id), eq(ratings.seasonId, season.id)))
      .limit(1);
    rating = r
      ? {
          rating: Math.round(r.rating),
          league: r.league,
          wins: r.wins,
          losses: r.losses,
          draws: r.draws,
          placementGames: r.placementGames,
        }
      : null;
  }

  const history = await db
    .select()
    .from(matches)
    .where(
      and(
        or(eq(matches.playerXId, user.id), eq(matches.playerOId, user.id)),
        eq(matches.status, "completed"),
      ),
    )
    .orderBy(desc(matches.endedAt))
    .limit(20);

  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      image: user.image,
      isGuest: user.isGuest,
    },
    rating,
    matches: history.map((m) => ({
      id: m.id,
      mode: m.mode,
      result: m.result,
      endReason: m.endReason,
      youWere: m.playerXId === user.id ? "X" : "O",
      ratingBefore:
        m.playerXId === user.id ? m.ratingXBefore : m.ratingOBefore,
      ratingAfter: m.playerXId === user.id ? m.ratingXAfter : m.ratingOAfter,
      endedAt: m.endedAt,
      moveCount: m.moveCount,
    })),
  });
}

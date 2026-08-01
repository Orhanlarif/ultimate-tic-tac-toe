import { createDb, ratings, seasons, users } from "@uttt/db";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({
      season: null,
      entries: [],
      memoryOnly: true,
    });
  }
  const db = createDb(process.env.DATABASE_URL);
  const [season] = await db
    .select()
    .from(seasons)
    .where(eq(seasons.isActive, true))
    .limit(1);
  if (!season) {
    return NextResponse.json({ season: null, entries: [] });
  }

  const entries = await db
    .select({
      userId: ratings.userId,
      rating: ratings.rating,
      league: ratings.league,
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
        eq(ratings.seasonId, season.id),
        eq(users.isGuest, false),
        // A seeded rating alone is not a ranking; only rated players belong here.
        gt(sql`${ratings.wins} + ${ratings.losses} + ${ratings.draws}`, 0),
      ),
    )
    .orderBy(desc(ratings.rating))
    .limit(50);

  return NextResponse.json({
    season: { id: season.id, name: season.name },
    entries: entries.map((e, i) => ({
      rank: i + 1,
      ...e,
      rating: Math.round(e.rating),
    })),
  });
}

import { isAdminResult, requireAdminApi, requireDb } from "@/lib/admin";
import { ratings, seasons, users } from "@uttt/db";
import { leagueFromRating, PLACEMENT_GAMES } from "@uttt/rating";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

const LEAGUES = [
  "bronze",
  "silver",
  "gold",
  "platinum",
  "diamond",
  "master",
  "grandmaster",
] as const;

type League = (typeof LEAGUES)[number];

function isLeague(value: string): value is League {
  return (LEAGUES as readonly string[]).includes(value);
}

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const admin = await requireAdminApi();
  if (!isAdminResult(admin)) return admin;

  const { id } = await ctx.params;

  let body: { rating?: number; league?: string; rd?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ratingValue =
    typeof body.rating === "number" && Number.isFinite(body.rating)
      ? body.rating
      : null;
  if (ratingValue == null || ratingValue < 0 || ratingValue > 4000) {
    return NextResponse.json({ error: "Invalid rating" }, { status: 400 });
  }

  const rdValue =
    typeof body.rd === "number" && Number.isFinite(body.rd) ? body.rd : undefined;
  if (rdValue != null && (rdValue < 1 || rdValue > 500)) {
    return NextResponse.json({ error: "Invalid rd" }, { status: 400 });
  }

  let league: League | undefined;
  if (typeof body.league === "string" && body.league) {
    if (!isLeague(body.league)) {
      return NextResponse.json({ error: "Invalid league" }, { status: 400 });
    }
    league = body.league;
  }

  try {
    const db = requireDb();
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user || user.isGuest) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let [season] = await db
      .select()
      .from(seasons)
      .where(eq(seasons.isActive, true))
      .limit(1);
    if (!season) {
      [season] = await db
        .insert(seasons)
        .values({ name: "Season 1", startsAt: new Date(), isActive: true })
        .returning();
    }
    if (!season) {
      return NextResponse.json({ error: "No season" }, { status: 500 });
    }

    const [existing] = await db
      .select()
      .from(ratings)
      .where(and(eq(ratings.userId, id), eq(ratings.seasonId, season.id)))
      .limit(1);

    const resolvedLeague = league ?? leagueFromRating(ratingValue);

    if (existing) {
      await db
        .update(ratings)
        .set({
          rating: ratingValue,
          ...(rdValue != null ? { rd: rdValue } : {}),
          league: resolvedLeague as typeof existing.league,
          updatedAt: new Date(),
        })
        .where(and(eq(ratings.userId, id), eq(ratings.seasonId, season.id)));
    } else {
      await db.insert(ratings).values({
        userId: id,
        seasonId: season.id,
        rating: ratingValue,
        rd: rdValue ?? 350,
        league: resolvedLeague as "bronze",
        placementGames: PLACEMENT_GAMES,
      });
    }

    return NextResponse.json({
      ok: true,
      rating: Math.round(ratingValue),
      league: resolvedLeague,
      rd: rdValue ?? existing?.rd ?? 350,
    });
  } catch (err) {
    console.error("admin patch rating", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

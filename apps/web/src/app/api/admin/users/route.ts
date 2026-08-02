import { isAdminResult, requireAdminApi, requireDb } from "@/lib/admin";
import { ratings, seasons, users } from "@uttt/db";
import { leagueFromRating } from "@uttt/rating";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

const PAGE_SIZE = 30;

export async function GET(req: Request) {
  const admin = await requireAdminApi();
  if (!isAdminResult(admin)) return admin;

  try {
    const db = requireDb();
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
    const offset = (page - 1) * PAGE_SIZE;

    const [season] = await db
      .select()
      .from(seasons)
      .where(eq(seasons.isActive, true))
      .limit(1);

    const searchFilter = q
      ? or(
          ilike(users.username, `%${q}%`),
          ilike(users.displayName, `%${q}%`),
          ilike(users.email, `%${q}%`),
        )
      : undefined;

    const whereClause = and(eq(users.isGuest, false), searchFilter);

    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(whereClause);

    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        email: users.email,
        isGuest: users.isGuest,
        bannedAt: users.bannedAt,
        banReason: users.banReason,
        createdAt: users.createdAt,
        rating: ratings.rating,
        league: ratings.league,
        wins: ratings.wins,
        losses: ratings.losses,
        draws: ratings.draws,
      })
      .from(users)
      .leftJoin(
        ratings,
        season
          ? and(eq(ratings.userId, users.id), eq(ratings.seasonId, season.id))
          : sql`false`,
      )
      .where(whereClause)
      .orderBy(desc(users.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset);

    const total = countRow?.count ?? 0;

    return NextResponse.json({
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      season: season ? { id: season.id, name: season.name } : null,
      users: rows.map((r) => ({
        id: r.id,
        username: r.username,
        displayName: r.displayName,
        email: r.email,
        isGuest: r.isGuest,
        bannedAt: r.bannedAt,
        banReason: r.banReason,
        createdAt: r.createdAt,
        rating: r.rating != null ? Math.round(r.rating) : null,
        league: r.rating != null ? leagueFromRating(r.rating) : null,
        wins: r.wins ?? 0,
        losses: r.losses ?? 0,
        draws: r.draws ?? 0,
      })),
    });
  } catch (err) {
    console.error("admin list users", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

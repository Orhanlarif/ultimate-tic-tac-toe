import {
  AccountError,
  hashPassword,
} from "@/lib/accounts";
import { isAdminResult, requireAdminApi, requireDb } from "@/lib/admin";
import { matches, ratings, seasons, users } from "@uttt/db";
import { and, desc, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const admin = await requireAdminApi();
  if (!isAdminResult(admin)) return admin;

  const { id } = await ctx.params;
  try {
    const db = requireDb();
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user || user.isGuest) {
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
      if (r) {
        rating = {
          rating: Math.round(r.rating),
          rd: Math.round(r.rd),
          volatility: r.volatility,
          league: r.league,
          wins: r.wins,
          losses: r.losses,
          draws: r.draws,
          placementGames: r.placementGames,
        };
      }
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
        email: user.email,
        image: user.image,
        isGuest: user.isGuest,
        bannedAt: user.bannedAt,
        banReason: user.banReason,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      season: season ? { id: season.id, name: season.name } : null,
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
  } catch (err) {
    console.error("admin get user", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const admin = await requireAdminApi();
  if (!isAdminResult(admin)) return admin;

  const { id } = await ctx.params;
  if (id === admin.userId) {
    return NextResponse.json(
      { error: "Cannot moderate your own account" },
      { status: 400 },
    );
  }

  let body: { action?: string; reason?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const db = requireDb();
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user || user.isGuest) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (body.action === "ban") {
      const reason =
        typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : null;
      await db
        .update(users)
        .set({
          bannedAt: new Date(),
          banReason: reason || null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, id));
      return NextResponse.json({ ok: true, action: "ban" });
    }

    if (body.action === "unban") {
      await db
        .update(users)
        .set({ bannedAt: null, banReason: null, updatedAt: new Date() })
        .where(eq(users.id, id));
      return NextResponse.json({ ok: true, action: "unban" });
    }

    if (body.action === "resetPassword") {
      try {
        const passwordHash = await hashPassword(body.password);
        await db
          .update(users)
          .set({ passwordHash, updatedAt: new Date() })
          .where(eq(users.id, id));
        return NextResponse.json({ ok: true, action: "resetPassword" });
      } catch (err) {
        if (err instanceof AccountError) {
          return NextResponse.json({ error: err.code }, { status: 400 });
        }
        throw err;
      }
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("admin patch user", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const admin = await requireAdminApi();
  if (!isAdminResult(admin)) return admin;

  const { id } = await ctx.params;
  if (id === admin.userId) {
    return NextResponse.json(
      { error: "Cannot delete your own account" },
      { status: 400 },
    );
  }

  try {
    const db = requireDb();
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user || user.isGuest) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const short = id.replace(/-/g, "").slice(0, 8);
    await db
      .update(users)
      .set({
        email: null,
        passwordHash: null,
        image: null,
        displayName: "Deleted",
        username: `deleted_${short}`,
        bannedAt: new Date(),
        banReason: user.banReason ?? "Account deleted by admin",
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));

    return NextResponse.json({ ok: true, username: `deleted_${short}` });
  } catch (err) {
    console.error("admin delete user", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

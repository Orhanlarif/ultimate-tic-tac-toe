import { auth } from "@/auth";
import { createDb, friendships, users } from "@uttt/db";
import { and, eq, inArray, or } from "drizzle-orm";
import { NextResponse } from "next/server";

function requireDb() {
  if (!process.env.DATABASE_URL) return null;
  return createDb(process.env.DATABASE_URL);
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = requireDb();
  if (!db) return NextResponse.json({ friends: [], pending: [], memoryOnly: true });

  const rows = await db
    .select({
      id: friendships.id,
      status: friendships.status,
      requesterId: friendships.requesterId,
      addresseeId: friendships.addresseeId,
      createdAt: friendships.createdAt,
    })
    .from(friendships)
    .where(
      or(
        eq(friendships.requesterId, session.user.id),
        eq(friendships.addresseeId, session.user.id),
      ),
    );

  const userIds = new Set<string>();
  for (const r of rows) {
    userIds.add(r.requesterId);
    userIds.add(r.addresseeId);
  }
  userIds.delete(session.user.id);

  const profiles =
    userIds.size === 0
      ? []
      : await db.select().from(users).where(inArray(users.id, [...userIds]));

  const byId = Object.fromEntries(profiles.map((u) => [u.id, u]));

  const friends = [];
  const pending = [];
  for (const r of rows) {
    const otherId =
      r.requesterId === session.user.id ? r.addresseeId : r.requesterId;
    const other = byId[otherId];
    if (!other) continue;
    const item = {
      id: r.id,
      status: r.status,
      direction:
        r.requesterId === session.user.id ? ("outgoing" as const) : ("incoming" as const),
      user: {
        id: other.id,
        username: other.username,
        displayName: other.displayName,
        image: other.image,
      },
    };
    if (r.status === "accepted") friends.push(item);
    else if (r.status === "pending") pending.push(item);
  }

  return NextResponse.json({ friends, pending });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = requireDb();
  if (!db) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const body = (await req.json()) as {
    username?: string;
    action?: "request" | "accept" | "reject";
    friendshipId?: string;
  };

  if (body.action === "accept" || body.action === "reject") {
    if (!body.friendshipId) {
      return NextResponse.json({ error: "Missing friendshipId" }, { status: 400 });
    }
    const [row] = await db
      .select()
      .from(friendships)
      .where(
        and(
          eq(friendships.id, body.friendshipId),
          eq(friendships.addresseeId, session.user.id),
          eq(friendships.status, "pending"),
        ),
      )
      .limit(1);
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (body.action === "reject") {
      await db.delete(friendships).where(eq(friendships.id, row.id));
    } else {
      await db
        .update(friendships)
        .set({ status: "accepted", updatedAt: new Date() })
        .where(eq(friendships.id, row.id));
    }
    return NextResponse.json({ ok: true });
  }

  const username = body.username?.trim().toLowerCase();
  if (!username) {
    return NextResponse.json({ error: "Username required" }, { status: 400 });
  }

  const [target] = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (target.id === session.user.id) {
    return NextResponse.json({ error: "Cannot friend yourself" }, { status: 400 });
  }

  try {
    await db.insert(friendships).values({
      requesterId: session.user.id,
      addresseeId: target.id,
      status: "pending",
    });
  } catch {
    return NextResponse.json({ error: "Already requested" }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}

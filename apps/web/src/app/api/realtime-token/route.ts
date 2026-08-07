import { auth, ensureGuestCookies } from "@/auth";
import { createDb, users } from "@uttt/db";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  const rawSecret = process.env.REALTIME_JWT_SECRET;
  if (!rawSecret && process.env.NODE_ENV === "production") {
    throw new Error("REALTIME_JWT_SECRET must be set in production");
  }
  const secret = new TextEncoder().encode(rawSecret ?? "dev-realtime-secret");

  let sub: string;
  let displayName: string;
  let isGuest: boolean;

  if (session?.user?.id) {
    if (process.env.DATABASE_URL) {
      const db = createDb(process.env.DATABASE_URL);
      const [row] = await db
        .select({ bannedAt: users.bannedAt, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1);
      if (row?.bannedAt) {
        return NextResponse.json({ error: "Account banned" }, { status: 403 });
      }
      displayName = row?.displayName ?? session.user.name ?? "Player";
    } else {
      displayName = session.user.name ?? "Player";
    }
    sub = session.user.id;
    isGuest = false;
  } else {
    const guest = await ensureGuestCookies();
    sub = guest.id;
    displayName = guest.displayName;
    isGuest = true;
  }

  const token = await new SignJWT({
    displayName,
    isGuest,
    rating: 300,
    rd: 350,
    volatility: 0.06,
    league: "gold",
    placementGames: 0,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);

  return NextResponse.json({
    token,
    user: { id: sub, displayName, isGuest },
    realtimeUrl: process.env.NEXT_PUBLIC_REALTIME_URL ?? "http://localhost:3001",
  });
}

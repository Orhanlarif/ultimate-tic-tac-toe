import { auth } from "@/auth";
import { createDb } from "@uttt/db";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";

export function parseAdminUsernames(raw = process.env.ADMIN_USERNAMES) {
  if (!raw) return new Set<string>();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminUsername(username: string | null | undefined) {
  if (!username) return false;
  return parseAdminUsernames().has(username.trim().toLowerCase());
}

export function requireDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  return createDb(process.env.DATABASE_URL);
}

export type AdminSession = {
  userId: string;
  username: string;
};

/** API routes: returns session or a NextResponse error. */
export async function requireAdminApi(): Promise<
  AdminSession | NextResponse
> {
  const session = await auth();
  const username = session?.user?.username;
  const userId = session?.user?.id;
  if (!userId || !username) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminUsername(username)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return { userId, username };
}

/** Server pages: redirects non-admins away. */
export async function requireAdminPage(): Promise<AdminSession> {
  const session = await auth();
  const username = session?.user?.username;
  const userId = session?.user?.id;
  if (!userId || !username) {
    redirect(`/login?next=${encodeURIComponent("/admin")}`);
  }
  if (!isAdminUsername(username)) {
    redirect("/");
  }
  return { userId, username };
}

export function isAdminResult(
  value: AdminSession | NextResponse,
): value is AdminSession {
  return !(value instanceof NextResponse);
}

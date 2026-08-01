import { AccountError, registerAccount } from "@/lib/accounts";
import { NextResponse } from "next/server";

const STATUS_BY_CODE: Record<string, number> = {
  noDatabase: 503,
  emailTaken: 409,
  unknown: 500,
};

export async function POST(req: Request) {
  let body: { email?: unknown; password?: unknown; displayName?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalidEmail" }, { status: 400 });
  }

  try {
    const user = await registerAccount({
      email: body.email,
      password: body.password,
      displayName: body.displayName,
    });
    return NextResponse.json({
      ok: true,
      user: { id: user.id, username: user.username, displayName: user.displayName },
    });
  } catch (err) {
    if (err instanceof AccountError) {
      return NextResponse.json(
        { error: err.code },
        { status: STATUS_BY_CODE[err.code] ?? 400 },
      );
    }
    console.error("register failed", err);
    return NextResponse.json({ error: "unknown" }, { status: 500 });
  }
}

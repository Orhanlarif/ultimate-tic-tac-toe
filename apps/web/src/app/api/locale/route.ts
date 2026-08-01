import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = (await req.json()) as { locale?: string };
  const locale = body.locale === "en" ? "en" : "tr";
  const res = NextResponse.json({ ok: true, locale });
  res.cookies.set("locale", locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return res;
}

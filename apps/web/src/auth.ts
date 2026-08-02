import { AccountError, verifyAccount } from "@/lib/accounts";
import { isAdminUsername } from "@/lib/admin";
import { createDb, users } from "@uttt/db";
import { eq } from "drizzle-orm";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { cookies } from "next/headers";
import { v4 as uuid } from "uuid";

/** Surfaces the reason on /login as `?error=<code>` instead of a generic failure. */
class SignInError extends CredentialsSignin {
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      id: "credentials",
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        try {
          const account = await verifyAccount({
            email: credentials?.email,
            password: credentials?.password,
          });
          return {
            id: account.id,
            name: account.displayName,
            username: account.username,
            email: account.email,
            image: account.image,
          };
        } catch (err) {
          if (err instanceof AccountError) throw new SignInError(err.code);
          console.error("authorize failed", err);
          throw new SignInError("unknown");
        }
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
        token.name = user.name;
        token.username = user.username;
        token.banned = false;
      }

      token.isAdmin = isAdminUsername(token.username);

      if (token.sub && process.env.DATABASE_URL) {
        try {
          const db = createDb(process.env.DATABASE_URL);
          const [row] = await db
            .select({
              bannedAt: users.bannedAt,
              username: users.username,
              displayName: users.displayName,
            })
            .from(users)
            .where(eq(users.id, token.sub))
            .limit(1);
          if (!row || row.bannedAt) {
            token.banned = true;
          } else {
            token.banned = false;
            token.username = row.username;
            token.name = row.displayName;
            token.isAdmin = isAdminUsername(row.username);
          }
        } catch (err) {
          console.error("jwt ban check failed", err);
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (token.banned || !token.sub) {
        return { ...session, user: undefined as unknown as typeof session.user };
      }
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.name = token.name as string | undefined;
        session.user.username = token.username;
        session.user.isAdmin = Boolean(token.isAdmin);
      }
      return session;
    },
  },
  trustHost: true,
  secret: (() => {
    if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET must be set in production");
    }
    return "dev-auth-secret";
  })(),
});

export async function ensureGuestCookies() {
  const store = await cookies();
  let id = store.get("guest_id")?.value;
  let name = store.get("guest_name")?.value;
  if (!id) {
    id = uuid();
    name = `Guest${Math.floor(1000 + Math.random() * 9000)}`;
    store.set("guest_id", id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    store.set("guest_name", name, {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return { id, displayName: name ?? "Guest", isGuest: true as const };
}

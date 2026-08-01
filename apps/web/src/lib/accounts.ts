import { createDb, ratings, seasons, users } from "@uttt/db";
import { DEFAULT_RATING, leagueFromRating } from "@uttt/rating";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;
export const DISPLAY_NAME_MAX_LENGTH = 24;

/** Error codes double as i18n keys under the `auth.errors` namespace. */
export type AccountErrorCode =
  | "noDatabase"
  | "invalidEmail"
  | "weakPassword"
  | "longPassword"
  | "invalidName"
  | "emailTaken"
  | "invalidCredentials"
  | "unknown";

export class AccountError extends Error {
  constructor(readonly code: AccountErrorCode) {
    super(code);
    this.name = "AccountError";
  }
}

export type AccountUser = {
  id: string;
  username: string;
  displayName: string;
  email: string;
  image: string | null;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function requireDb() {
  if (!process.env.DATABASE_URL) throw new AccountError("noDatabase");
  return createDb(process.env.DATABASE_URL);
}

export function normalizeEmail(email: unknown) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function assertValidEmail(email: string) {
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    throw new AccountError("invalidEmail");
  }
}

function assertValidPassword(password: unknown): asserts password is string {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    throw new AccountError("weakPassword");
  }
  // bcrypt silently truncates beyond 72 bytes, so reject instead of accepting a
  // password that would also authenticate when shortened.
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_LENGTH) {
    throw new AccountError("longPassword");
  }
}

function toUsernameBase(displayName: string, email: string) {
  const slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 16);
  if (slug.length >= 3) return slug;
  const fromEmail = (email.split("@")[0] ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 16);
  return fromEmail.length >= 3 ? fromEmail : "player";
}

async function pickFreeUsername(db: ReturnType<typeof createDb>, base: string) {
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base.slice(0, 12)}${i}`;
    const [clash] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, candidate))
      .limit(1);
    if (!clash) return candidate;
  }
  return `${base.slice(0, 10)}${Date.now().toString(36)}`;
}

async function seedRating(db: ReturnType<typeof createDb>, userId: string) {
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
  if (!season) return;
  await db.insert(ratings).values({
    userId,
    seasonId: season.id,
    rating: DEFAULT_RATING.rating,
    rd: DEFAULT_RATING.rd,
    volatility: DEFAULT_RATING.volatility,
    league: leagueFromRating(DEFAULT_RATING.rating, false),
  });
}

export async function registerAccount(input: {
  email: unknown;
  password: unknown;
  displayName: unknown;
}): Promise<AccountUser> {
  const db = requireDb();
  const email = normalizeEmail(input.email);
  assertValidEmail(email);
  assertValidPassword(input.password);

  const displayName =
    typeof input.displayName === "string" ? input.displayName.trim() : "";
  if (displayName.length < 2 || displayName.length > DISPLAY_NAME_MAX_LENGTH) {
    throw new AccountError("invalidName");
  }

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) throw new AccountError("emailTaken");

  const passwordHash = await bcrypt.hash(input.password, 12);
  const username = await pickFreeUsername(db, toUsernameBase(displayName, email));

  let created;
  try {
    [created] = await db
      .insert(users)
      .values({ username, displayName, email, passwordHash, isGuest: false })
      .returning();
  } catch {
    // Unique index on email/username - another request won the race.
    throw new AccountError("emailTaken");
  }
  if (!created) throw new AccountError("unknown");

  await seedRating(db, created.id);

  return {
    id: created.id,
    username: created.username,
    displayName: created.displayName,
    email,
    image: created.image,
  };
}

/**
 * Compared against when the email is unknown, so a failed lookup costs the same
 * time as a wrong password and cannot be used to enumerate registered emails.
 */
let decoyHash: Promise<string> | null = null;
function getDecoyHash() {
  decoyHash ??= bcrypt.hash("account-does-not-exist", 12);
  return decoyHash;
}

export async function verifyAccount(input: {
  email: unknown;
  password: unknown;
}): Promise<AccountUser> {
  const db = requireDb();
  const email = normalizeEmail(input.email);
  const password = typeof input.password === "string" ? input.password : "";

  const [found] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const matches = await bcrypt.compare(
    password,
    found?.passwordHash ?? (await getDecoyHash()),
  );
  if (!found || !found.passwordHash || !matches || found.isGuest) {
    throw new AccountError("invalidCredentials");
  }

  return {
    id: found.id,
    username: found.username,
    displayName: found.displayName,
    email,
    image: found.image,
  };
}

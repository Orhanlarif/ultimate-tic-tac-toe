import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Also covers private (invite-code) matches, which are never rated. */
export const queueModeEnum = pgEnum("queue_mode", [
  "casual",
  "ranked",
  "private",
]);
export const matchStatusEnum = pgEnum("match_status", [
  "in_progress",
  "completed",
  "aborted",
]);
export const matchResultEnum = pgEnum("match_result", ["X", "O", "draw"]);
export const endReasonEnum = pgEnum("end_reason", [
  "normal",
  "resign",
  "timeout",
  "disconnect",
]);
export const leagueEnum = pgEnum("league_tier", [
  "bronze",
  "silver",
  "gold",
  "platinum", // TODO: Remove this                            
  "diamond",
  "master",
  "grandmaster",
]);
export const friendshipStatusEnum = pgEnum("friendship_status", [
  "pending",
  "accepted",
  "blocked",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email"),
    image: text("image"),
    passwordHash: text("password_hash"),
    isGuest: boolean("is_guest").notNull().default(false),
    bannedAt: timestamp("banned_at", { withTimezone: true }),
    banReason: text("ban_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("users_username_uidx").on(t.username),
    uniqueIndex("users_email_uidx").on(t.email),
  ],
);

/** Auth.js tables */
export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

export const seasons = pgTable("seasons", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
});

export const ratings = pgTable(
  "ratings",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    rating: doublePrecision("rating").notNull().default(300),
    rd: doublePrecision("rd").notNull().default(350),
    volatility: doublePrecision("volatility").notNull().default(0.06),
    league: leagueEnum("league").notNull().default("bronze"),
    placementGames: integer("placement_games").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    draws: integer("draws").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.seasonId] }),
    index("ratings_season_rating_idx").on(t.seasonId, t.rating),
  ],
);

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    mode: queueModeEnum("mode").notNull(),
    status: matchStatusEnum("status").notNull().default("in_progress"),
    result: matchResultEnum("result"),
    endReason: endReasonEnum("end_reason"),
    playerXId: uuid("player_x_id")
      .notNull()
      .references(() => users.id),
    playerOId: uuid("player_o_id")
      .notNull()
      .references(() => users.id),
    seasonId: uuid("season_id").references(() => seasons.id),
    ratingXBefore: doublePrecision("rating_x_before"),
    ratingOBefore: doublePrecision("rating_o_before"),
    ratingXAfter: doublePrecision("rating_x_after"),
    ratingOAfter: doublePrecision("rating_o_after"),
    ratingApplied: boolean("rating_applied").notNull().default(false),
    moveCount: integer("move_count").notNull().default(0),
    finalState: jsonb("final_state"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("matches_player_x_idx").on(t.playerXId),
    index("matches_player_o_idx").on(t.playerOId),
    index("matches_started_at_idx").on(t.startedAt),
  ],
);

export const moves = pgTable(
  "moves",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    moveNumber: integer("move_number").notNull(),
    player: text("player").notNull(),
    board: integer("board").notNull(),
    cell: integer("cell").notNull(),
    playedAt: timestamp("played_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("moves_match_number_uidx").on(t.matchId, t.moveNumber),
    index("moves_match_idx").on(t.matchId),
  ],
);

export const friendships = pgTable(
  "friendships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addresseeId: uuid("addressee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: friendshipStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("friendships_pair_uidx").on(t.requesterId, t.addresseeId),
    index("friendships_addressee_idx").on(t.addresseeId),
  ],
);

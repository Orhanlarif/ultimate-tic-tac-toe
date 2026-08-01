import { z } from "zod";

export const PlayerSchema = z.enum(["X", "O"]);
export const BoardIndexSchema = z.number().int().min(0).max(8);
export const CellIndexSchema = z.number().int().min(0).max(8);

export const MoveSchema = z.object({
  board: BoardIndexSchema,
  cell: CellIndexSchema,
});

/** Modes you can queue for. Private games are entered by code, never queued. */
export const QueueModeSchema = z.enum(["casual", "ranked"]);
export type QueueMode = z.infer<typeof QueueModeSchema>;

/** How a live match came to be. Only `ranked` affects ratings. */
export const MatchModeSchema = z.enum(["casual", "ranked", "private"]);
export type MatchMode = z.infer<typeof MatchModeSchema>;

export const MatchResultSchema = z.enum(["X", "O", "draw"]);
export type MatchResult = z.infer<typeof MatchResultSchema>;

export const EndReasonSchema = z.enum([
  "normal",
  "resign",
  "timeout",
  "disconnect",
]);
export type EndReason = z.infer<typeof EndReasonSchema>;

export const LeagueTierSchema = z.enum([
  "bronze",
  "silver",
  "gold",
  "platinum",
  "diamond",
  "master",
  "grandmaster",
]);
export type LeagueTier = z.infer<typeof LeagueTierSchema>;

/**
 * Room codes are typed in by hand, so the alphabet drops the characters people
 * confuse: I/L/O and 0/1.
 */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 5;
/** Accepts what a person types; yields the canonical upper-case code. */
export const RoomCodeSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
  z
    .string()
    .length(ROOM_CODE_LENGTH)
    .regex(new RegExp(`^[${ROOM_CODE_ALPHABET}]+$`)),
);

/** A room with nobody connected is collected after this long. */
export const ROOM_EMPTY_GRACE_MS = 120_000;
/** A room nobody has touched is collected after this long. */
export const ROOM_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * A direct play request to a friend. Short-lived on purpose: nobody wants to
 * be dropped into a game they asked for ten minutes ago.
 */
export const CHALLENGE_TTL_MS = 60_000;
/** Why a play request went away without a game starting. */
export const ChallengeOutcomeSchema = z.enum([
  "declined",
  "cancelled",
  "expired",
  "offline",
]);
export type ChallengeOutcome = z.infer<typeof ChallengeOutcomeSchema>;

/** Client -> server events */
export const ClientEvents = {
  queueJoin: z.object({
    mode: QueueModeSchema,
  }),
  queueLeave: z.object({}),
  roomCreate: z.object({}),
  /** Also used to re-enter a room you are already a member of. */
  roomJoin: z.object({
    code: RoomCodeSchema,
  }),
  roomLeave: z.object({}),
  /** Toggles your readiness for the next game in the room. */
  roomRematch: z.object({}),
  /** Ask a friend to play right now, no room code involved. */
  challengeSend: z.object({
    toUserId: z.string().uuid(),
  }),
  challengeRespond: z.object({
    id: z.string().uuid(),
    accept: z.boolean(),
  }),
  /** Take back a request the other side has not answered yet. */
  challengeCancel: z.object({
    id: z.string().uuid(),
  }),
  /** Which of these people are connected right now. */
  presenceQuery: z.object({
    userIds: z.array(z.string().uuid()).max(200),
  }),
  move: z.object({
    matchId: z.string().uuid(),
    moveNumber: z.number().int().positive(),
    board: BoardIndexSchema,
    cell: CellIndexSchema,
  }),
  resign: z.object({
    matchId: z.string().uuid(),
  }),
  sync: z.object({
    matchId: z.string().uuid(),
  }),
} as const;

/** Server -> client events */
export const ClockStateSchema = z.object({
  xMs: z.number().int().nonnegative(),
  oMs: z.number().int().nonnegative(),
  turnStartedAt: z.number().int().nullable(),
  incrementMs: z.number().int().nonnegative(),
  activePlayer: PlayerSchema.nullable(),
});

export const PublicPlayerSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  isGuest: z.boolean(),
  rating: z.number().optional(),
  league: LeagueTierSchema.optional(),
});

export const RoomMemberSchema = z.object({
  player: PublicPlayerSchema,
  online: z.boolean(),
  wantsRematch: z.boolean(),
});

export const RoomSnapshotSchema = z.object({
  code: RoomCodeSchema,
  host: RoomMemberSchema,
  guest: RoomMemberSchema.nullable(),
  /** Which side of the room the recipient is on. */
  youAre: z.enum(["host", "guest"]),
  status: z.enum(["waiting", "playing"]),
  matchId: z.string().uuid().nullable(),
  /** Seat the host takes in the next game; alternates every game. */
  hostSeat: PlayerSchema,
  /** Running tally across every game played in this room. */
  score: z.object({
    host: z.number().int().nonnegative(),
    guest: z.number().int().nonnegative(),
    draw: z.number().int().nonnegative(),
  }),
});

export type RoomMember = z.infer<typeof RoomMemberSchema>;
export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>;

export const MatchSnapshotSchema = z.object({
  matchId: z.string().uuid(),
  mode: MatchModeSchema,
  youAre: PlayerSchema,
  players: z.object({
    X: PublicPlayerSchema,
    O: PublicPlayerSchema,
  }),
  boards: z.array(z.array(z.enum(["X", "O"]).nullable())).length(9),
  boardWinners: z
    .array(z.union([z.enum(["X", "O", "draw"]), z.null()]))
    .length(9),
  currentPlayer: PlayerSchema,
  activeBoard: BoardIndexSchema.nullable(),
  status: z.enum(["in_progress", "won", "draw"]),
  winner: PlayerSchema.nullable(),
  moveCount: z.number().int().nonnegative(),
  moves: z.array(MoveSchema),
  clock: ClockStateSchema,
  endedReason: EndReasonSchema.optional(),
});

export type MatchSnapshot = z.infer<typeof MatchSnapshotSchema>;
export type ClockState = z.infer<typeof ClockStateSchema>;
export type PublicPlayer = z.infer<typeof PublicPlayerSchema>;

export const ServerEvents = {
  queueWaiting: z.object({
    mode: QueueModeSchema,
    position: z.number().int().positive().optional(),
  }),
  matchFound: MatchSnapshotSchema,
  matchUpdate: MatchSnapshotSchema,
  matchEnded: MatchSnapshotSchema.extend({
    ratingDelta: z
      .object({
        before: z.number(),
        after: z.number(),
      })
      .optional(),
  }),
  roomUpdate: RoomSnapshotSchema,
  roomClosed: z.object({
    code: RoomCodeSchema,
    reason: z.enum(["left", "expired"]),
  }),
  /** Echoed to the challenger so their button can show a pending state. */
  challengeSent: z.object({
    id: z.string().uuid(),
    toUserId: z.string(),
    expiresAt: z.number().int(),
  }),
  challengeReceived: z.object({
    id: z.string().uuid(),
    from: PublicPlayerSchema,
    expiresAt: z.number().int(),
  }),
  /** Sent to both sides when a request ends without a game. */
  challengeResolved: z.object({
    id: z.string().uuid(),
    outcome: ChallengeOutcomeSchema,
  }),
  /** Both sides get the room code and walk into the same game. */
  challengeAccepted: z.object({
    id: z.string().uuid(),
    code: RoomCodeSchema,
  }),
  presenceUpdate: z.object({
    online: z.array(z.string()),
  }),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
  pong: z.object({
    t: z.number(),
    serverNow: z.number().optional(),
  }),
} as const;

export const CLOCK_INITIAL_MS = 5 * 60 * 1000;
export const CLOCK_INCREMENT_MS = 2 * 1000;
/** Grace period before disconnect forfeit; also used for Socket.IO recovery. */
export const DISCONNECT_GRACE_MS = 60_000;

export const RealtimeTokenPayloadSchema = z.object({
  sub: z.string(),
  displayName: z.string(),
  isGuest: z.boolean(),
  rating: z.number().optional(),
  rd: z.number().optional(),
  volatility: z.number().optional(),
  league: LeagueTierSchema.optional(),
  placementGames: z.number().int().nonnegative().optional(),
  iat: z.number().optional(),
  exp: z.number().optional(),
});
export type RealtimeTokenPayload = z.infer<typeof RealtimeTokenPayloadSchema>;

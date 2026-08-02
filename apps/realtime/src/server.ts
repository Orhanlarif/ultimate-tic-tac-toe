import {
  ClientEvents,
  DISCONNECT_GRACE_MS,
  type MatchMode,
} from "@uttt/contracts";
import type { Db } from "@uttt/db";
import type { Player } from "@uttt/game-engine";
import { createServer, type Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { verifyRealtimeToken } from "./auth.js";
import { ChallengeBook, type Challenge } from "./challenges.js";
import { MatchManager, type LiveMatch } from "./match.js";
import {
  ensureActiveSeason,
  ensureUser,
  finalizeMatch,
  getOrCreateRating,
  persistMatchStart,
  persistMove,
} from "./persistence.js";
import {
  MatchmakingQueue,
  toPublicPlayer,
  type AuthedSocket,
  type MatchPlayer,
  type QueuedPlayer,
} from "./queue.js";
import { RoomManager, type Room } from "./rooms.js";
import { leagueFromRating } from "@uttt/rating";

export interface RealtimeServerOptions {
  corsOrigin?: string;
  jwtSecret: string;
  db?: Db | null;
  memoryOnly?: boolean;
  httpServer?: HttpServer;
}

export interface RealtimeServer {
  io: Server;
  httpServer: HttpServer;
  queue: MatchmakingQueue;
  matches: MatchManager;
  rooms: RoomManager;
  challenges: ChallengeBook;
  stopSweep: () => void;
  close: () => Promise<void>;
  getSeasonId: () => string | null;
  setSeasonId: (id: string | null) => void;
}

export function createRealtimeServer(
  options: RealtimeServerOptions,
): RealtimeServer {
  const corsOrigin = options.corsOrigin ?? "http://localhost:3000";
  const jwtSecret = options.jwtSecret;
  const db = options.db ?? null;
  const memoryOnly = options.memoryOnly ?? !db;

  const httpServer =
    options.httpServer ??
    createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, memoryOnly }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      methods: ["GET", "POST"],
    },
    connectionStateRecovery: {
      maxDisconnectionDuration: DISCONNECT_GRACE_MS,
    },
  });

  const queue = new MatchmakingQueue();
  const matches = new MatchManager();
  const rooms = new RoomManager();
  const challenges = new ChallengeBook();
  let seasonId: string | null = null;

  /** Track active sockets per user for takeover / stale disconnect. */
  const socketsByUser = new Map<string, Set<string>>();
  /**
   * Sockets that only listen for friend requests and presence. They never take
   * over a seat, so a friends tab left open cannot hijack a live game.
   */
  const presenceSockets = new Set<string>();
  const rateLimit = new Map<string, { count: number; reset: number }>();

  /**
   * Buckets are per user *and* per action: a long rally of moves used to eat
   * the same allowance as room actions and lock a player out of their own
   * rematch.
   */
  function checkRate(
    userId: string,
    bucket: string,
    limit = 30,
    windowMs = 10_000,
  ): boolean {
    const now = Date.now();
    const key = `${userId}:${bucket}`;
    const entry = rateLimit.get(key);
    if (!entry || now > entry.reset) {
      rateLimit.set(key, { count: 1, reset: now + windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  }

  function sweepRateLimit(now = Date.now()) {
    for (const [key, entry] of rateLimit) {
      if (now > entry.reset) rateLimit.delete(key);
    }
  }

  function trackSocket(userId: string, socketId: string) {
    let set = socketsByUser.get(userId);
    if (!set) {
      set = new Set();
      socketsByUser.set(userId, set);
    }
    set.add(socketId);
  }

  function untrackSocket(userId: string, socketId: string) {
    const set = socketsByUser.get(userId);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) socketsByUser.delete(userId);
  }

  function isConnected(socketId: string): boolean {
    return io.sockets.sockets.has(socketId);
  }

  function isOnline(userId: string): boolean {
    return (socketsByUser.get(userId)?.size ?? 0) > 0;
  }

  /** Most recent socket for a user; the one their eyes are most likely on. */
  function latestSocketOf(userId: string): string | null {
    const set = socketsByUser.get(userId);
    if (!set || set.size === 0) return null;
    return [...set].at(-1)!;
  }

  function emitToUser(userId: string, event: string, payload: unknown): void {
    const set = socketsByUser.get(userId);
    if (!set) return;
    for (const socketId of set) io.to(socketId).emit(event, payload);
  }

  /** Tells both sides a play request is over, then forgets it. */
  function resolveChallenge(
    challenge: Challenge,
    outcome: "declined" | "cancelled" | "expired" | "offline",
  ): void {
    challenges.remove(challenge.id);
    const payload = { id: challenge.id, outcome };
    emitToUser(challenge.from.userId, "challengeResolved", payload);
    emitToUser(challenge.toUserId, "challengeResolved", payload);
  }

  function logEvent(
    event: string,
    data: Record<string, string | number | boolean | null | undefined>,
  ) {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        scope: "realtime",
        event,
        ...data,
      }),
    );
  }

  /** The room a match was launched from, if it is still the room's live game. */
  function roomForMatch(match: LiveMatch): Room | null {
    if (match.mode !== "private") return null;
    const room = rooms.getByUser(match.players.X.userId);
    return room && room.matchId === match.id ? room : null;
  }

  function emitRoom(room: Room) {
    for (const member of rooms.membersOf(room)) {
      io.to(member.socketId).emit(
        "roomUpdate",
        rooms.snapshot(room, member.userId),
      );
    }
  }

  async function emitEnded(match: LiveMatch) {
    if (match.state.status === "in_progress") return;
    const deltas = db ? await finalizeMatch(db, match, seasonId) : {};

    for (const seat of ["X", "O"] as const) {
      const socketId = match.sockets[seat];
      const snap = matches.snapshot(match, match.players[seat].userId);
      const ratingDelta = seat === "X" ? deltas.xDelta : deltas.oDelta;
      io.to(socketId).emit("matchEnded", { ...snap, ratingDelta });
    }

    logEvent("match_ended", {
      matchId: match.id,
      reason: match.endedReason ?? "normal",
      winner: match.state.winner,
      mode: match.mode,
    });

    const room = roomForMatch(match);
    if (room) {
      rooms.onMatchEnded(room, match.state.winner);
      emitRoom(room);
    }

    setTimeout(() => matches.remove(match.id), 30_000).unref?.();
  }

  function tryPair(mode: "casual" | "ranked") {
    const pair = queue.tryMatch(mode, Date.now(), isConnected);
    if (!pair) return;
    const [a, b] = pair;
    startMatch(a, b, mode);
  }

  /**
   * Creates the match synchronously so callers can commit to it before any
   * persistence happens, then announces it in the background.
   */
  function startMatch(
    a: MatchPlayer,
    b: MatchPlayer,
    mode: MatchMode,
    seatForA?: Player,
  ): LiveMatch {
    const match = matches.create(a, b, mode, seatForA);
    void announceMatch(match);
    return match;
  }

  async function announceMatch(match: LiveMatch) {
    if (db) {
      try {
        for (const seat of ["X", "O"] as const) {
          const p = match.players[seat];
          await ensureUser(db, {
            id: p.userId,
            displayName: p.displayName,
            isGuest: p.isGuest,
          });
        }
        await persistMatchStart(db, match, seasonId);
      } catch (err) {
        console.error("[realtime] persistMatchStart failed", err);
      }
    }

    // Refresh sockets in case players reconnected during persistence
    for (const seat of ["X", "O"] as const) {
      const p = match.players[seat];
      const set = socketsByUser.get(p.userId);
      if (set && set.size > 0) {
        const latest = [...set].at(-1)!;
        match.sockets[seat] = latest;
      }
    }

    matches.beginClock(match);

    for (const seat of ["X", "O"] as const) {
      const p = match.players[seat];
      const sock = io.sockets.sockets.get(match.sockets[seat]);
      sock?.join(`match:${match.id}`);
      sock?.emit("matchFound", matches.snapshot(match, p.userId));
    }

    logEvent("match_started", {
      matchId: match.id,
      mode: match.mode,
      x: match.players.X.displayName,
      o: match.players.O.displayName,
    });
  }

  function playerFrom(
    user: AuthedSocket["data"]["user"],
    socketId: string,
  ): MatchPlayer {
    return { ...user, socketId };
  }

  /** Explicit departure, notifying whoever is left behind. */
  function leaveRoom(userId: string): void {
    const result = rooms.leave(userId);
    if (!result || result.closed) return;
    emitRoom(result.room);
  }

  function startRoomMatch(room: Room): void {
    if (room.matchId || !room.guest) return;
    const hostSocket = room.host.socketId;
    const guestSocket = room.guest.socketId;
    if (!hostSocket || !guestSocket) return;

    const match = startMatch(
      { ...room.host.player, socketId: hostSocket },
      { ...room.guest.player, socketId: guestSocket },
      "private",
      room.hostSeat,
    );
    rooms.onMatchStarted(room, match.id);
    emitRoom(room);
    logEvent("room_match_started", { code: room.code, matchId: match.id });
  }

  /** The opening game starts on its own; later ones need both players ready. */
  function maybeAutoStart(room: Room): void {
    const played = room.score.host + room.score.guest + room.score.draw;
    if (played > 0) return;
    startRoomMatch(room);
  }

  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (socket.handshake.query?.token as string | undefined);
      if (!token) return next(new Error("Unauthorized"));
      const payload = await verifyRealtimeToken(token, jwtSecret);
      (socket as AuthedSocket).data.user = {
        userId: payload.sub,
        displayName: payload.displayName,
        isGuest: payload.isGuest,
        rating: payload.rating ?? 1500,
        rd: payload.rd ?? 350,
        volatility: payload.volatility ?? 0.06,
        league: payload.league ?? "bronze",
        placementGames: payload.placementGames ?? 0,
      };
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const s = socket as AuthedSocket;
    const user = s.data.user;
    const presenceOnly = socket.handshake.auth?.presence === true;
    trackSocket(user.userId, socket.id);
    if (presenceOnly) presenceSockets.add(socket.id);
    logEvent("connect", {
      userId: user.userId,
      socketId: socket.id,
      displayName: user.displayName,
      presenceOnly,
    });

    // Session takeover: notify older playing sockets for this user
    if (!presenceOnly) {
      const existingSet = socketsByUser.get(user.userId);
      if (existingSet) {
        for (const otherId of existingSet) {
          if (otherId === socket.id || presenceSockets.has(otherId)) continue;
          io.to(otherId).emit("error", {
            code: "SESSION_TAKEN",
            message: "Connected from another tab",
          });
        }
      }
    }

    if (!presenceOnly) {
      const existing = matches.onReconnect(user.userId, socket.id);
      if (existing && existing.state.status === "in_progress") {
        socket.join(`match:${existing.id}`);
        socket.emit("matchUpdate", matches.snapshot(existing, user.userId));
        logEvent("reconnect_match", {
          matchId: existing.id,
          userId: user.userId,
          socketId: socket.id,
        });
      } else {
        queue.updateSocket(user.userId, socket.id);
      }

      const rejoinedRoom = rooms.onReconnect(user.userId, socket.id);
      if (rejoinedRoom) {
        emitRoom(rejoinedRoom);
        maybeAutoStart(rejoinedRoom);
      }
    }

    socket.on("queueJoin", async (raw) => {
      if (!checkRate(user.userId, "queue")) {
        socket.emit("error", {
          code: "RATE_LIMIT",
          message: "Too many requests",
        });
        return;
      }
      const parsed = ClientEvents.queueJoin.safeParse(raw);
      if (!parsed.success) {
        socket.emit("error", {
          code: "BAD_REQUEST",
          message: "Invalid queueJoin",
        });
        return;
      }
      if (parsed.data.mode === "ranked" && user.isGuest) {
        socket.emit("error", {
          code: "AUTH_REQUIRED",
          message: "Sign in to play ranked",
        });
        return;
      }

      // Resume existing match instead of re-queueing
      const live = matches.getLiveByUser(user.userId);
      if (live) {
        matches.onReconnect(user.userId, socket.id);
        socket.join(`match:${live.id}`);
        socket.emit("matchUpdate", matches.snapshot(live, user.userId));
        return;
      }

      // Queueing means you are done with your room.
      leaveRoom(user.userId);

      let rating = user.rating;
      let rd = user.rd;
      let volatility = user.volatility;
      let league = user.league;
      let placementGames = user.placementGames;

      if (db && !user.isGuest && seasonId && parsed.data.mode === "ranked") {
        try {
          await ensureUser(db, {
            id: user.userId,
            displayName: user.displayName,
            isGuest: false,
          });
          const r = await getOrCreateRating(db, user.userId, seasonId);
          rating = r.rating;
          rd = r.rd;
          volatility = r.volatility;
          league = leagueFromRating(r.rating);
          placementGames = r.placementGames;
        } catch (err) {
          console.error("[realtime] rating fetch failed", err);
        }
      }

      // Socket may have disconnected during async work
      if (!io.sockets.sockets.has(socket.id)) return;

      const qp: QueuedPlayer = {
        userId: user.userId,
        displayName: user.displayName,
        isGuest: user.isGuest,
        rating,
        rd,
        volatility,
        league,
        placementGames,
        socketId: socket.id,
        mode: parsed.data.mode,
        joinedAt: Date.now(),
        expandMs: 0,
      };
      queue.enqueue(qp);
      socket.emit("queueWaiting", {
        mode: parsed.data.mode,
        position: queue.size(parsed.data.mode),
      });
      tryPair(parsed.data.mode);
    });

    socket.on("queueLeave", () => {
      queue.leaveBySocket(user.userId, socket.id);
    });

    socket.on("roomCreate", () => {
      if (!checkRate(user.userId, "room")) {
        socket.emit("error", {
          code: "RATE_LIMIT",
          message: "Too many requests",
        });
        return;
      }
      if (matches.getLiveByUser(user.userId)) {
        socket.emit("error", {
          code: "ROOM_BUSY",
          message: "Finish your current match first",
        });
        return;
      }
      queue.leaveBySocket(user.userId, socket.id);
      leaveRoom(user.userId);

      const room = rooms.create(playerFrom(user, socket.id), socket.id);
      if (!room) {
        socket.emit("error", {
          code: "ROOM_UNAVAILABLE",
          message: "Could not allocate a room code",
        });
        return;
      }
      socket.emit("roomUpdate", rooms.snapshot(room, user.userId));
      logEvent("room_created", { code: room.code, userId: user.userId });
    });

    socket.on("roomJoin", (raw) => {
      if (!checkRate(user.userId, "room")) {
        socket.emit("error", {
          code: "RATE_LIMIT",
          message: "Too many requests",
        });
        return;
      }
      const parsed = ClientEvents.roomJoin.safeParse(raw);
      if (!parsed.success) {
        socket.emit("error", { code: "BAD_REQUEST", message: "Invalid code" });
        return;
      }

      const { code } = parsed.data;
      const current = rooms.getByUser(user.userId);
      if (current && current.code !== code) leaveRoom(user.userId);

      const result = rooms.join(code, playerFrom(user, socket.id), socket.id);
      if (!result.ok) {
        socket.emit("error", {
          code: result.error === "FULL" ? "ROOM_FULL" : "ROOM_NOT_FOUND",
          message:
            result.error === "FULL"
              ? "That room already has two players"
              : "No room with that code",
        });
        return;
      }

      queue.leaveBySocket(user.userId, socket.id);
      const { room } = result;
      emitRoom(room);

      if (room.matchId) {
        const live = matches.get(room.matchId);
        if (live && matches.seatOf(live, user.userId)) {
          matches.onReconnect(user.userId, socket.id);
          socket.join(`match:${live.id}`);
          socket.emit("matchUpdate", matches.snapshot(live, user.userId));
        }
        return;
      }

      maybeAutoStart(room);
      logEvent("room_joined", {
        code: room.code,
        userId: user.userId,
        rejoined: result.rejoined,
      });
    });

    socket.on("roomRematch", () => {
      if (!checkRate(user.userId, "room")) return;
      const room = rooms.getByUser(user.userId);
      if (!room || room.matchId) return;
      const side = rooms.sideOf(room, user.userId);
      if (!side) return;
      const member = side === "host" ? room.host : room.guest;
      if (!member) return;

      rooms.setRematch(user.userId, !member.wantsRematch);
      if (rooms.bothReady(room)) startRoomMatch(room);
      else emitRoom(room);
    });

    socket.on("roomLeave", async () => {
      const room = rooms.getByUser(user.userId);
      if (!room) return;
      const code = room.code;

      // Walking out of a live game is a resignation.
      if (room.matchId) {
        const resigned = matches.resign(room.matchId, user.userId);
        if (resigned) await emitEnded(resigned);
      }
      leaveRoom(user.userId);
      socket.emit("roomClosed", { code, reason: "left" });
    });

    socket.on("challengeSend", (raw) => {
      if (!checkRate(user.userId, "challenge", 10, 10_000)) {
        socket.emit("error", {
          code: "RATE_LIMIT",
          message: "Too many requests",
        });
        return;
      }
      const parsed = ClientEvents.challengeSend.safeParse(raw);
      if (!parsed.success || parsed.data.toUserId === user.userId) {
        socket.emit("error", {
          code: "BAD_REQUEST",
          message: "Invalid challenge",
        });
        return;
      }
      if (user.isGuest) {
        socket.emit("error", {
          code: "AUTH_REQUIRED",
          message: "Sign in to challenge friends",
        });
        return;
      }
      if (matches.getLiveByUser(user.userId)) {
        socket.emit("error", {
          code: "ROOM_BUSY",
          message: "Finish your current match first",
        });
        return;
      }

      const { toUserId } = parsed.data;
      if (!isOnline(toUserId)) {
        socket.emit("error", {
          code: "USER_OFFLINE",
          message: "That player is not online",
        });
        return;
      }
      if (matches.getLiveByUser(toUserId)) {
        socket.emit("error", {
          code: "USER_BUSY",
          message: "That player is already in a match",
        });
        return;
      }

      // Clear the stale card on their screen before putting up a new one.
      const previous = challenges.between(user.userId, toUserId);
      if (previous) resolveChallenge(previous, "cancelled");

      const challenge = challenges.create(playerFrom(user, socket.id), toUserId);
      socket.emit("challengeSent", {
        id: challenge.id,
        toUserId,
        expiresAt: challenge.expiresAt,
      });
      emitToUser(toUserId, "challengeReceived", {
        id: challenge.id,
        from: toPublicPlayer(challenge.from),
        expiresAt: challenge.expiresAt,
      });
      logEvent("challenge_sent", {
        id: challenge.id,
        from: user.userId,
        to: toUserId,
      });
    });

    socket.on("challengeCancel", (raw) => {
      const parsed = ClientEvents.challengeCancel.safeParse(raw);
      if (!parsed.success) return;
      const challenge = challenges.get(parsed.data.id);
      if (!challenge || challenge.from.userId !== user.userId) return;
      resolveChallenge(challenge, "cancelled");
    });

    socket.on("challengeRespond", (raw) => {
      const parsed = ClientEvents.challengeRespond.safeParse(raw);
      if (!parsed.success) return;
      const challenge = challenges.get(parsed.data.id);
      if (!challenge || challenge.toUserId !== user.userId) return;

      if (!parsed.data.accept) {
        resolveChallenge(challenge, "declined");
        return;
      }

      const hostSocket = latestSocketOf(challenge.from.userId);
      if (!hostSocket) {
        resolveChallenge(challenge, "offline");
        return;
      }
      if (
        matches.getLiveByUser(challenge.from.userId) ||
        matches.getLiveByUser(user.userId)
      ) {
        resolveChallenge(challenge, "cancelled");
        socket.emit("error", {
          code: "USER_BUSY",
          message: "One of you is already in a match",
        });
        return;
      }

      challenges.remove(challenge.id);

      // An accepted request outranks whatever either side was waiting in.
      queue.leave(challenge.from.userId);
      queue.leave(user.userId);
      leaveRoom(challenge.from.userId);
      leaveRoom(user.userId);

      const room = rooms.create(
        { ...challenge.from, socketId: hostSocket },
        hostSocket,
      );
      const joined = room
        ? rooms.join(room.code, playerFrom(user, socket.id), socket.id)
        : null;
      if (!room || !joined?.ok) {
        const failure = {
          code: "ROOM_UNAVAILABLE",
          message: "Could not open a room for that game",
        };
        socket.emit("error", failure);
        emitToUser(challenge.from.userId, "error", failure);
        return;
      }

      // Both sides walk into the room on their own sockets, and the room
      // starts the game once they are both actually there.
      const accepted = { id: challenge.id, code: room.code };
      emitToUser(challenge.from.userId, "challengeAccepted", accepted);
      emitToUser(user.userId, "challengeAccepted", accepted);
      logEvent("challenge_accepted", {
        id: challenge.id,
        code: room.code,
        from: challenge.from.userId,
        to: user.userId,
      });
    });

    socket.on("presenceQuery", (raw) => {
      if (!checkRate(user.userId, "presence", 30, 10_000)) return;
      const parsed = ClientEvents.presenceQuery.safeParse(raw);
      if (!parsed.success) return;
      socket.emit("presenceUpdate", {
        online: parsed.data.userIds.filter(isOnline),
      });
    });

    socket.on("move", async (raw) => {
      if (!checkRate(user.userId, "move", 60, 10_000)) {
        socket.emit("error", {
          code: "RATE_LIMIT",
          message: "Too many requests",
        });
        return;
      }
      const parsed = ClientEvents.move.safeParse(raw);
      if (!parsed.success) {
        socket.emit("error", { code: "BAD_REQUEST", message: "Invalid move" });
        return;
      }
      const { matchId, moveNumber, board, cell } = parsed.data;
      const result = matches.playMove(matchId, user.userId, moveNumber, {
        board: board as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
        cell: cell as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
      });
      if (!result.ok) {
        socket.emit("error", { code: "ILLEGAL_MOVE", message: result.error });
        const live = matches.get(matchId);
        if (live) {
          socket.emit("matchUpdate", matches.snapshot(live, user.userId));
        }
        return;
      }
      const match = result.match;
      // The move log is a record of the game, not part of playing it: waiting
      // on Postgres here put a database round trip inside every turn.
      if (db && match.state.moveCount === moveNumber) {
        const mover = moveNumber % 2 === 1 ? "X" : "O";
        void persistMove(db, matchId, moveNumber, mover, board, cell).catch(
          (err) => console.error("[realtime] persistMove failed", err),
        );
      }

      if (match.state.status === "in_progress") {
        for (const seat of ["X", "O"] as const) {
          io.to(match.sockets[seat]).emit(
            "matchUpdate",
            matches.snapshot(match, match.players[seat].userId),
          );
        }
      } else {
        await emitEnded(match);
      }
    });

    socket.on("resign", async (raw) => {
      const parsed = ClientEvents.resign.safeParse(raw);
      if (!parsed.success) return;
      const match = matches.resign(parsed.data.matchId, user.userId);
      if (match) await emitEnded(match);
    });

    socket.on("sync", (raw) => {
      const parsed = ClientEvents.sync.safeParse(raw);
      if (!parsed.success) return;
      const match = matches.get(parsed.data.matchId);
      if (!match) return;
      socket.emit("matchUpdate", matches.snapshot(match, user.userId));
    });

    socket.on("ping", (t) => {
      socket.emit("pong", {
        t: typeof t === "number" ? t : Date.now(),
        serverNow: Date.now(),
      });
    });

    socket.on("disconnect", () => {
      untrackSocket(user.userId, socket.id);
      presenceSockets.delete(socket.id);
      // Nobody can answer a request once their last tab is gone.
      if (!isOnline(user.userId)) {
        for (const challenge of challenges.involving(user.userId)) {
          resolveChallenge(challenge, "offline");
        }
      }
      queue.leaveBySocket(user.userId, socket.id);
      const room = rooms.onDisconnect(user.userId, socket.id);
      if (room) emitRoom(room);
      const affected = matches.onDisconnect(user.userId, socket.id);
      logEvent("disconnect", {
        userId: user.userId,
        socketId: socket.id,
        startedGrace: Boolean(affected),
        matchId: affected?.id,
      });
    });
  });

  const sweepTimer = setInterval(() => {
    tryPair("casual");
    tryPair("ranked");
    sweepRateLimit();
    const ended = matches.sweep();
    for (const m of ended) {
      void emitEnded(m);
    }
    for (const room of rooms.sweep()) {
      for (const socketId of rooms.socketsOf(room)) {
        io.to(socketId).emit("roomClosed", {
          code: room.code,
          reason: "expired",
        });
      }
    }
    for (const challenge of challenges.sweep()) {
      resolveChallenge(challenge, "expired");
    }
  }, 1000);

  return {
    io,
    httpServer,
    queue,
    matches,
    rooms,
    challenges,
    stopSweep: () => clearInterval(sweepTimer),
    close: async () => {
      clearInterval(sweepTimer);
      await new Promise<void>((resolve) => {
        io.close(() => resolve());
      });
      await new Promise<void>((resolve) => {
        if (!httpServer.listening) {
          resolve();
          return;
        }
        httpServer.close(() => resolve());
      });
    },
    getSeasonId: () => seasonId,
    setSeasonId: (id) => {
      seasonId = id;
    },
  };
}

export async function bootstrapSeason(db: Db | null) {
  if (!db) return null;
  const season = await ensureActiveSeason(db);
  return season;
}

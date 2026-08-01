"use client";

import type { MatchSnapshot, RoomSnapshot } from "@uttt/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

export type RoomPhase =
  | "idle"
  | "connecting"
  | "lobby"
  | "playing"
  | "ended"
  | "closed"
  | "error";

interface TokenResponse {
  token: string;
  realtimeUrl: string;
}

export interface UseRoomOptions {
  /** Create a room as soon as the socket is up. */
  autoCreate?: boolean;
  /** Join this code as soon as the socket is up. */
  joinCode?: string | null;
}

export function useRoom(opts: UseRoomOptions = {}) {
  const { autoCreate = false, joinCode = null } = opts;

  const [phase, setPhase] = useState<RoomPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [match, setMatch] = useState<MatchSnapshot | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);

  const generationRef = useRef(0);
  const socketRef = useRef<Socket | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const matchRef = useRef<MatchSnapshot | null>(null);
  const roomRef = useRef<RoomSnapshot | null>(null);
  const intentRef = useRef<"create" | "join" | null>(null);
  const joinCodeRef = useRef<string | null>(joinCode);
  const failedAttemptsRef = useRef(0);

  useEffect(() => {
    matchRef.current = match;
  }, [match]);
  useEffect(() => {
    roomRef.current = room;
  }, [room]);
  useEffect(() => {
    joinCodeRef.current = joinCode;
  }, [joinCode]);

  const detachSocket = useCallback((socket: Socket | null) => {
    if (!socket) return;
    socket.removeAllListeners();
    socket.disconnect();
  }, []);

  const stop = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    const sock = socketRef.current;
    socketRef.current = null;
    detachSocket(sock);
  }, [detachSocket]);

  const wireSocket = useCallback(
    (socket: Socket, generation: number) => {
      const applyMatch = (snap: MatchSnapshot) => {
        if (generation !== generationRef.current) return;
        matchRef.current = snap;
        setMatch(snap);
        setPhase(snap.status === "in_progress" ? "playing" : "ended");
      };

      socket.on("connect", () => {
        if (generation !== generationRef.current) return;
        failedAttemptsRef.current = 0;
        setError(null);
        socket.emit("ping", Date.now());

        const live = matchRef.current;
        if (live && live.status === "in_progress") {
          socket.emit("sync", { matchId: live.matchId });
          return;
        }

        const existing = roomRef.current;
        if (existing) {
          socket.emit("roomJoin", { code: existing.code });
          return;
        }

        const intent = intentRef.current;
        if (intent === "create") {
          socket.emit("roomCreate", {});
        } else if (intent === "join" && joinCodeRef.current) {
          socket.emit("roomJoin", { code: joinCodeRef.current });
        } else {
          setPhase("idle");
        }
      });

      socket.on("pong", (payload: { t?: number; serverNow?: number }) => {
        if (
          typeof payload?.serverNow === "number" &&
          typeof payload?.t === "number"
        ) {
          const rtt = Date.now() - payload.t;
          setServerOffsetMs(payload.serverNow + rtt / 2 - Date.now());
        }
      });

      socket.on("roomUpdate", (snap: RoomSnapshot) => {
        if (generation !== generationRef.current) return;
        roomRef.current = snap;
        setRoom(snap);
        setError(null);
        if (snap.status === "playing") return;
        const live = matchRef.current;
        // Keep the results screen after a finished game so rematch sits on top
        // of it; only drop to a plain lobby when there is no match yet.
        if (live && live.status !== "in_progress") {
          const guestId = snap.guest?.player.id;
          const sameOpponent =
            !guestId ||
            live.players.X.id === guestId ||
            live.players.O.id === guestId;
          if (sameOpponent) {
            setPhase("ended");
            return;
          }
          // Somebody else is sitting across the table now; the old scoreline
          // would read as a game they just lost.
          matchRef.current = null;
          setMatch(null);
        }
        setPhase("lobby");
      });

      socket.on(
        "roomClosed",
        (payload: { code?: string; reason?: "left" | "expired" }) => {
          if (generation !== generationRef.current) return;
          roomRef.current = null;
          setRoom(null);
          matchRef.current = null;
          setMatch(null);
          intentRef.current = null;
          if (payload.reason === "left") {
            setError(null);
            setPhase("idle");
            return;
          }
          setPhase("closed");
          setError("roomExpired");
        },
      );

      socket.on("matchFound", applyMatch);
      socket.on("matchUpdate", applyMatch);

      socket.on("matchEnded", (snap: MatchSnapshot) => {
        if (generation !== generationRef.current) return;
        matchRef.current = snap;
        setMatch(snap);
        setPhase("ended");
      });

      socket.on("error", (err: { code?: string; message?: string }) => {
        if (generation !== generationRef.current) return;
        if (err.code === "SESSION_TAKEN") {
          setError(err.message ?? "Session taken");
          setPhase("error");
          return;
        }
        if (err.code === "ILLEGAL_MOVE" && matchRef.current) {
          socket.emit("sync", { matchId: matchRef.current.matchId });
          return;
        }
        if (
          err.code === "ROOM_NOT_FOUND" ||
          err.code === "ROOM_FULL" ||
          err.code === "ROOM_BUSY" ||
          err.code === "ROOM_UNAVAILABLE" ||
          err.code === "BAD_REQUEST"
        ) {
          setError(err.code);
          // Drop a failed join attempt back to the setup screen.
          if (!roomRef.current) {
            intentRef.current = null;
            setPhase("idle");
          }
          return;
        }
        setError(err.message ?? "Error");
      });

      // Socket.IO retries on its own, so a single failure is a blip, not a dead
      // end. Tearing the room down on the first one threw players out of a live
      // game every time the connection hiccuped.
      socket.on("connect_error", () => {
        if (generation !== generationRef.current) return;
        failedAttemptsRef.current += 1;
        setError("reconnect");
        if (failedAttemptsRef.current >= 5) setPhase("error");
      });
    },
    [],
  );

  const ensureSocket = useCallback(async () => {
    if (socketRef.current?.connected) return socketRef.current;

    const generation = generationRef.current;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    failedAttemptsRef.current = 0;

    setPhase("connecting");
    setError(null);

    const res = await fetch("/api/realtime-token", { signal: abort.signal });
    if (!res.ok) throw new Error("Failed to get token");
    const data = (await res.json()) as TokenResponse;
    if (generation !== generationRef.current) return null;

    const previous = socketRef.current;
    socketRef.current = null;
    detachSocket(previous);

    const socket = io(data.realtimeUrl, {
      auth: { token: data.token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 500,
    });

    if (generation !== generationRef.current) {
      detachSocket(socket);
      return null;
    }

    socketRef.current = socket;
    wireSocket(socket, generation);
    return socket;
  }, [detachSocket, wireSocket]);

  const create = useCallback(async () => {
    try {
      intentRef.current = "create";
      joinCodeRef.current = null;
      setMatch(null);
      matchRef.current = null;
      setRoom(null);
      roomRef.current = null;
      const socket = await ensureSocket();
      if (!socket) return;
      if (socket.connected) socket.emit("roomCreate", {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setPhase("error");
    }
  }, [ensureSocket]);

  const join = useCallback(
    async (code: string) => {
      try {
        intentRef.current = "join";
        joinCodeRef.current = code;
        setMatch(null);
        matchRef.current = null;
        setRoom(null);
        roomRef.current = null;
        const socket = await ensureSocket();
        if (!socket) return;
        if (socket.connected) socket.emit("roomJoin", { code });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
        setPhase("error");
      }
    },
    [ensureSocket],
  );

  // Boot once with the intent encoded in the URL.
  useEffect(() => {
    if (autoCreate) void create();
    else if (joinCode) void join(joinCode);
    return () => {
      stop();
    };
    // Mount-only: later navigations remount the page with new props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMove = useCallback((board: number, cell: number) => {
    const sock = socketRef.current;
    const current = matchRef.current;
    if (!sock || !current || current.status !== "in_progress") return;
    sock.emit("move", {
      matchId: current.matchId,
      moveNumber: current.moveCount + 1,
      board,
      cell,
    });
  }, []);

  const resign = useCallback(() => {
    const sock = socketRef.current;
    const current = matchRef.current;
    if (!sock || !current) return;
    sock.emit("resign", { matchId: current.matchId });
  }, []);

  const rematch = useCallback(() => {
    socketRef.current?.emit("roomRematch", {});
  }, []);

  const leave = useCallback(() => {
    socketRef.current?.emit("roomLeave", {});
    intentRef.current = null;
    roomRef.current = null;
    matchRef.current = null;
    setRoom(null);
    setMatch(null);
    setPhase("idle");
  }, []);

  return {
    phase,
    error,
    room,
    match,
    serverOffsetMs,
    create,
    join,
    leave,
    rematch,
    onMove,
    resign,
    stop,
  };
}

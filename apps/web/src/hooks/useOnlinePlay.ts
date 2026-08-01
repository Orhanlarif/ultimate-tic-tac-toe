"use client";

import type { MatchSnapshot, QueueMode } from "@uttt/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

export type PlayPhase =
  | "idle"
  | "connecting"
  | "queued"
  | "playing"
  | "ended"
  | "error";

interface TokenResponse {
  token: string;
  realtimeUrl: string;
  user: { isGuest: boolean };
}

export function useOnlinePlay(mode: QueueMode) {
  const [phase, setPhase] = useState<PlayPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchSnapshot | null>(null);
  const [ratingDelta, setRatingDelta] = useState<
    { before: number; after: number } | undefined
  >();
  const [isGuest, setIsGuest] = useState(false);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);

  const generationRef = useRef(0);
  const socketRef = useRef<Socket | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const matchRef = useRef<MatchSnapshot | null>(null);

  useEffect(() => {
    matchRef.current = match;
  }, [match]);

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

  const start = useCallback(async () => {
    const generation = ++generationRef.current;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    const previous = socketRef.current;
    socketRef.current = null;
    detachSocket(previous);

    setError(null);
    setRatingDelta(undefined);
    setMatch(null);
    matchRef.current = null;
    setPhase("connecting");

    try {
      const res = await fetch("/api/realtime-token", { signal: abort.signal });
      if (!res.ok) throw new Error("Failed to get token");
      const data = (await res.json()) as TokenResponse;

      if (generation !== generationRef.current) return;

      setIsGuest(data.user.isGuest);
      if (mode === "ranked" && data.user.isGuest) {
        setPhase("error");
        setError("guestCasualOnly");
        return;
      }

      const socket = io(data.realtimeUrl, {
        auth: { token: data.token },
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: 8,
        reconnectionDelay: 500,
      });

      if (generation !== generationRef.current) {
        detachSocket(socket);
        return;
      }
      socketRef.current = socket;

      const applySnapshot = (snap: MatchSnapshot) => {
        if (generation !== generationRef.current) return;
        matchRef.current = snap;
        setMatch(snap);
        setPhase(snap.status === "in_progress" ? "playing" : "ended");
      };

      socket.on("connect", () => {
        if (generation !== generationRef.current) return;
        const sent = Date.now();
        socket.emit("ping", sent);
        const live = matchRef.current;
        if (live && live.status === "in_progress") {
          socket.emit("sync", { matchId: live.matchId });
        } else {
          setPhase("queued");
          socket.emit("queueJoin", { mode });
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

      socket.on("queueWaiting", () => {
        if (generation !== generationRef.current) return;
        setPhase("queued");
      });

      socket.on("matchFound", applySnapshot);
      socket.on("matchUpdate", applySnapshot);

      socket.on(
        "matchEnded",
        (
          snap: MatchSnapshot & {
            ratingDelta?: { before: number; after: number };
          },
        ) => {
          if (generation !== generationRef.current) return;
          matchRef.current = snap;
          setMatch(snap);
          setRatingDelta(snap.ratingDelta);
          setPhase("ended");
        },
      );

      socket.on("error", (err: { code?: string; message?: string }) => {
        if (generation !== generationRef.current) return;
        if (err.code === "SESSION_TAKEN") {
          setError(err.message ?? "Session taken");
          setPhase("error");
          return;
        }
        if (err.code === "ILLEGAL_MOVE" && matchRef.current) {
          socket.emit("sync", { matchId: matchRef.current.matchId });
        }
        setError(err.message ?? "Error");
        if (err.message?.includes("Sign in")) setPhase("error");
      });

      socket.on("connect_error", () => {
        if (generation !== generationRef.current) return;
        setError("reconnect");
        setPhase("error");
      });
    } catch (e) {
      if (abort.signal.aborted || generation !== generationRef.current) return;
      setError(e instanceof Error ? e.message : "Failed");
      setPhase("error");
    }
  }, [detachSocket, mode]);

  useEffect(() => {
    void start();
    return () => {
      stop();
    };
  }, [start, stop]);

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

  const cancelQueue = useCallback(() => {
    socketRef.current?.emit("queueLeave");
    stop();
  }, [stop]);

  return {
    phase,
    error,
    match,
    ratingDelta,
    isGuest,
    serverOffsetMs,
    start,
    stop,
    onMove,
    resign,
    cancelQueue,
  };
}

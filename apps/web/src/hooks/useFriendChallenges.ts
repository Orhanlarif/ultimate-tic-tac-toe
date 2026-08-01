"use client";

import type { ChallengeOutcome, PublicPlayer } from "@uttt/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

const PRESENCE_POLL_MS = 15_000;

export interface IncomingChallenge {
  id: string;
  from: PublicPlayer;
  expiresAt: number;
}

export interface OutgoingChallenge {
  /** Missing until the server confirms the request. */
  id: string | null;
  toUserId: string;
  expiresAt: number | null;
}

/** Short code the page turns into a sentence; never shown raw. */
export type ChallengeNotice =
  | ChallengeOutcome
  | "userOffline"
  | "userBusy"
  | "selfBusy"
  | "failed";

interface TokenResponse {
  token: string;
  realtimeUrl: string;
  user: { isGuest: boolean };
}

/**
 * A play request is a live conversation, so the friends list keeps its own
 * socket open. It connects in presence mode: it can be challenged and can
 * challenge, but it never claims a seat in a game the user has open elsewhere.
 */
export function useFriendChallenges(friendIds: string[], enabled: boolean) {
  const router = useRouter();

  const [online, setOnline] = useState<string[]>([]);
  const [incoming, setIncoming] = useState<IncomingChallenge[]>([]);
  const [outgoing, setOutgoing] = useState<OutgoingChallenge | null>(null);
  const [notice, setNotice] = useState<ChallengeNotice | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const friendIdsRef = useRef<string[]>(friendIds);
  const outgoingRef = useRef<OutgoingChallenge | null>(null);

  useEffect(() => {
    outgoingRef.current = outgoing;
  }, [outgoing]);

  const askPresence = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected || friendIdsRef.current.length === 0) return;
    socket.emit("presenceQuery", { userIds: friendIdsRef.current });
  }, []);

  useEffect(() => {
    friendIdsRef.current = friendIds;
    askPresence();
  }, [friendIds, askPresence]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let socket: Socket | null = null;
    const abort = new AbortController();

    async function connect() {
      const res = await fetch("/api/realtime-token", { signal: abort.signal });
      if (!res.ok) throw new Error("Failed to get token");
      const data = (await res.json()) as TokenResponse;
      if (cancelled || data.user.isGuest) return;

      socket = io(data.realtimeUrl, {
        auth: { token: data.token, presence: true },
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: 8,
        reconnectionDelay: 500,
      });
      if (cancelled) {
        socket.disconnect();
        return;
      }
      socketRef.current = socket;

      socket.on("connect", askPresence);

      socket.on("presenceUpdate", (payload: { online?: string[] }) => {
        setOnline(payload?.online ?? []);
      });

      socket.on("challengeReceived", (payload: IncomingChallenge) => {
        setIncoming((list) => [
          ...list.filter((c) => c.from.id !== payload.from.id),
          payload,
        ]);
      });

      socket.on(
        "challengeSent",
        (payload: { id: string; toUserId: string; expiresAt: number }) => {
          setOutgoing(payload);
          setNotice(null);
        },
      );

      socket.on(
        "challengeResolved",
        (payload: { id: string; outcome: ChallengeOutcome }) => {
          setIncoming((list) => list.filter((c) => c.id !== payload.id));
          if (outgoingRef.current?.id !== payload.id) return;
          setOutgoing(null);
          setNotice(payload.outcome);
        },
      );

      socket.on("challengeAccepted", (payload: { code: string }) => {
        setOutgoing(null);
        setIncoming([]);
        router.push(`/play/room/${payload.code}`);
      });

      socket.on("error", (err: { code?: string }) => {
        if (err.code === "USER_OFFLINE") setNotice("userOffline");
        else if (err.code === "USER_BUSY") setNotice("userBusy");
        else if (err.code === "ROOM_BUSY") setNotice("selfBusy");
        else setNotice("failed");
        setOutgoing(null);
      });
    }

    void connect().catch(() => {
      if (!cancelled) setNotice("failed");
    });

    const poll = setInterval(askPresence, PRESENCE_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(poll);
      abort.abort();
      socketRef.current = null;
      socket?.removeAllListeners();
      socket?.disconnect();
    };
  }, [enabled, askPresence, router]);

  // The server sweeps expired requests, but a dropped connection would
  // otherwise leave a card nobody can answer sitting on screen.
  useEffect(() => {
    const tick = setInterval(() => {
      const now = Date.now();
      setIncoming((list) => {
        const kept = list.filter((c) => c.expiresAt > now);
        return kept.length === list.length ? list : kept;
      });
      const current = outgoingRef.current;
      if (current?.expiresAt && current.expiresAt <= now) {
        setOutgoing(null);
        setNotice("expired");
      }
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  const challenge = useCallback((toUserId: string) => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setNotice("failed");
      return;
    }
    setNotice(null);
    setOutgoing({ id: null, toUserId, expiresAt: null });
    socket.emit("challengeSend", { toUserId });
  }, []);

  const cancelChallenge = useCallback(() => {
    const current = outgoingRef.current;
    setOutgoing(null);
    if (current?.id) socketRef.current?.emit("challengeCancel", { id: current.id });
  }, []);

  const respond = useCallback((id: string, accept: boolean) => {
    setIncoming((list) => list.filter((c) => c.id !== id));
    socketRef.current?.emit("challengeRespond", { id, accept });
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    online,
    incoming,
    outgoing,
    notice,
    challenge,
    cancelChallenge,
    respond,
    dismissNotice,
  };
}

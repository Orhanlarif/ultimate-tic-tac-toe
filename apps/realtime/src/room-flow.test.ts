import type { MatchSnapshot, RoomSnapshot } from "@uttt/contracts";
import { SignJWT } from "jose";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRealtimeServer, type RealtimeServer } from "./server.js";

const SECRET = "test-secret-room-flow";

async function token(sub: string, name: string) {
  return new SignJWT({
    displayName: name,
    isGuest: true,
    rating: 1500,
    rd: 350,
    volatility: 0.06,
    league: "bronze",
    placementGames: 0,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}

function next<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for ${event}`)),
      2000,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe("room lifecycle over sockets", () => {
  let server: RealtimeServer;
  let port: number;
  let host: ClientSocket;
  let guest: ClientSocket;

  beforeAll(async () => {
    server = createRealtimeServer({
      jwtSecret: SECRET,
      memoryOnly: true,
      db: null,
      corsOrigin: "*",
    });
    await new Promise<void>((resolve) => {
      server.httpServer.listen(0, () => resolve());
    });
    port = (server.httpServer.address() as { port: number }).port;

    const [th, tg] = await Promise.all([
      token("host", "Hakan"),
      token("guest", "Gizem"),
    ]);
    host = ioc(`http://127.0.0.1:${port}`, {
      auth: { token: th },
      transports: ["websocket"],
    });
    guest = ioc(`http://127.0.0.1:${port}`, {
      auth: { token: tg },
      transports: ["websocket"],
    });
    await Promise.all([
      new Promise<void>((r) => host.on("connect", () => r())),
      new Promise<void>((r) => guest.on("connect", () => r())),
    ]);
  });

  afterAll(async () => {
    host?.disconnect();
    guest?.disconnect();
    await server.close();
  });

  it("runs create -> join -> resign -> reopen without a stale-match lockout", async () => {
    const created = next<RoomSnapshot>(host, "roomUpdate");
    host.emit("roomCreate", {});
    const room = await created;
    expect(room.code).toHaveLength(5);
    expect(room.youAre).toBe("host");
    expect(room.guest).toBeNull();

    // A pasted invite link keeps whatever case the browser hands back.
    const started = Promise.all([
      next<MatchSnapshot>(host, "matchFound"),
      next<MatchSnapshot>(guest, "matchFound"),
    ]);
    guest.emit("roomJoin", { code: room.code.toLowerCase() });
    const [hostMatch, guestMatch] = await started;
    expect(hostMatch.matchId).toBe(guestMatch.matchId);
    expect(hostMatch.mode).toBe("private");
    expect(hostMatch.youAre).not.toBe(guestMatch.youAre);

    const ended = Promise.all([
      next<MatchSnapshot>(host, "matchEnded"),
      next<MatchSnapshot>(guest, "matchEnded"),
    ]);
    const afterGame = next<RoomSnapshot>(guest, "roomUpdate");
    host.emit("resign", { matchId: hostMatch.matchId });
    const [hostEnd] = await ended;
    expect(hostEnd.endedReason).toBe("resign");
    expect(hostEnd.winner).toBe(hostMatch.youAre === "X" ? "O" : "X");

    const scored = await afterGame;
    expect(scored.score).toEqual({ host: 0, guest: 1, draw: 0 });
    expect(scored.matchId).toBeNull();
    expect(scored.status).toBe("waiting");

    // The finished match lingers for late reconnects; it must not read as
    // "you are still busy" when the host opens a fresh room right away.
    const reopened = next<RoomSnapshot>(host, "roomUpdate");
    host.emit("roomCreate", {});
    const second = await reopened;
    expect(second.code).not.toBe(room.code);
    expect(second.guest).toBeNull();
    expect(second.score).toEqual({ host: 0, guest: 0, draw: 0 });
  });

  it("lets a player queue again right after a room game ends", async () => {
    const waiting = next<{ mode: string }>(host, "queueWaiting");
    host.emit("queueJoin", { mode: "casual" });
    expect((await waiting).mode).toBe("casual");
    host.emit("queueLeave", {});
  });

  it("reports a bad code instead of silently hanging", async () => {
    const err = next<{ code: string }>(guest, "error");
    guest.emit("roomJoin", { code: "AAAAA" });
    expect((await err).code).toBe("ROOM_NOT_FOUND");
  });
});

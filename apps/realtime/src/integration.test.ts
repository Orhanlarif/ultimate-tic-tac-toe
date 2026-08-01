import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import { createRealtimeServer, type RealtimeServer } from "./server.js";

const SECRET = "test-secret-lifecycle";

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

describe("production realtime server lifecycle", () => {
  let server: RealtimeServer;
  let port: number;
  let clientA: ClientSocket;
  let clientB: ClientSocket;

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

    const [ta, tb] = await Promise.all([
      token("u1", "Alice"),
      token("u2", "Bob"),
    ]);
    clientA = ioc(`http://127.0.0.1:${port}`, {
      auth: { token: ta },
      transports: ["websocket"],
    });
    clientB = ioc(`http://127.0.0.1:${port}`, {
      auth: { token: tb },
      transports: ["websocket"],
    });
    await Promise.all([
      new Promise<void>((r) => clientA.on("connect", () => r())),
      new Promise<void>((r) => clientB.on("connect", () => r())),
    ]);
  });

  afterAll(async () => {
    clientA?.disconnect();
    clientB?.disconnect();
    await server.close();
  });

  it("matches two clients and accepts a legal move", async () => {
    const found = Promise.all([
      new Promise<unknown>((r) => clientA.once("matchFound", r)),
      new Promise<unknown>((r) => clientB.once("matchFound", r)),
    ]);
    clientA.emit("queueJoin", { mode: "casual" });
    clientB.emit("queueJoin", { mode: "casual" });
    const [snapA, snapB] = (await found) as [
      { matchId: string; youAre: string; moveCount: number },
      { matchId: string; youAre: string; moveCount: number },
    ];
    expect(snapA.matchId).toBe(snapB.matchId);

    const xClient = snapA.youAre === "X" ? clientA : clientB;
    const update = new Promise<{ moveCount: number }>((r) => {
      clientA.once("matchUpdate", r);
    });
    xClient.emit("move", {
      matchId: snapA.matchId,
      moveNumber: 1,
      board: 4,
      cell: 4,
    });
    const next = await update;
    expect(next.moveCount).toBe(1);
  });

  it("ignores stale socket disconnect while authoritative socket stays", async () => {
    // Create a second socket for Alice (stale), then disconnect it
    const ta = await token("u1", "Alice");
    const stale = ioc(`http://127.0.0.1:${port}`, {
      auth: { token: ta },
      transports: ["websocket"],
    });
    await new Promise<void>((r) => stale.on("connect", () => r()));

    const live = server.matches.getByUser("u1");
    expect(live).toBeTruthy();
    if (!live) return;

    // Authoritative socket was updated to stale on reconnect — reconnect original A
    server.matches.onReconnect("u1", clientA.id!);
    const seat = server.matches.seatOf(live, "u1")!;
    expect(live.sockets[seat]).toBe(clientA.id);

    stale.disconnect();
    await new Promise((r) => setTimeout(r, 50));
    expect(live.disconnectDeadline[seat]).toBeNull();
    expect(live.state.status).toBe("in_progress");
  });
});

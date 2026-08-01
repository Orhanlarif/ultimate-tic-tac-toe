import type { MatchSnapshot, PublicPlayer } from "@uttt/contracts";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRealtimeServer, type RealtimeServer } from "./server.js";

const SECRET = "test-secret-challenge-flow";
const ALICE = randomUUID();
const BORA = randomUUID();

async function token(sub: string, name: string) {
  return new SignJWT({
    displayName: name,
    isGuest: false,
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

describe("friend play requests", () => {
  let server: RealtimeServer;
  let alice: ClientSocket;
  let bora: ClientSocket;

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
    const { port } = server.httpServer.address() as { port: number };

    const [ta, tb] = await Promise.all([
      token(ALICE, "Alice"),
      token(BORA, "Bora"),
    ]);
    alice = ioc(`http://127.0.0.1:${port}`, {
      auth: { token: ta, presence: true },
      transports: ["websocket"],
    });
    bora = ioc(`http://127.0.0.1:${port}`, {
      auth: { token: tb, presence: true },
      transports: ["websocket"],
    });
    await Promise.all([
      new Promise<void>((r) => alice.on("connect", () => r())),
      new Promise<void>((r) => bora.on("connect", () => r())),
    ]);
  });

  afterAll(async () => {
    alice?.disconnect();
    bora?.disconnect();
    await server.close();
  });

  it("reports which friends are connected", async () => {
    const seen = next<{ online: string[] }>(alice, "presenceUpdate");
    alice.emit("presenceQuery", { userIds: [BORA, randomUUID()] });
    expect((await seen).online).toEqual([BORA]);
  });

  it("refuses a request to somebody who is not connected", async () => {
    const err = next<{ code: string }>(alice, "error");
    alice.emit("challengeSend", { toUserId: randomUUID() });
    expect((await err).code).toBe("USER_OFFLINE");
  });

  it("tells the challenger when their request is declined", async () => {
    const delivered = next<{ id: string; from: PublicPlayer }>(
      bora,
      "challengeReceived",
    );
    const acked = next<{ id: string }>(alice, "challengeSent");
    alice.emit("challengeSend", { toUserId: BORA });

    const [received, sent] = await Promise.all([delivered, acked]);
    expect(received.id).toBe(sent.id);
    expect(received.from.displayName).toBe("Alice");

    const resolved = next<{ id: string; outcome: string }>(
      alice,
      "challengeResolved",
    );
    bora.emit("challengeRespond", { id: received.id, accept: false });
    expect(await resolved).toEqual({ id: received.id, outcome: "declined" });
  });

  it("drops both players into one room when the request is accepted", async () => {
    const delivered = next<{ id: string }>(bora, "challengeReceived");
    alice.emit("challengeSend", { toUserId: BORA });
    const { id } = await delivered;

    const landed = Promise.all([
      next<{ code: string }>(alice, "challengeAccepted"),
      next<{ code: string }>(bora, "challengeAccepted"),
    ]);
    bora.emit("challengeRespond", { id, accept: true });
    const [forAlice, forBora] = await landed;
    expect(forAlice.code).toBe(forBora.code);

    // Both sides walk into the room the request opened for them.
    const started = Promise.all([
      next<MatchSnapshot>(alice, "matchFound"),
      next<MatchSnapshot>(bora, "matchFound"),
    ]);
    alice.emit("roomJoin", { code: forAlice.code });
    bora.emit("roomJoin", { code: forBora.code });
    const [aliceMatch, boraMatch] = await started;
    expect(aliceMatch.matchId).toBe(boraMatch.matchId);
    expect(aliceMatch.mode).toBe("private");
    expect(aliceMatch.youAre).not.toBe(boraMatch.youAre);
  });
});

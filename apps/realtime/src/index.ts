import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });
config();

import { createDb } from "@uttt/db";
import { bootstrapSeason, createRealtimeServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 3001);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:3000";
const isProd = process.env.NODE_ENV === "production";
const JWT_SECRET = process.env.REALTIME_JWT_SECRET ?? "dev-realtime-secret";
const DATABASE_URL = process.env.DATABASE_URL;
const MEMORY_ONLY = process.env.MEMORY_ONLY === "1" || !DATABASE_URL;

if (isProd) {
  if (!process.env.REALTIME_JWT_SECRET) {
    throw new Error("REALTIME_JWT_SECRET must be set in production");
  }
  if (MEMORY_ONLY) {
    throw new Error(
      "DATABASE_URL must be set in production (MEMORY_ONLY is not allowed)",
    );
  }
}

const db = MEMORY_ONLY ? null : createDb(DATABASE_URL!);
const server = createRealtimeServer({
  corsOrigin: CORS_ORIGIN,
  jwtSecret: JWT_SECRET,
  db,
  memoryOnly: MEMORY_ONLY,
});

const season = await bootstrapSeason(db);
if (season) {
  server.setSeasonId(season.id);
  console.log(`[realtime] season=${season.name} (${season.id})`);
} else {
  console.log("[realtime] MEMORY_ONLY mode — no Postgres persistence");
}

server.httpServer.listen(PORT, () => {
  console.log(`[realtime] listening on :${PORT}`);
});

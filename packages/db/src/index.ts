import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export * from "./schema.js";

function connect(connectionString: string) {
  const client = postgres(connectionString, { max: 10 });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof connect>;

/**
 * Pools are shared per connection string. Route handlers call this on every
 * request, and opening a fresh pool each time walks Postgres straight into its
 * connection limit. The cache lives on globalThis so a dev-server reload
 * reuses the pool instead of stacking a new one on top.
 */
const globalForDb = globalThis as typeof globalThis & {
  __uttt_db_pools?: Map<string, Db>;
};

export function createDb(connectionString: string): Db {
  const pools = (globalForDb.__uttt_db_pools ??= new Map<string, Db>());
  const existing = pools.get(connectionString);
  if (existing) return existing;
  const db = connect(connectionString);
  pools.set(connectionString, db);
  return db;
}

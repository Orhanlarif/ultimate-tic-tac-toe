import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("SKIP: no DATABASE_URL");
  process.exit(0);
}

const sql = postgres(url, { max: 1 });
try {
  await sql`ALTER TABLE ratings ALTER COLUMN rating SET DEFAULT 300`;
  const r = await sql`
    UPDATE ratings
    SET rating = 300, league = 'gold', rd = 350, volatility = 0.06, updated_at = NOW()
    RETURNING user_id
  `;
  console.log(`RESET_OK rows=${r.length}`);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  const code = e && typeof e === "object" && "code" in e ? String(e.code) : "";
  console.log(`RESET_FAIL code=${code} msg=${msg || "(empty)"}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 2 });
}

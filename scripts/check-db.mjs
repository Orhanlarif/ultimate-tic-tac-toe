import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(url, { ssl: "require", max: 1 });

try {
  const tables = await sql`
    select table_name from information_schema.tables
    where table_schema = 'public' order by table_name
  `;
  console.log("TABLES:", tables.map((r) => r.table_name).join(", ") || "(none)");

  const enums = await sql`
    select typname from pg_type where typtype = 'e' order by typname
  `;
  console.log("ENUMS:", enums.map((r) => r.typname).join(", ") || "(none)");

  const [{ version }] = await sql`select version()`;
  console.log("SERVER:", version.split(",")[0]);
} finally {
  await sql.end();
}

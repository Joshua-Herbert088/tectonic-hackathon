// Applies database migrations and exits: `npm run db:migrate` (e.g. before starting with MIGRATE_ON_START=false).
// Plain JavaScript so it runs without TypeScript.
import path from "node:path";

const migrationsFolder = path.join(process.cwd(), "drizzle");
const LOCK = 724583; // same advisory lock as the app's startup

if (process.env.DATABASE_URL) {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK]);
    await migrate(drizzle(client), { migrationsFolder });
    await client.query("select pg_advisory_unlock($1)", [LOCK]);
  } finally {
    client.release();
    await pool.end();
  }
} else {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const db = new PGlite(process.env.PGLITE_DIR ?? path.join(process.cwd(), "data", "pglite"));
  await migrate(drizzle(db), { migrationsFolder });
  await db.close();
}
console.log(JSON.stringify({ severity: "INFO", message: "migrations applied" }));

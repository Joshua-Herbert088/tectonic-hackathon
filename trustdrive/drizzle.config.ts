import { defineConfig } from "drizzle-kit";

// Postgres when DATABASE_URL is set, otherwise the local PGlite database (same as the app).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  ...(process.env.DATABASE_URL ? { dbCredentials: { url: process.env.DATABASE_URL } } : { driver: "pglite" as const, dbCredentials: { url: "./data/pglite" } }),
});

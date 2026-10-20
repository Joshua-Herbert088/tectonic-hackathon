import path from "node:path";
import { z } from "zod";

/**
 * Server configuration from environment variables, validated once. Everything has a default that
 * works for local development; see .env.example and DEPLOY.md for production.
 */

const flag = (fallback: boolean) =>
  z
    .enum(["1", "0", "true", "false", ""])
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : v === "1" || v === "true"));

const env = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    /** Postgres connection string. Without it, an embedded PGlite database in PGLITE_DIR is used. */
    DATABASE_URL: z.string().optional(),
    PG_POOL_SIZE: z.coerce.number().int().positive().default(5),
    /** PGlite storage directory, or "memory://" for a throwaway database. */
    PGLITE_DIR: z.string().default(path.join(process.cwd(), "data", "pglite")),
    MIGRATE_ON_START: flag(true),
    SEED_DEMO_DATA: flag(true),
    JEV_API_KEY: z.string().optional(),
    JEV_API_URL: z.string().url().default("https://jevtypesafeai.com/api/v1/decide"),
    JEV_DISABLED: flag(false),
    /** "Reset demo data" wipes the database. Allowed by default except in production, and never without demo data. */
    ALLOW_DEMO_RESET: z.enum(["1", "0", "true", "false", ""]).optional(),
    /** Signs sessions and personal sign-in codes. Without it nobody can sign in. Changing it signs everyone out and replaces every code. */
    TRUSTDRIVE_SECRET: z.union([z.literal(""), z.string().min(32, "must be at least 32 characters")]).optional(),
    /** Demo mode: the shared access code signs in, and "Viewing as" can switch to anyone. Off by default. */
    DEMO_MODE: flag(false),
    /** The shared access code, in demo mode only. */
    TRUSTDRIVE_ACCESS_CODE: z.union([z.literal(""), z.string().min(8, "must be at least 8 characters")]).optional(),
  });

function load() {
  const parsed = env.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  const e = parsed.data;
  return {
    production: e.NODE_ENV === "production",
    databaseUrl: e.DATABASE_URL,
    poolSize: e.PG_POOL_SIZE,
    pgliteDir: e.PGLITE_DIR,
    migrateOnStart: e.MIGRATE_ON_START,
    seedDemoData: e.SEED_DEMO_DATA,
    jev: { apiKey: e.JEV_API_KEY, url: e.JEV_API_URL, disabled: e.JEV_DISABLED },
    secret: e.TRUSTDRIVE_SECRET || undefined,
    demoMode: e.DEMO_MODE,
    accessCode: e.TRUSTDRIVE_ACCESS_CODE || undefined,
    allowDemoReset: e.SEED_DEMO_DATA && (e.ALLOW_DEMO_RESET ? e.ALLOW_DEMO_RESET === "1" || e.ALLOW_DEMO_RESET === "true" : e.NODE_ENV !== "production"),
  };
}

export const config = load();

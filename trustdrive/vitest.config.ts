import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // Tests never call the paid Jev API (they exercise the rule-based fallbacks) and use a throwaway
  // in-memory Postgres.
  test: { include: ["src/**/*.test.ts"], env: { JEV_DISABLED: "1", PGLITE_DIR: "memory://", NODE_ENV: "test" } },
});

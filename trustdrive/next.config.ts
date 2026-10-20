import os from "node:os";
import path from "node:path";
import type { NextConfig } from "next";

// This folder is the app, even inside the repository (which has no workspace setup).
const root = path.resolve(__dirname);

// Opening the dev server by this machine's network address (e.g. from a phone, or http://172.x.x.x:3000)
// needs that address allowed for hot reload. Read when the dev server starts, so a new network only needs
// a restart; ALLOWED_DEV_ORIGINS (comma-separated hostnames) adds others, such as a tunnel.
const devOrigins = [
  ...Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i!.address),
  ...(process.env.ALLOWED_DEV_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean),
];

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigins,
  outputFileTracingRoot: root,
  turbopack: { root },
  // Loaded with Node's require instead of bundled: PGlite ships WebAssembly files, pg has optional native
  // bindings.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "drizzle-orm"],
};

export default nextConfig;

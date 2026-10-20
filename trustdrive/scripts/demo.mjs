// npm run demo: starts TrustDrive in demo mode for someone trying it out, and tells them how to sign in.
// Nothing to configure: the secret and the access code are made up for this run (or taken from the
// environment), and a free port is picked. Data is kept in data/pglite between runs.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const [major] = process.versions.node.split(".").map(Number);
if (major < 22) {
  console.error(`\nTrustDrive needs Node.js 22 or newer, and this is ${process.version}.\nInstall the current LTS from https://nodejs.org and run npm run demo again.\n`);
  process.exit(1);
}

const free = (port) =>
  new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port);
  });
let port = Number(process.env.PORT) || 3000;
while (!(await free(port))) port++;

const code = process.env.TRUSTDRIVE_ACCESS_CODE || `demo-${randomBytes(3).toString("hex")}`;
const url = `http://localhost:${port}`;
const env = {
  ...process.env,
  DEMO_MODE: "1",
  ALLOW_DEMO_RESET: "1",
  TRUSTDRIVE_ACCESS_CODE: code,
  TRUSTDRIVE_SECRET: process.env.TRUSTDRIVE_SECRET || randomBytes(32).toString("hex"),
  NEXT_TELEMETRY_DISABLED: "1",
};

const banner = () => {
  const lines = [
    "TrustDrive is running in demo mode.",
    "",
    `Open      ${url}`,
    `Sign in   ${code}`,
    "",
    "Then switch people with “Viewing as” (top right).",
    "Stop with Ctrl+C.",
  ];
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  console.log(`\n┌${"─".repeat(width)}┐\n${lines.map((l) => `│  ${l.padEnd(width - 4)}  │`).join("\n")}\n└${"─".repeat(width)}┘\n`);
};

console.log(`\nStarting TrustDrive on ${url} – the first start takes a little while…`);
const next = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(port)], { cwd: root, env, stdio: ["inherit", "pipe", "inherit"] });

let ready = false;
next.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  if (ready || !/Ready in/.test(chunk.toString())) return;
  ready = true;
  banner();
  // Open the sign-in page in the browser (not with BROWSER=none); if that doesn't work, the link above does.
  if (process.env.BROWSER === "none") return;
  const [cmd, ...args] = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => next.kill(signal));
next.on("exit", (code) => process.exit(code ?? 0));

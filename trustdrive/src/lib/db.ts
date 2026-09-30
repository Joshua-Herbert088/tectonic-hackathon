import fs from "node:fs";
import path from "node:path";
import { buildSeed } from "./seed";
import type { Db } from "./types";

const DB_PATH = path.join(process.cwd(), "data", "db.json");

export function readDb(): Db {
  if (!fs.existsSync(DB_PATH)) {
    const seed = buildSeed();
    writeDb(seed);
    return seed;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

export function writeDb(db: Db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

export function resetDb(): Db {
  const seed = buildSeed();
  writeDb(seed);
  return seed;
}

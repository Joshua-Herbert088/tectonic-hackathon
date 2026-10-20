// Prints personal sign-in codes: npm run signin-code -- <person id> [<person id> …]
// Each person signs in with their own code; see personalCode in src/lib/session.ts, which this matches.
import { createHash, createHmac } from "node:crypto";

const secret = process.env.TRUSTDRIVE_SECRET;
if (!secret || secret.length < 32) {
  console.error("Set TRUSTDRIVE_SECRET (at least 32 characters), e.g. in .env.local, first.");
  process.exit(1);
}
const ids = process.argv.slice(2);
if (!ids.length) {
  console.error("Usage: npm run signin-code -- <person id> [<person id> …]");
  process.exit(1);
}
const key = createHash("sha256").update(`trustdrive-sign-in\0${secret}`).digest();
for (const id of ids) console.log(`${id}\t${id}.${createHmac("sha256", key).update(id).digest("base64url").slice(0, 24)}`);

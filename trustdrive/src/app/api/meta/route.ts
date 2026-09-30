import { readDb } from "@/lib/db";

export async function GET() {
  const db = readDb();
  return Response.json({ teams: db.teams, people: db.people });
}

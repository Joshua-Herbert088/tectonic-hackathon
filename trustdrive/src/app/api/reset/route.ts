import { resetDb } from "@/lib/db";

export async function POST() {
  resetDb();
  return Response.json({ ok: true });
}

import type { NextRequest } from "next/server";
import { markNotificationsRead } from "@/lib/db";

/** Marks the given notification ids (or all) as read for a viewer. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  if (typeof body.viewerId !== "string") return Response.json({ error: "viewerId required" }, { status: 400 });
  markNotificationsRead(body.viewerId, Array.isArray(body.ids) ? body.ids.filter((n: unknown) => typeof n === "number") : undefined);
  return Response.json({ ok: true });
}

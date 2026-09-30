import type { NextRequest } from "next/server";
import { listNotifications } from "@/lib/db";
import { DEFAULT_VIEWER } from "@/lib/service";

export async function GET(req: NextRequest) {
  return Response.json(listNotifications(req.nextUrl.searchParams.get("viewer") ?? DEFAULT_VIEWER));
}

import { requireViewer } from "@/lib/auth";
import { listNotifications } from "@/lib/db";
import { handle } from "@/lib/http";

export const GET = handle(async (req) => Response.json(await listNotifications((await requireViewer(req)).id)));

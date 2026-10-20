import { requireViewer } from "@/lib/auth";
import { handle } from "@/lib/http";
import { homeFor } from "@/lib/service";

export const GET = handle(async (req) => Response.json(await homeFor(await requireViewer(req))));

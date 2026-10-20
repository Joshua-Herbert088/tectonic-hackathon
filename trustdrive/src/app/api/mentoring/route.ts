import { requireViewer } from "@/lib/auth";
import { handle } from "@/lib/http";
import { mentoringFor } from "@/lib/service";

/** The signed-in person's mentees, with what stands out for each, and their own mentor. */
export const GET = handle(async (req) => Response.json(await mentoringFor(await requireViewer(req))));

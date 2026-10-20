import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { decideEdit } from "@/lib/edits";
import { handle, readBody } from "@/lib/http";
import { override } from "@/lib/schemas";

/**
 * Decides on a suggested edit: propose or dismiss (the person who answered), accept or reject (the
 * document's owner). Accepting saves like any edit, so a conflict or duplicate comes back as a 409.
 */
export const POST = handle(async (req, ctx: RouteContext<"/api/edits/[id]">) => {
  const viewer = await requireViewer(req);
  const body = await readBody(
    req,
    z.object({
      action: z.enum(["propose", "dismiss", "accept", "reject"]),
      text: z.string().max(5000).optional(),
      reason: z.string().max(1000).optional(),
      override,
      acknowledgeSimilar: z.boolean().optional(),
    }),
  );
  const { status, body: out } = await decideEdit(viewer, Number((await ctx.params).id), body);
  return Response.json(out, { status });
});

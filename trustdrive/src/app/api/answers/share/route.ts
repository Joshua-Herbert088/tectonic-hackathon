import { z } from "zod";
import { decideSharing } from "@/lib/answers";
import { requireViewer } from "@/lib/auth";
import { handle, readBody } from "@/lib/http";

/**
 * The person who answered decides about their answers waiting to be shared: share them or keep them to
 * themselves. `always` applies it to everything waiting and from now on.
 */
export const POST = handle(async (req) => {
  const viewer = await requireViewer(req);
  const { ids, share, always } = await readBody(req, z.object({ ids: z.array(z.number().int()).max(200).default([]), share: z.boolean(), always: z.boolean().default(false) }));
  return Response.json(await decideSharing(viewer, ids, share, always));
});

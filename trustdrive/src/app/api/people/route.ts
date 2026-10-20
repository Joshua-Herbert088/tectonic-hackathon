import { requireViewer } from "@/lib/auth";
import { handle } from "@/lib/http";
import { whoKnowsFor } from "@/lib/service";

/** "Who knows X?" (`?q=`): colleagues ranked by evidence from their work, each with the evidence. */
export const GET = handle(async (req) => {
  const viewer = await requireViewer(req);
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 200);
  return Response.json(await whoKnowsFor(q, viewer));
});

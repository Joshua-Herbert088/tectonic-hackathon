import { requireViewer } from "@/lib/auth";
import { editsFor, editsForDoc } from "@/lib/edits";
import { handle } from "@/lib/http";

/** Changes answers suggest: the viewer's to propose and to review, or (`?doc=`) the ones waiting on a document. */
export const GET = handle(async (req) => {
  const viewer = await requireViewer(req);
  const docId = new URL(req.url).searchParams.get("doc");
  return Response.json(docId ? { pending: await editsForDoc(docId) } : await editsFor(viewer));
});

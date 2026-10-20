import { captureAnswers } from "@/lib/answers";
import { requireViewer } from "@/lib/auth";
import { editsFor, editsForDoc } from "@/lib/edits";
import { handle } from "@/lib/http";

/** Changes answers suggest: the viewer's to propose and to review, or (`?doc=`) the ones waiting on a document. */
export const GET = handle(async (req) => {
  const viewer = await requireViewer(req);
  // Answers in new messages (or, after a reset, all of them) first, so their suggestions are there too.
  await captureAnswers();
  const docId = new URL(req.url).searchParams.get("doc");
  return Response.json(docId ? { pending: await editsForDoc(docId) } : await editsFor(viewer));
});

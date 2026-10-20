import { requireViewer } from "@/lib/auth";
import { handle } from "@/lib/http";
import { jevStatus } from "@/lib/trust";

/** Whether Jev is answering, so pages can explain that scores and checks are rule-based estimates. */
export const GET = handle(async (req) => {
  await requireViewer(req);
  return Response.json({ jev: jevStatus() });
});

import { requireViewer } from "@/lib/auth";
import { loadTrash } from "@/lib/db";
import { handle } from "@/lib/http";

/** The trash as the signed-in person sees it: documents they own or put there themselves. */
export const GET = handle(async (req) => {
  const viewer = await requireViewer(req);
  const docs = (await loadTrash()).filter((d) => d.ownerId === viewer.id || d.trashedById === viewer.id);
  return Response.json({ docs });
});

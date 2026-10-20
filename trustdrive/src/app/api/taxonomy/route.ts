import { requireViewer } from "@/lib/auth";
import { companyMap } from "@/lib/companyMap";
import { loadConversations, loadWorld } from "@/lib/db";
import { handle } from "@/lib/http";

/** Company structure, clients and the tag taxonomy, with document counts. */
export const GET = handle(async (req) => {
  await requireViewer(req);
  const [world, conversations] = await Promise.all([loadWorld(), loadConversations()]);
  return Response.json(companyMap(world, conversations));
});

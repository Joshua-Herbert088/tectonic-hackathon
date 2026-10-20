import { requireViewer } from "@/lib/auth";
import { loadWorld } from "@/lib/db";
import { handle } from "@/lib/http";

export const GET = handle(async (req) => {
  await requireViewer(req);
  const { teams, people, clients, terms } = await loadWorld();
  return Response.json({ teams, people, clients, terms });
});

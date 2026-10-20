import { requireViewer } from "@/lib/auth";
import { config } from "@/lib/config";
import { loadDirectory } from "@/lib/db";
import { handle } from "@/lib/http";

export const GET = handle(async (req) => {
  await requireViewer(req);
  // Only what it returns: no documents.
  const { teams, people, clients, terms } = await loadDirectory();
  return Response.json({ teams, people, clients, terms, canReset: config.allowDemoReset });
});

import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { loadWorld, setPersonClients } from "@/lib/db";
import { handle, readBody } from "@/lib/http";

/** Which clients the signed-in person sees. `null` goes back to their team's clients. */
export const PUT = handle(async (req) => {
  const viewer = await requireViewer(req);
  const { clientIds } = await readBody(req, z.object({ clientIds: z.array(z.string()).max(500).nullable() }));
  const world = await loadWorld();
  const known = clientIds && [...new Set(clientIds)].filter((id) => world.clients.some((c) => c.id === id));
  await setPersonClients(viewer.id, known);
  return Response.json({ clientIds: known });
});

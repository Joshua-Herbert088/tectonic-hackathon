import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { loadWorld } from "@/lib/db";
import { handle, readBody } from "@/lib/http";
import { suggestTags } from "@/lib/tagging";

/** Suggests country, team, client, document type and topics for a text. Nothing is saved. */
export const POST = handle(async (req) => {
  const viewer = await requireViewer(req);
  const { title, content, confidential } = await readBody(req, z.object({ title: z.string().max(300).default(""), content: z.string().max(200_000), confidential: z.boolean().default(false) }));
  // Confidential text is never sent to Jev: the keyword rules suggest instead.
  return Response.json(await suggestTags(await loadWorld(), { title, content, defaultTeamId: viewer.teamId }, { rulesOnly: confidential }));
});

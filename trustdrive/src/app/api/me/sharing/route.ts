import { z } from "zod";
import { setSharingPreference } from "@/lib/answers";
import { requireViewer } from "@/lib/auth";
import { handle, readBody } from "@/lib/http";

/** What happens to the answers the signed-in person gives in private chats: ask, always share, or never keep. */
export const PUT = handle(async (req) => {
  const viewer = await requireViewer(req);
  const { answerSharing } = await readBody(req, z.object({ answerSharing: z.enum(["ask", "always", "never"]) }));
  await setSharingPreference(viewer, answerSharing);
  return Response.json({ answerSharing });
});

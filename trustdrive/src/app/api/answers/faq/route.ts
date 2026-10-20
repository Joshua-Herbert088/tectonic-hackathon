import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { handle, HttpError, readBody } from "@/lib/http";
import { dismissFaqSuggestion, faqDraft } from "@/lib/service";

/** The viewer's answers on a topic (`?topic=`) that aren't written up yet, to review as an FAQ. */
export const GET = handle(async (req) => {
  const viewer = await requireViewer(req);
  const draft = await faqDraft(new URL(req.url).searchParams.get("topic") ?? "", viewer);
  if (!draft) throw new HttpError(404, "Unknown topic");
  return Response.json(draft);
});

/** "Not now": stop suggesting an FAQ for these answers (new answers can bring it back). */
export const DELETE = handle(async (req) => {
  const viewer = await requireViewer(req);
  const { topic } = await readBody(req, z.object({ topic: z.string().max(60) }));
  return Response.json(await dismissFaqSuggestion(topic, viewer));
});

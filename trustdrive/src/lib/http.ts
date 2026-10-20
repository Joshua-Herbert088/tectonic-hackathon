import { z } from "zod";
import { log } from "./log";

/** An error with an HTTP status and a message that's safe to show. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Wraps a route handler: known errors become their status with `{ error }`, invalid input becomes 400,
 * anything else is logged and becomes a 500 without internals.
 */
export function handle<Args extends unknown[]>(fn: (req: Request, ...args: Args) => Promise<Response>) {
  return async (req: Request, ...args: Args): Promise<Response> => {
    try {
      return await fn(req, ...args);
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      if (e instanceof z.ZodError) return Response.json({ error: "Invalid request", issues: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
      log.error("request failed", { method: req.method, url: new URL(req.url).pathname, error: (e as Error).message, stack: (e as Error).stack });
      return Response.json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}

/** Request bodies larger than this are refused before they're read in full. */
export const MAX_BODY_BYTES = 2_000_000;

/**
 * The JSON body, validated. Malformed JSON is a 400, not a crash; a body over `maxBytes` is a 413,
 * found while reading, so an oversized request is never buffered whole.
 */
export async function readBody<T extends z.ZodType>(req: Request, schema: T, maxBytes = MAX_BODY_BYTES): Promise<z.infer<T>> {
  const tooLarge = () => new HttpError(413, `The request is too large (over ${Math.round(maxBytes / 1_000_000)} MB).`);
  if (Number(req.headers.get("content-length")) > maxBytes) throw tooLarge();
  let text = "";
  if (req.body) {
    const reader = req.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw tooLarge();
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
  return schema.parse(raw);
}

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

/** The JSON body, validated. Malformed JSON is a 400, not a crash. */
export async function readBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
  return schema.parse(raw);
}

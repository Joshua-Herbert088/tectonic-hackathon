import { cookies } from "next/headers";
import { findPerson } from "./db";
import type { Person } from "./types";

/**
 * Who is asking. There's no sign-in: the "Viewing as" switcher stores a person in a cookie, so a demo
 * can show how trust differs per person.
 */

export const VIEWER_COOKIE = "td_viewer";
export const DEFAULT_VIEWER = "jonas";

/** The person making the request: the one chosen in the switcher, or the default viewer. */
export async function requireViewer(_req: Request): Promise<Person> {
  const switched = (await cookies()).get(VIEWER_COOKIE)?.value;
  return (switched && (await findPerson({ id: switched }))) || (await findPerson({ id: DEFAULT_VIEWER }))!;
}

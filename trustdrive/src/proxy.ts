import { NextResponse, type NextRequest } from "next/server";
import { config as server } from "@/lib/config";
import { DEMO_USER, readSession, SESSION_COOKIE } from "@/lib/session";

/**
 * Deny by default: without a valid signed session, pages go to the sign-in page and APIs answer 401.
 * Routes check the session again themselves (requireViewer); this keeps anything new or forgotten closed.
 */

const PUBLIC = new Set(["/login", "/api/login", "/api/health"]);

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.has(pathname)) return NextResponse.next();
  const session = server.secret ? readSession(server.secret, req.cookies.get(SESSION_COOKIE)?.value) : null;
  // A demo session only counts while demo mode is on.
  if (session && (session.userId !== DEMO_USER || server.demoMode)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in to TrustDrive first." }, { status: 401 });
  const login = new URL("/login", req.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything but build output and the files in public/.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.svg$).*)"],
};

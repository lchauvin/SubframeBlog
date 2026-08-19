import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "astroblog_session";

/**
 * Cookie-presence check and redirect ONLY.
 *
 * Middleware runs on the edge runtime and cannot open SQLite, so it cannot
 * validate a session. Every admin page, server action and route handler calls
 * `requireAdmin()` from src/server/auth/session.ts — that is the real gate.
 * This exists purely so a logged-out visitor lands on the login form instead of
 * a flash of admin chrome.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/admin/login") return NextResponse.next();

  if (!request.cookies.get(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = pathname === "/admin" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*"] };

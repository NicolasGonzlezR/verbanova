import { NextResponse, type NextRequest } from "next/server";

import { AUTH_TOKEN_COOKIE } from "@/lib/session";

const PUBLIC_PATHS = ["/login", "/register"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(AUTH_TOKEN_COOKIE)?.value;
  const isPublicPath = PUBLIC_PATHS.includes(pathname);
  const isTranslatePath = pathname.startsWith("/translate");
  const isSubtitlePath = pathname.startsWith("/subtitle");
  const isRootPath = pathname === "/";

  if (!token && (isTranslatePath || isSubtitlePath || (!isPublicPath && !isRootPath))) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (!token && isRootPath) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (token && (isPublicPath || isRootPath)) {
    const translateUrl = new URL("/translate", request.url);
    return NextResponse.redirect(translateUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};

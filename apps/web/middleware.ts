import { NextRequest, NextResponse } from "next/server";

// Which tabs a user may open is ticked per user in the database (Users → Tabs), which this edge
// code can't read: components/layout/TabGuard.tsx shows the "no access" message and the API refuses the data.

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes — no auth needed
  if (pathname === "/" || pathname === "/login" || pathname.startsWith("/images/")) {
    return NextResponse.next();
  }

  // CRM screens don't exist until NEXT_PUBLIC_CRM_ENABLED=true (inlined at build time)
  if (pathname.startsWith("/dashboard/crm") && process.env.NEXT_PUBLIC_CRM_ENABLED !== "true") {
    return NextResponse.redirect(new URL("/dashboard/recordings", request.url));
  }

  const token = request.cookies.get("token")?.value;

  // No token — redirect to login
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // A token that isn't even a JWT: sign in again (the API checks the signature on every request)
  try {
    JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api).*)",
  ],
};

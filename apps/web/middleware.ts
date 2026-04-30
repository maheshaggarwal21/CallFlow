import { NextRequest, NextResponse } from "next/server";

const OWNER_ONLY_PATHS = [
  "/dashboard/overview",
  "/dashboard/employees",
  "/dashboard/lines",
  "/dashboard/intercoms",
  "/dashboard/team",
  "/dashboard/students",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow login page through always
  if (pathname === "/login") return NextResponse.next();

  const token = request.cookies.get("token")?.value;

  // No token — redirect to login
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Decode JWT payload — atob() works in Edge Runtime, Buffer does not
  let role: string | null = null;
  let userId: string | null = null;
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64));
    role = payload.role ?? null;
    userId = payload.sub ?? null;
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Employee trying to access owner-only path
  if (role === "employee") {
    const segments = pathname.split("/").filter(Boolean); // ["dashboard", "employees", "id"]
    const isEmpDetail = segments[0] === "dashboard" && segments[1] === "employees" && segments[2];
    const empIdInPath = isEmpDetail ? segments[2] : null;

    if (pathname === "/dashboard/employees") {
      return NextResponse.redirect(new URL(`/dashboard/employees/${userId}`, request.url));
    }

    if (isEmpDetail && empIdInPath && empIdInPath !== userId) {
      return NextResponse.redirect(new URL(`/dashboard/employees/${userId}`, request.url));
    }

    if (OWNER_ONLY_PATHS.some((p) => p !== "/dashboard/employees" && pathname.startsWith(p))) {
      return NextResponse.redirect(new URL(`/dashboard/employees/${userId}`, request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api).*)",
  ],
};

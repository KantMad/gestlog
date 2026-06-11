import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession } from "@/lib/session";

const PUBLIC_PATHS = ["/login", "/api/auth/", "/api/sync/"];

// Chemins réservés aux ADMIN (pages + API). Vérifié dès l'Edge via le rôle
// porté par le jeton signé (défense en profondeur ; les handlers re-vérifient).
function isAdminPath(pathname: string): boolean {
  return (
    pathname === "/users" ||
    pathname.startsWith("/users/") ||
    pathname === "/api/users" ||
    pathname.startsWith("/api/users/")
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Le jeton DOIT être authentique (signé par nous) et non expiré → forgery fermée.
  const token = request.cookies.get("gestlog_session")?.value;
  const session = await verifySession(token);

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (isAdminPath(pathname) && session.role !== "ADMIN") {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

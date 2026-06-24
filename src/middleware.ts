import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession } from "@/lib/session";
import { screenForPath, canAccessScreen, APP_SCREENS } from "@/lib/screens";

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

  // Autorisation par écran (pages + API screen-spécifiques). screenAccess est
  // porté par le jeton signé. Les routes transverses renvoient screen=null.
  const screen = screenForPath(pathname);
  if (screen && !canAccessScreen(session.role, session.scr, screen)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }
    // Rediriger vers le 1er écran AUTORISÉ de l'utilisateur (et NON systématiquement
    // /dashboard : un utilisateur sans accès au dashboard bouclerait à l'infini —
    // ERR_TOO_MANY_REDIRECTS). Repli sur /account (toujours accessible).
    const firstAllowed = APP_SCREENS.find((s) =>
      canAccessScreen(session.role, session.scr, s.key)
    );
    const target = firstAllowed?.key ?? "/account";
    if (target !== pathname) {
      return NextResponse.redirect(new URL(target, request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

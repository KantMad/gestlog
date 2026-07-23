// Canonical list of app screens that can be granted per-user.
// Keys match the route href. The "/users" screen is admin-only and is NOT
// part of this list (admins always see it, non-admins never do).
export const APP_SCREENS: { key: string; label: string }[] = [
  { key: "/dashboard", label: "Tableau de bord" },
  { key: "/import", label: "Import" },
  { key: "/product-info", label: "Infos produits" },
  { key: "/comparison", label: "Comparaison" },
  { key: "/reassort", label: "Commandes client" },
  { key: "/allocation", label: "Répartition" },
  { key: "/samples", label: "Échantillons" },
  { key: "/deliveries", label: "Préparation" },
  { key: "/depot", label: "Vue dépôt" },
  { key: "/shipments", label: "Livraisons" },
  { key: "/recap", label: "Récap clients" },
  { key: "/configuration", label: "Configuration" },
  { key: "/statistics", label: "Statistiques" },
  { key: "/season-comparison", label: "Comparaison saisons / catalogues" },
  { key: "/client-comparison", label: "Comparaison clients" },
  { key: "/repartition", label: "Répartition magasin" },
  { key: "/integration-cc", label: "Fichier d'intégration CC" },
  { key: "/controle-commandes", label: "Contrôle commandes" },
  { key: "/export", label: "Exports" },
  { key: "/btoc", label: "BtoC" },
];

export const APP_SCREEN_KEYS = APP_SCREENS.map((s) => s.key);

// Parse the stored screenAccess value (JSON string) into a list of keys.
// Returns null when the user has access to ALL screens (no restriction).
export function parseScreenAccess(raw: unknown): string[] | null {
  if (raw == null || raw === "") return null;
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

// Correspondance préfixe de route API → écran requis. Les préfixes ABSENTS de
// cette table sont des endpoints TRANSVERSES (référentiel : saisons, clients,
// catalogues, fournisseurs…) accessibles à tout utilisateur authentifié.
// Une API peut servir PLUSIEURS écrans → liste : l'accès est accordé dès que
// l'utilisateur a l'UN d'eux. ⚠️ Une API consommée par un écran A mais rattachée au
// seul écran B casse A pour qui n'a pas B — cas réel : le Dashboard se nourrit de
// `/api/statistics/{season,charts}` ; une utilisatrice ayant « Tableau de bord » sans
// « Statistiques » recevait 403 sur ses propres données et la page plantait.
const API_SCREEN_MAP: [string, string[]][] = [
  ["/api/allocation", ["/allocation"]],
  // Les échantillons retirent du disponible à la répartition → accessibles aussi à qui
  // gère la répartition, sans devoir cocher deux écrans.
  ["/api/samples", ["/samples", "/allocation"]],
  ["/api/btoc", ["/btoc"]],
  ["/api/controle-commandes", ["/controle-commandes"]],
  ["/api/comparison", ["/comparison"]],
  ["/api/deliveries", ["/deliveries"]],
  ["/api/depot", ["/depot"]],
  ["/api/export", ["/export"]],
  ["/api/import", ["/import"]],
  ["/api/product-info", ["/product-info"]],
  ["/api/reassort", ["/reassort"]],
  ["/api/recap", ["/recap"]],
  ["/api/repartition", ["/repartition"]],
  ["/api/shipments", ["/shipments"]],
  // plus spécifiques AVANT /api/statistics (premier préfixe gagnant)
  ["/api/statistics/season-comparison", ["/season-comparison"]],
  ["/api/statistics/client-comparison", ["/client-comparison"]],
  // Alimente l'écran Statistiques ET le Dashboard.
  ["/api/statistics", ["/statistics", "/dashboard"]],
];

// Écrans acceptés pour un chemin (page OU API) : l'un d'eux suffit. null = chemin non
// rattaché à un écran restreignable (→ pas d'enforcement par écran).
// /users et /api/users ne sont PAS ici : ils sont gardés en ADMIN séparément.
export function screensForPath(pathname: string): string[] | null {
  if (pathname.startsWith("/api/")) {
    for (const [prefix, screens] of API_SCREEN_MAP) {
      if (pathname === prefix || pathname.startsWith(prefix + "/")) return screens;
    }
    return null;
  }
  for (const key of APP_SCREEN_KEYS) {
    if (pathname === key || pathname.startsWith(key + "/")) return [key];
  }
  return null;
}

// Premier écran accepté (compat / affichage). Préférer `screensForPath` pour décider
// d'un accès : une API peut être servie par plusieurs écrans.
export function screenForPath(pathname: string): string | null {
  return screensForPath(pathname)?.[0] ?? null;
}

// Whether a user (role + screenAccess) may access a given pathname.
export function canAccessScreen(
  role: string | undefined,
  screenAccess: string[] | null | undefined,
  pathname: string
): boolean {
  // The users screen is reserved for admins.
  const isUsersScreen =
    pathname === "/users" || pathname.startsWith("/users/");
  if (role === "ADMIN") return true;
  if (isUsersScreen) return false;
  // Le compte personnel (/account) et le centre d'aide (/aide) sont accessibles à TOUT
  // utilisateur connecté, quelles que soient ses permissions d'écran.
  if (pathname === "/account" || pathname.startsWith("/account/")) return true;
  if (pathname === "/aide" || pathname.startsWith("/aide/")) return true;
  // null/undefined access = all screens allowed
  if (!screenAccess) return true;
  return screenAccess.some(
    (key) => pathname === key || pathname.startsWith(key + "/")
  );
}

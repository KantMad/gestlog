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
  { key: "/deliveries", label: "Préparation" },
  { key: "/depot", label: "Vue dépôt" },
  { key: "/shipments", label: "Livraisons" },
  { key: "/recap", label: "Récap clients" },
  { key: "/configuration", label: "Configuration" },
  { key: "/statistics", label: "Statistiques" },
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
  // null/undefined access = all screens allowed
  if (!screenAccess) return true;
  return screenAccess.some(
    (key) => pathname === key || pathname.startsWith(key + "/")
  );
}

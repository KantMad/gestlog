import {
  LayoutDashboard, Upload, GitCompareArrows, Calculator, Truck, Settings, BarChart3,
  Users, Tag, ClipboardList, Warehouse, Receipt, RefreshCw, ShoppingBag, Store,
  ArrowLeftRight, Building2, UserCog, Download, LifeBuoy, ScanSearch, PackageCheck,
  FlaskConical, FileSpreadsheet, Rocket, Tags, Handshake, Boxes, ClipboardCheck,
  Send, SlidersHorizontal, type LucideIcon,
} from "lucide-react";
import { canAccessScreen } from "./screens";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Réservé aux administrateurs (hors système d'écrans par utilisateur). */
  adminOnly?: boolean;
}

export interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

export type NavEntry = NavItem | NavGroup;

export const isGroup = (e: NavEntry): e is NavGroup => "items" in e;

// ─────────────────────────────────────────────────────────────────────────────
// Arborescence du menu.
//
// Regroupée par ÉTAPE DU FLUX métier (la marchandise entre, on la commande, on la
// répartit, on l'expédie, on l'analyse) plutôt que par ordre d'apparition historique :
// 26 entrées à plat devenaient illisibles.
//
// ⚠️ Deux entrées restent au PREMIER NIVEAU, sans groupe : le Tableau de bord (point
// d'entrée) et le **BtoC** (consulté en permanence, il ne doit jamais coûter un clic
// de plus).
//
// ⚠️ Les `href` des écrans restreignables doivent correspondre EXACTEMENT aux clés de
// `APP_SCREENS` : ce sont elles qui sont stockées en base dans `User.screenAccess`.
// Renommer une clé révoquerait silencieusement l'accès des utilisateurs concernés.
// `navigation.test.ts` verrouille cette correspondance.
// ─────────────────────────────────────────────────────────────────────────────
export const NAV_TREE: NavEntry[] = [
  { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },

  {
    id: "marchandise",
    label: "Marchandise",
    icon: Boxes,
    items: [
      { href: "/import", label: "Import", icon: Upload },
      { href: "/import/receptions", label: "Correction réception", icon: PackageCheck },
      { href: "/comparison", label: "Comparaison", icon: GitCompareArrows },
      { href: "/samples", label: "Échantillons", icon: FlaskConical },
      { href: "/product-info", label: "Infos produits", icon: Tag },
    ],
  },
  {
    id: "commandes",
    label: "Commandes",
    icon: ClipboardCheck,
    items: [
      { href: "/reassort", label: "Commandes client", icon: ClipboardList },
      { href: "/lancement-commande", label: "Lancement de commande", icon: Rocket },
      { href: "/controle-commandes", label: "Contrôle commandes", icon: ScanSearch },
      { href: "/conditionnelle", label: "Vente en conditionnelle", icon: Handshake },
    ],
  },
  {
    id: "repartition",
    label: "Répartition & expédition",
    icon: Send,
    items: [
      { href: "/allocation", label: "Répartition", icon: Calculator },
      { href: "/repartition", label: "Répartition magasin", icon: Store },
      { href: "/deliveries", label: "Préparation", icon: RefreshCw },
      { href: "/shipments", label: "Livraisons", icon: Truck },
      { href: "/depot", label: "Vue dépôt", icon: Warehouse },
      { href: "/recap", label: "Récap clients", icon: Receipt },
      { href: "/a-vendre", label: "À vendre", icon: Tags },
    ],
  },
  {
    id: "analyse",
    label: "Analyse",
    icon: BarChart3,
    items: [
      { href: "/statistics", label: "Statistiques", icon: BarChart3 },
      { href: "/season-comparison", label: "Comparaison saisons / catalogues", icon: ArrowLeftRight },
      { href: "/client-comparison", label: "Comparaison clients", icon: Building2 },
    ],
  },
  {
    id: "fichiers",
    label: "Fichiers & exports",
    icon: FileSpreadsheet,
    items: [
      { href: "/integration-cc", label: "Fichier d'intégration CC", icon: FileSpreadsheet },
      { href: "/export", label: "Exports", icon: Download },
    ],
  },

  { href: "/btoc", label: "BtoC", icon: ShoppingBag },

  {
    id: "reglages",
    label: "Réglages",
    icon: SlidersHorizontal,
    items: [
      { href: "/configuration", label: "Configuration", icon: Settings },
      { href: "/users", label: "Utilisateurs", icon: Users, adminOnly: true },
    ],
  },
];

/** Entrées du bas de menu, toujours accessibles à tout utilisateur connecté. */
export const NAV_FOOTER: NavItem[] = [
  { href: "/aide", label: "Centre d'aide", icon: LifeBuoy },
  { href: "/account", label: "Mon compte", icon: UserCog },
];

/**
 * Arborescence filtrée selon les droits.
 *
 * ⚠️ Deux garanties, sans lesquelles un regroupement ferait DISPARAÎTRE des écrans
 * auxquels l'utilisateur a droit :
 *  1. un groupe dont plus aucun élément n'est visible n'est pas rendu ;
 *  2. un groupe réduit à UN SEUL élément visible est **aplati** — l'utilisateur y accède
 *     directement, sans replier/déplier un groupe qui ne contient qu'une ligne.
 */
export function visibleNav(
  role: string | undefined,
  screenAccess: string[] | null | undefined
): NavEntry[] {
  const allowed = (i: NavItem) =>
    i.adminOnly ? role === "ADMIN" : canAccessScreen(role, screenAccess, i.href);

  const out: NavEntry[] = [];
  for (const entry of NAV_TREE) {
    if (!isGroup(entry)) {
      if (allowed(entry)) out.push(entry);
      continue;
    }
    const items = entry.items.filter(allowed);
    if (items.length === 0) continue;
    if (items.length === 1) out.push(items[0]);
    else out.push({ ...entry, items });
  }
  return out;
}

/** Href le PLUS SPÉCIFIQUE qui préfixe le chemin courant (sinon « Import » et
 *  « Correction réception » s'allumeraient tous deux sur /import/receptions). */
export function activeHref(entries: NavEntry[], pathname: string): string {
  const all = entries.flatMap((e) => (isGroup(e) ? e.items : [e]));
  return all
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
    .reduce((best, i) => (i.href.length > best.length ? i.href : best), "");
}

/**
 * Emplacement d'un écran dans le menu, pour l'afficher ailleurs dans l'outil
 * (« Menu : Répartition & expédition › À vendre »).
 *
 * Le centre d'aide s'en sert pour indiquer OÙ trouver chaque écran. Il lit
 * `NAV_TREE`, jamais une chaîne recopiée : déplacer une entrée d'un groupe à l'autre
 * met l'aide à jour toute seule, sans risque de laisser une indication fausse.
 */
export function menuPath(href: string): { group: string | null; label: string } | null {
  for (const entry of NAV_TREE) {
    if (!isGroup(entry)) {
      if (entry.href === href) return { group: null, label: entry.label };
      continue;
    }
    const item = entry.items.find((i) => i.href === href);
    if (item) return { group: entry.label, label: item.label };
  }
  const footer = NAV_FOOTER.find((i) => i.href === href);
  return footer ? { group: null, label: footer.label } : null;
}

/** Identifiant du groupe contenant le chemin courant (pour l'ouvrir automatiquement). */
export function activeGroupId(entries: NavEntry[], pathname: string): string | null {
  const href = activeHref(entries, pathname);
  if (!href) return null;
  for (const e of entries) {
    if (isGroup(e) && e.items.some((i) => i.href === href)) return e.id;
  }
  return null;
}

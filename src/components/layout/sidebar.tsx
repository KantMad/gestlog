"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Upload,
  GitCompareArrows,
  Calculator,
  Truck,
  Settings,
  BarChart3,
  Package,
  Users,
  LogOut,
  Shield,
  User,
  Tag,
  ClipboardList,
  Warehouse,
  Receipt,
  RefreshCw,
  ShoppingBag,
  Store,
  ArrowLeftRight,
  Building2,
  UserCog,
  Download,
  LifeBuoy,
  ScanSearch,
  PackageCheck,
  FlaskConical,
  FileSpreadsheet,
  Rocket,
  Tags,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { canAccessScreen } from "@/lib/screens";
import { useMobileNav } from "@/lib/mobile-nav";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/import/receptions", label: "Correction réception", icon: PackageCheck },
  { href: "/product-info", label: "Infos produits", icon: Tag },
  { href: "/comparison", label: "Comparaison", icon: GitCompareArrows },
  { href: "/reassort", label: "Commandes client", icon: ClipboardList },
  { href: "/allocation", label: "Répartition", icon: Calculator },
  { href: "/samples", label: "Échantillons", icon: FlaskConical },
  { href: "/deliveries", label: "Préparation", icon: RefreshCw },
  { href: "/depot", label: "Vue dépôt", icon: Warehouse },
  { href: "/shipments", label: "Livraisons", icon: Truck },
  { href: "/recap", label: "Récap clients", icon: Receipt },
  { href: "/configuration", label: "Configuration", icon: Settings },
  { href: "/statistics", label: "Statistiques", icon: BarChart3 },
  { href: "/season-comparison", label: "Comparaison saisons / catalogues", icon: ArrowLeftRight },
  { href: "/client-comparison", label: "Comparaison clients", icon: Building2 },
  { href: "/repartition", label: "Répartition magasin", icon: Store },
  { href: "/integration-cc", label: "Fichier d'intégration CC", icon: FileSpreadsheet },
  { href: "/lancement-commande", label: "Lancement de commande", icon: Rocket },
  { href: "/a-vendre", label: "À vendre", icon: Tags },
  { href: "/controle-commandes", label: "Contrôle commandes", icon: ScanSearch },
  { href: "/export", label: "Exports", icon: Download },
  { href: "/btoc", label: "BtoC", icon: ShoppingBag },
  { href: "/aide", label: "Centre d'aide", icon: LifeBuoy },
  { href: "/account", label: "Mon compte", icon: UserCog },
];

const ADMIN_NAV_ITEMS = [
  { href: "/users", label: "Utilisateurs", icon: Users },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { open, setOpen } = useMobileNav();

  const allItems = [
    ...NAV_ITEMS.filter((item) =>
      canAccessScreen(user?.role, user?.screenAccess, item.href)
    ),
    ...(user?.role === "ADMIN" ? ADMIN_NAV_ITEMS : []),
  ];

  return (
    <>
      {/* Overlay (mobile) : ferme le tiroir au clic en dehors */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/40 transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-card",
          "transform transition-transform duration-200 ease-in-out lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
      <div className="flex h-16 items-center gap-3 border-b border-border px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
          <Package className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-base font-semibold tracking-tight">GestLog</h1>
          <p className="text-xs text-muted-foreground">Gestion logistique</p>
        </div>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto space-y-1 px-3 py-4">
        {/* Item actif = le href le PLUS SPÉCIFIQUE qui préfixe le chemin courant (sinon
            « Import » et « Correction réception » s'allumeraient tous deux sur
            /import/receptions). */}
        {(() => {
          const activeHref = allItems
            .filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
            .reduce((best, i) => (i.href.length > best.length ? i.href : best), "");
          return allItems.map((item) => {
          const isActive = item.href === activeHref;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <item.icon
                className={cn(
                  "h-[18px] w-[18px] shrink-0",
                  isActive ? "text-primary" : ""
                )}
              />
              {item.label}
            </Link>
          );
        });
        })()}
      </nav>

      <div className="border-t border-border p-4 space-y-3">
        {user && (
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100">
              {user.role === "ADMIN" ? (
                <Shield className="h-4 w-4 text-zinc-600" />
              ) : (
                <User className="h-4 w-4 text-zinc-600" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user.name}</p>
              <p className="text-xs text-muted-foreground">
                {user.role === "ADMIN" ? "Administrateur" : "Utilisateur"}
              </p>
            </div>
            <button
              onClick={() => logout()}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Se déconnecter"
              aria-label="Se déconnecter"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      </aside>
    </>
  );
}

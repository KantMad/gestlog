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
  ShoppingBag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { canAccessScreen } from "@/lib/screens";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/product-info", label: "Infos produits", icon: Tag },
  { href: "/comparison", label: "Comparaison", icon: GitCompareArrows },
  { href: "/allocation", label: "Répartition", icon: Calculator },
  { href: "/deliveries", label: "Livraisons", icon: Truck },
  { href: "/recap", label: "Récap clients", icon: ClipboardList },
  { href: "/depot", label: "Vue dépôt", icon: Warehouse },
  { href: "/configuration", label: "Configuration", icon: Settings },
  { href: "/statistics", label: "Statistiques", icon: BarChart3 },
  { href: "/btoc", label: "BtoC", icon: ShoppingBag },
];

const ADMIN_NAV_ITEMS = [
  { href: "/users", label: "Utilisateurs", icon: Users },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  const allItems = [
    ...NAV_ITEMS.filter((item) =>
      canAccessScreen(user?.role, user?.screenAccess, item.href)
    ),
    ...(user?.role === "ADMIN" ? ADMIN_NAV_ITEMS : []),
  ];

  return (
    <aside className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-card">
      <div className="flex h-16 items-center gap-3 border-b border-border px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
          <Package className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-base font-semibold tracking-tight">GestLog</h1>
          <p className="text-xs text-muted-foreground">Gestion logistique</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {allItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
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
        })}
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
              onClick={logout}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Se déconnecter"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

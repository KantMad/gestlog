"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, LogOut, Package, Shield, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { useMobileNav } from "@/lib/mobile-nav";
import {
  NAV_FOOTER, activeGroupId, activeHref, isGroup, visibleNav,
  type NavEntry, type NavItem,
} from "@/lib/navigation";

// Groupes ouverts, mémorisés d'une visite à l'autre : replier un groupe est une
// préférence, elle ne doit pas être perdue à chaque navigation.
const STORAGE_KEY = "gestlog.nav.open";

function readOpen(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function NavLink({
  item, active, onNavigate, nested = false,
}: { item: NavItem; active: boolean; onNavigate: () => void; nested?: boolean }) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors lg:min-h-9",
        nested && "pl-9",
        active
          ? "bg-primary/10 font-semibold text-primary"
          : "font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      <item.icon className={cn("h-[18px] w-[18px] shrink-0", nested && "h-4 w-4")} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { open, setOpen } = useMobileNav();

  const entries = useMemo(
    () => visibleNav(user?.role, user?.screenAccess),
    [user?.role, user?.screenAccess]
  );
  const current = activeHref(entries, pathname);
  const currentGroup = activeGroupId(entries, pathname);

  // `null` tant que le localStorage n'a pas été lu : évite un rendu serveur/client
  // divergent, et le repli visible d'un groupe au premier affichage.
  const [openGroups, setOpenGroups] = useState<string[] | null>(null);
  useEffect(() => setOpenGroups(readOpen() ?? []), []);

  // Le groupe de la page courante s'ouvre toujours : on ne doit jamais se retrouver sur
  // un écran dont l'entrée de menu est repliée.
  useEffect(() => {
    if (!currentGroup) return;
    setOpenGroups((prev) => (prev && !prev.includes(currentGroup) ? [...prev, currentGroup] : prev));
  }, [currentGroup]);

  const toggleGroup = (id: string) =>
    setOpenGroups((prev) => {
      const next = (prev ?? []).includes(id)
        ? (prev ?? []).filter((g) => g !== id)
        : [...(prev ?? []), id];
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* navigation en privé : on garde l'état en mémoire */
      }
      return next;
    });

  const isOpen = (id: string) => (openGroups ?? []).includes(id) || currentGroup === id;
  const close = () => setOpen(false);

  const renderEntry = (entry: NavEntry) => {
    if (!isGroup(entry)) {
      return (
        <NavLink key={entry.href} item={entry} active={entry.href === current} onNavigate={close} />
      );
    }
    const expanded = isOpen(entry.id);
    const hasCurrent = entry.items.some((i) => i.href === current);
    return (
      <div key={entry.id}>
        <button
          type="button"
          onClick={() => toggleGroup(entry.id)}
          aria-expanded={expanded}
          className={cn(
            "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors lg:min-h-9",
                hasCurrent && !expanded
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          <entry.icon className="h-[18px] w-[18px] shrink-0" />
          <span className="flex-1 truncate text-left">{entry.label}</span>
          {/* Une pastille signale l'écran courant quand le groupe est replié. */}
          {hasCurrent && !expanded && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
          <ChevronRight
            className={cn("h-4 w-4 shrink-0 transition-transform", expanded && "rotate-90")}
          />
        </button>
        {expanded && (
          <div className="mt-0.5 space-y-0.5 border-l border-border/70 pl-1.5 ml-4">
            {entry.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={item.href === current}
                onNavigate={close}
                nested
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Overlay (mobile) : ferme le tiroir au clic en dehors */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/40 transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={close}
        aria-hidden
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-card",
          "transform transition-transform duration-200 ease-in-out lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* h-14 : même hauteur que la Topbar, pour que les deux filets se rejoignent. */}
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <Package className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight">GestLog</h1>
            <p className="truncate text-xs text-muted-foreground">Gestion logistique</p>
          </div>
        </div>

        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
          {entries.map(renderEntry)}

          <div className="!mt-3 space-y-0.5 border-t border-border pt-3">
            {NAV_FOOTER.map((item) => (
              <NavLink key={item.href} item={item} active={item.href === current} onNavigate={close} />
            ))}
          </div>
        </nav>

        {user && (
          <div className="shrink-0 border-t border-border p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                {user.role === "ADMIN" ? (
                  <Shield className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <User className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="text-xs text-muted-foreground">
                  {user.role === "ADMIN" ? "Administrateur" : "Utilisateur"}
                </p>
              </div>
              <button
                onClick={() => logout()}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="Se déconnecter"
                aria-label="Se déconnecter"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

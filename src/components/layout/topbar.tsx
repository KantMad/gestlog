"use client";

import { Menu } from "lucide-react";
import { SeasonSelector } from "./season-selector";
import { CreateSeasonDialog } from "./create-season-dialog";
import { useMobileNav } from "@/lib/mobile-nav";

export function Topbar({ title }: { title?: string }) {
  const { setOpen } = useMobileNav();
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-2 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 lg:px-8">
      <div className="flex min-w-0 items-center gap-1">
        <button
          onClick={() => setOpen(true)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent lg:hidden"
          aria-label="Ouvrir le menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        {title ? (
          <h2 className="truncate text-sm font-medium text-muted-foreground">{title}</h2>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <CreateSeasonDialog />
        <SeasonSelector />
      </div>
    </header>
  );
}

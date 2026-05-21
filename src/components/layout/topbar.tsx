"use client";

import { SeasonSelector } from "./season-selector";
import { CreateSeasonDialog } from "./create-season-dialog";

export function Topbar({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-8">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="flex items-center gap-3">
        <CreateSeasonDialog />
        <SeasonSelector />
      </div>
    </header>
  );
}

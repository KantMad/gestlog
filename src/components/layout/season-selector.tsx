"use client";

import { useSeason, formatSeasonLabel } from "@/lib/season-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Calendar } from "lucide-react";

export function SeasonSelector() {
  const { seasons, activeSeasonId, setActiveSeasonId, loading } = useSeason();

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Calendar className="h-4 w-4 animate-pulse" />
        <span>Chargement...</span>
      </div>
    );
  }

  if (seasons.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Calendar className="h-4 w-4" />
        <span>Aucune saison</span>
      </div>
    );
  }

  const activeSeason = seasons.find((s) => s.id === activeSeasonId);

  return (
    <Select value={activeSeasonId} onValueChange={(v) => v && setActiveSeasonId(v)}>
      <SelectTrigger className="w-56">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="truncate text-sm">
            {activeSeason ? formatSeasonLabel(activeSeason) : "Saison..."}
          </span>
        </div>
      </SelectTrigger>
      <SelectContent>
        {seasons.map((season) => (
          <SelectItem key={season.id} value={season.id} label={formatSeasonLabel(season)}>
            {formatSeasonLabel(season)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

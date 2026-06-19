"use client";

import { useState } from "react";
import { useSeason } from "@/lib/season-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const SEASON_TYPES = [
  { value: "AH", label: "Automne-Hiver" },
  { value: "PE", label: "Printemps-Été" },
];

export function CreateSeasonDialog() {
  const { refreshSeasons } = useSeason();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [type, setType] = useState<string>("");

  const name = type && year ? `${type}${year.slice(-2)}` : "";

  async function handleCreate() {
    if (!type || !year) return;

    setLoading(true);
    try {
      const res = await fetch("/api/seasons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          year: parseInt(year),
          type,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || "Erreur lors de la création");
        return;
      }

      toast.success(`Saison ${name} créée`);
      refreshSeasons();
      setOpen(false);
      setType("");
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-2 sm:px-3 py-1.5 text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer" aria-label="Nouvelle saison">
        <Plus className="h-4 w-4" />
        <span className="hidden sm:inline">Nouvelle saison</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Créer une saison</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Type</Label>
            <div className="grid grid-cols-2 gap-2">
              {SEASON_TYPES.map((st) => (
                <button
                  key={st.value}
                  type="button"
                  onClick={() => setType(st.value)}
                  className={cn(
                    "rounded-lg border-2 px-4 py-3 text-sm font-medium transition-all cursor-pointer",
                    type === st.value
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:border-muted-foreground/30 text-muted-foreground"
                  )}
                >
                  <div className="font-semibold">{st.value}</div>
                  <div className="text-xs mt-0.5">{st.label}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Année</Label>
            <Input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              min={2020}
              max={2050}
            />
          </div>
          {name && (
            <div className="rounded-lg bg-muted p-3 text-center">
              <span className="text-sm text-muted-foreground">Nom : </span>
              <span className="font-semibold">{name}</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleCreate} disabled={!type || !year || loading}>
            {loading ? "Création..." : "Créer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

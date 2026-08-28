"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@/components/ui/select";
import { Handshake, Plus, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn, formatNumber } from "@/lib/utils";

interface DealRow {
  id: string; label: string; status: string;
  clientCode: string; clientName: string;
  movements: number; delivered: number; sold: number; returned: number; remaining: number;
}

export default function ConditionnellePage() {
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [clients, setClients] = useState<{ id: string; code: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newClient, setNewClient] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/conditional");
      const data = await res.json();
      setDeals(data.data || []);
    } catch {
      /* on laisse la liste vide, l'utilisateur peut recharger */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    fetch("/api/clients")
      .then((r) => r.json())
      .then((d) => setClients(d.data || []))
      .catch(() => {});
  }, [load]);

  const create = async () => {
    if (!newClient || !newLabel.trim()) {
      toast.error("Choisis un client et donne un libellé à l'opération");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/conditional", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: newClient, label: newLabel.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      toast.success("Opération créée");
      setNewLabel("");
      load();
    } catch (e) {
      toast.error("Création impossible", { description: String(e) });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <Topbar title="Vente en conditionnelle" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="Vente en conditionnelle"
          description="Dépôt-vente : on livre, le client déclare ses ventes, puis rend le reliquat"
        />

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-50">
                <Plus className="h-5 w-5 text-violet-600" />
              </div>
              <div>
                <CardTitle className="text-base">Nouvelle opération</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Un client + un libellé libre. Les trois imports (livraison, ventes, retour)
                  s&apos;y rattachent ensuite.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">Client</label>
                <Select value={newClient} onValueChange={(v: string | null) => v && setNewClient(v)}>
                  <SelectTrigger className="h-9 w-72">
                    <span className={cn("truncate text-sm", !newClient && "text-muted-foreground")}>
                      {clients.find((c) => c.id === newClient)?.name || "Choisir un client…"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({c.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">Libellé</label>
                <Input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="ex. Conditionnelle été 2026"
                  className="h-9 w-72"
                />
              </div>
              <Button onClick={create} disabled={creating} className="h-9 gap-2">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Créer
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Chargement…</p>
          ) : deals.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Handshake className="mb-4 h-12 w-12 text-muted-foreground/50" />
                <p className="text-center text-sm text-muted-foreground">
                  Aucune opération pour l&apos;instant.
                  <br />
                  Créez-en une pour commencer à suivre un dépôt-vente.
                </p>
              </CardContent>
            </Card>
          ) : (
            deals.map((d) => (
              <Link key={d.id} href={`/conditionnelle/${d.id}`}>
                <Card className="transition-colors hover:bg-muted/40">
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                    <div className="flex items-center gap-3">
                      <Badge
                        className={cn(
                          d.status === "CLOTUREE"
                            ? "bg-zinc-100 text-zinc-700 hover:bg-zinc-100"
                            : "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                        )}
                      >
                        {d.status === "CLOTUREE" ? "Clôturée" : "En cours"}
                      </Badge>
                      <div>
                        <p className="font-semibold">{d.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {d.clientName} ({d.clientCode}) · {d.movements} import(s)
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-5 text-sm">
                      <div className="text-right">
                        <span className="block text-xs text-muted-foreground">Livré</span>
                        <span className="font-medium">{formatNumber(d.delivered)}</span>
                      </div>
                      <div className="text-right">
                        <span className="block text-xs text-muted-foreground">Vendu</span>
                        <span className="font-medium text-emerald-600">{formatNumber(d.sold)}</span>
                      </div>
                      <div className="text-right">
                        <span className="block text-xs text-muted-foreground">Rendu</span>
                        <span className="font-medium">{formatNumber(d.returned)}</span>
                      </div>
                      <div className="text-right">
                        <span className="block text-xs text-muted-foreground">Reste</span>
                        <span
                          className={cn(
                            "font-semibold",
                            d.remaining < 0 ? "text-red-600" : d.remaining === 0 ? "text-emerald-600" : ""
                          )}
                        >
                          {formatNumber(d.remaining)}
                        </span>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

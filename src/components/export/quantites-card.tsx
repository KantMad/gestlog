"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, Loader2, Search, Table2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import * as XLSX from "xlsx";

interface Catalog {
  id: string;
  name: string;
  orderCount: number;
}
interface Boutique {
  id: string;
  code: string;
  name: string;
}
interface SheetResponse {
  sizes: string[];
  header: string[];
  rows: (string | number)[][];
  groupCount: number;
  grandTotal: number;
  meta: { source: string; lineCount: number; undatedOrders: number };
}

type ClientMode = "include" | "exclude";

export function QuantitesCard({
  seasonId,
  seasonName,
}: {
  seasonId: string;
  seasonName: string;
}) {
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [boutiques, setBoutiques] = useState<Boutique[]>([]);
  const [catalogId, setCatalogId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sku, setSku] = useState("");
  const [clientMode, setClientMode] = useState<ClientMode>("include");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [boutiqueSearch, setBoutiqueSearch] = useState("");
  const [withBoutique, setWithBoutique] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<SheetResponse["meta"] & { groupCount: number; grandTotal: number } | null>(null);
  const [counting, setCounting] = useState(false);

  useEffect(() => {
    if (!seasonId) return;
    setCatalogId("");
    fetch(`/api/catalogs?seasonId=${seasonId}`)
      .then((r) => r.json())
      .then((d) => setCatalogs(d.data || []))
      .catch(() => setCatalogs([]));
  }, [seasonId]);

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((d) => setBoutiques(d.data || []))
      .catch(() => setBoutiques([]));
  }, []);

  const query = useMemo(() => {
    const p = new URLSearchParams({ seasonId });
    if (catalogId) p.set("catalogId", catalogId);
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    if (sku.trim()) p.set("sku", sku.trim());
    if (selected.size > 0) {
      p.set("clients", [...selected].join(","));
      p.set("clientMode", clientMode);
    }
    if (withBoutique) p.set("withBoutique", "1");
    return p;
  }, [seasonId, catalogId, dateFrom, dateTo, sku, selected, clientMode, withBoutique]);

  // Décompte avant export : on voit ce qu'on va obtenir sans télécharger un fichier vide.
  useEffect(() => {
    if (!seasonId) return;
    let stale = false;
    const t = setTimeout(async () => {
      setCounting(true);
      try {
        const res = await fetch(`/api/export/quantites?${query}`);
        const d: SheetResponse = await res.json();
        if (stale || !res.ok) return;
        setPreview({ ...d.meta, groupCount: d.groupCount, grandTotal: d.grandTotal });
      } catch {
        /* on garde le décompte précédent */
      } finally {
        if (!stale) setCounting(false);
      }
    }, 500);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [query, seasonId]);

  const filteredBoutiques = boutiques.filter((b) => {
    const q = boutiqueSearch.trim().toLowerCase();
    return !q || b.name.toLowerCase().includes(q) || (b.code || "").toLowerCase().includes(q);
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const exportExcel = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/export/quantites?${query}`);
      const d: SheetResponse = await res.json();
      if (!res.ok) {
        toast.error("Export impossible");
        return;
      }
      if (d.groupCount === 0) {
        toast.warning("Aucune quantité ne correspond à ces critères");
        return;
      }
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([d.header, ...d.rows]);
      // Colonnes larges pour la référence et le libellé, étroites pour les tailles.
      ws["!cols"] = d.header.map((h, i) =>
        i === 0 ? { wch: 18 } : i === 1 ? { wch: 9 } : i === 2 ? { wch: 18 } :
        withBoutique && i === 3 ? { wch: 28 } : { wch: 7 }
      );
      ws["!freeze"] = { xSplit: withBoutique ? 4 : 3, ySplit: 1 };
      XLSX.utils.book_append_sheet(wb, ws, "Quantités");

      const boutiqueLabel =
        selected.size === 0
          ? "Toutes"
          : `${clientMode === "include" ? "Aucune sauf" : "Toutes sauf"} ${[...selected]
              .map((id) => boutiques.find((b) => b.id === id)?.name || id)
              .join(", ")}`;
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet([
          { Critère: "Saison", Valeur: seasonName },
          { Critère: "Catalogue", Valeur: catalogs.find((c) => c.id === catalogId)?.name || "Tous" },
          { Critère: "Période", Valeur: dateFrom || dateTo ? `${dateFrom || "début"} → ${dateTo || "fin"}` : "Toutes les dates" },
          { Critère: "SKU / référence", Valeur: sku.trim() || "Toutes" },
          { Critère: "Boutiques", Valeur: boutiqueLabel },
          { Critère: "Détail boutique", Valeur: withBoutique ? "Oui" : "Non" },
          { Critère: "Source des commandes", Valeur: d.meta.source },
          { Critère: "Type de commande", Valeur: "COMMANDE (hors VSS)" },
          { Critère: "Quantités", Valeur: "Commandées — soldés non déduits" },
          { Critère: "Références x coloris", Valeur: d.groupCount },
          { Critère: "Total pièces", Valeur: d.grandTotal },
        ]),
        "Critères"
      );
      const suffix = withBoutique ? "detail-boutique" : "global";
      XLSX.writeFile(wb, `quantites-commandees_${seasonName}_${suffix}.xlsx`);
      toast.success(`${d.groupCount} référence(s) x coloris — ${d.grandTotal} pièces`);
    } catch {
      toast.error("Export impossible");
    } finally {
      setBusy(false);
    }
  }, [query, seasonName, catalogId, catalogs, dateFrom, dateTo, sku, selected, clientMode, boutiques, withBoutique]);

  const datesActive = !!(dateFrom || dateTo);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Table2 className="h-4 w-4 text-indigo-600" />
          Quantités commandées — Excel
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Quantités commandées par les boutiques, <strong>tailles en colonnes</strong>, avec
          la somme par taille, par coloris et le total général. Coche le détail boutique pour
          voir qui a commandé quoi.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Catalogue</label>
            <select
              value={catalogId}
              onChange={(e) => setCatalogId(e.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus:border-primary"
            >
              <option value="">Tous les catalogues</option>
              {catalogs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.orderCount})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              SKU / référence <span className="font-normal">(séparés par des virgules)</span>
            </label>
            <Input
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="ex. QMVEST_L001, RMPULL"
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Du</label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Au</label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9" />
          </div>
        </div>

        {/* ── Boutiques ── */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs font-medium text-muted-foreground">Boutiques</label>
            <div className="inline-flex rounded-md border p-0.5">
              {(
                [
                  { key: "include", label: "Aucune sauf…" },
                  { key: "exclude", label: "Toutes sauf…" },
                ] as { key: ClientMode; label: string }[]
              ).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setClientMode(m.key)}
                  className={cn(
                    "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                    clientMode === m.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-md border">
            <div className="flex items-center gap-2 border-b p-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={boutiqueSearch}
                  onChange={(e) => setBoutiqueSearch(e.target.value)}
                  placeholder="Rechercher une boutique…"
                  className="w-full rounded border-0 bg-transparent pl-7 text-sm outline-none"
                />
              </div>
              {selected.size > 0 && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:underline"
                  onClick={() => setSelected(new Set())}
                >
                  Vider
                </button>
              )}
            </div>
            <div className="max-h-40 overflow-y-auto p-1">
              {filteredBoutiques.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">Aucun résultat.</p>
              ) : (
                filteredBoutiques.map((b) => (
                  <label
                    key={b.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(b.id)}
                      onChange={() => toggle(b.id)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {b.name}
                      <span className="ml-1 text-xs text-muted-foreground">{b.code}</span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {selected.size === 0
              ? "Aucune boutique cochée = toutes les boutiques."
              : clientMode === "include"
                ? `${selected.size} boutique(s) : elles seules seront dans l'export.`
                : `${selected.size} boutique(s) exclue(s) : toutes les autres seront dans l'export.`}
          </p>
        </div>

        {/* ── Détail boutique ── */}
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm hover:bg-muted/40">
          <input
            type="checkbox"
            checked={withBoutique}
            onChange={(e) => setWithBoutique(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="font-medium">Avec le détail boutique</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {withBoutique
                ? "Une ligne par boutique, regroupée par référence + coloris, avec un sous-total par groupe."
                : "Décoché : uniquement le global des quantités par taille et coloris."}
            </span>
          </span>
        </label>

        {/* ⚠️ Toutes les commandes n'ont pas de date : sans avertissement, un filtre de
            période renverrait un fichier vide sans qu'on comprenne pourquoi. */}
        {datesActive && (preview?.undatedOrders ?? 0) > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>{preview?.undatedOrders} commande(s) sans date</strong> dans cette saison :
              le filtre de période les écarte. Vide les dates pour les inclure.
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t pt-3">
          <span className="text-sm">
            {counting ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Calcul…
              </span>
            ) : (
              <>
                <strong>{preview?.groupCount ?? 0}</strong> référence(s) × coloris ·{" "}
                <strong>{preview?.grandTotal ?? 0}</strong> pièces
                {preview?.source && (
                  <span className="ml-1 text-muted-foreground">(source {preview.source})</span>
                )}
              </>
            )}
          </span>
          <Button
            onClick={exportExcel}
            disabled={busy || !seasonId || !preview?.groupCount}
            className="ml-auto h-9 gap-2"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Exporter
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

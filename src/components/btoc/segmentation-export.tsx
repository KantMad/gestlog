"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, Loader2, Filter, RotateCcw } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import {
  clientDisplayName, clientSheetRows,
  type SegmentedClient, type SegmentedSummary,
} from "@/lib/btoc-clients";
import * as XLSX from "xlsx";
import { fileStamp } from "@/lib/file-stamp";

const euro = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);


type SizeMode = "any" | "only" | "all";
type PromoMode = "all" | "discounted" | "only" | "never";

const SIZE_MODES: { key: SizeMode; label: string; hint: string }[] = [
  { key: "any", label: "Au moins une", hint: "A acheté au moins une des tailles cochées (il peut en avoir acheté d'autres)." },
  { key: "only", label: "Uniquement celles-ci", hint: "N'a JAMAIS acheté d'autre taille que celles cochées." },
  { key: "all", label: "Toutes celles-ci", hint: "A acheté chacune des tailles cochées (au moins une fois)." },
];
const PROMO_MODES: { key: PromoMode; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "discounted", label: "A profité d'une promo" },
  { key: "only", label: "N'achète QUE en promo" },
  { key: "never", label: "Jamais en promo" },
];

/** Groupe de boutons — plus lisible qu'un menu déroulant pour 3-4 choix exclusifs. */
function Segmented<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: { key: T; label: string; hint?: string }[] }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          title={o.hint}
          onClick={() => onChange(o.key)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            value === o.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SegmentationExport({
  availableSizes, dateFrom, dateTo,
}: { availableSizes: string[]; dateFrom: string; dateTo: string }) {
  const [minSpent, setMinSpent] = useState("");
  const [maxSpent, setMaxSpent] = useState("");
  const [minOrders, setMinOrders] = useState("");
  const [maxOrders, setMaxOrders] = useState("");
  const [sizes, setSizes] = useState<string[]>([]);
  const [sizeMode, setSizeMode] = useState<SizeMode>("any");
  const [promo, setPromo] = useState<PromoMode>("all");

  const [summary, setSummary] = useState<SegmentedSummary | null>(null);
  const [preview, setPreview] = useState<SegmentedClient[]>([]);
  const [counting, setCounting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const reqId = useRef(0);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    if (minSpent) p.set("minSpent", minSpent);
    if (maxSpent) p.set("maxSpent", maxSpent);
    if (minOrders) p.set("minOrders", minOrders);
    if (maxOrders) p.set("maxOrders", maxOrders);
    if (sizes.length) { p.set("sizes", sizes.join(",")); p.set("sizeMode", sizeMode); }
    if (promo !== "all") p.set("promo", promo);
    return p;
  }, [dateFrom, dateTo, minSpent, maxSpent, minOrders, maxOrders, sizes, sizeMode, promo]);

  // Aperçu recalculé à chaque changement de critère (décompte + 5 lignes seulement :
  // la liste complète n'est chargée qu'au clic sur Exporter).
  useEffect(() => {
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      setCounting(true);
      try {
        const res = await fetch(`/api/btoc/segmentation/clients?${query}&countOnly=1`);
        const d = await res.json();
        if (id !== reqId.current) return; // réponse périmée
        if (res.ok) { setSummary(d.summary); setPreview(d.clients); }
      } catch {
        /* on garde l'aperçu précédent */
      } finally {
        if (id === reqId.current) setCounting(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [query]);

  const reset = () => {
    setMinSpent(""); setMaxSpent(""); setMinOrders(""); setMaxOrders("");
    setSizes([]); setSizeMode("any"); setPromo("all");
  };
  const hasFilter =
    !!(minSpent || maxSpent || minOrders || maxOrders || sizes.length || promo !== "all");

  const exportExcel = useCallback(async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/btoc/segmentation/clients?${query}`);
      const d = await res.json();
      if (!res.ok) return;
      const rows = clientSheetRows(d.clients as SegmentedClient[]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Clients");
      // Onglet rappelant les critères : sans lui, un fichier exporté ne se relit pas.
      const crit: { Critère: string; Valeur: string }[] = [
        { Critère: "Période", Valeur: dateFrom || dateTo ? `${dateFrom || "début"} → ${dateTo || "aujourd'hui"}` : "Tout l'historique" },
        { Critère: "Total dépensé", Valeur: minSpent || maxSpent ? `${minSpent || "0"} € → ${maxSpent || "∞"} €` : "—" },
        { Critère: "Nb de commandes", Valeur: minOrders || maxOrders ? `${minOrders || "1"} → ${maxOrders || "∞"}` : "—" },
        { Critère: "Tailles", Valeur: sizes.length ? `${sizes.join(", ")} (${SIZE_MODES.find((m) => m.key === sizeMode)?.label})` : "—" },
        { Critère: "Promotions", Valeur: PROMO_MODES.find((m) => m.key === promo)?.label ?? "Tous" },
        { Critère: "Clients retenus", Valeur: String(rows.length) },
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(crit), "Critères");
      XLSX.writeFile(wb, `clients-segmentes-${fileStamp()}.xlsx`);
    } finally {
      setExporting(false);
    }
  }, [query, dateFrom, dateTo, minSpent, maxSpent, minOrders, maxOrders, sizes, sizeMode, promo]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50">
            <Filter className="h-4 w-4 text-violet-600" />
          </div>
          <div>
            <CardTitle className="text-base">Export ciblé</CardTitle>
            <p className="text-xs text-muted-foreground">
              Croise les critères et sors la fiche complète des clients qui correspondent.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted-foreground">Total dépensé — min (€)</label>
            <Input type="number" min={0} step="10" placeholder="ex. 500" value={minSpent}
              onChange={(e) => setMinSpent(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted-foreground">Total dépensé — max (€)</label>
            <Input type="number" min={0} step="10" placeholder="illimité" value={maxSpent}
              onChange={(e) => setMaxSpent(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted-foreground">Nb de commandes — min</label>
            <Input type="number" min={0} step="1" placeholder="ex. 2" value={minOrders}
              onChange={(e) => setMinOrders(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted-foreground">Nb de commandes — max</label>
            <Input type="number" min={0} step="1" placeholder="illimité" value={maxOrders}
              onChange={(e) => setMaxOrders(e.target.value)} className="h-9" />
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-muted-foreground">Promotions</label>
          <Segmented value={promo} onChange={setPromo} options={PROMO_MODES} />
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs font-medium text-muted-foreground">Tailles achetées</label>
            <Segmented value={sizeMode} onChange={setSizeMode} options={SIZE_MODES} />
            {sizes.length > 0 && (
              <button type="button" onClick={() => setSizes([])}
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
                tout décocher
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {availableSizes.map((s) => {
              const on = sizes.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSizes((prev) => (on ? prev.filter((x) => x !== s) : [...prev, s]))}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                    on ? "border-violet-500 bg-violet-500 text-white" : "hover:bg-accent"
                  )}
                >
                  {s}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {SIZE_MODES.find((m) => m.key === sizeMode)?.hint}
          </p>
        </div>

        {/* ── Résultat ── */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 p-3">
          {counting ? (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Calcul…
            </span>
          ) : (
            <span className="text-sm">
              <strong className="text-lg">{formatNumber(summary?.clients ?? 0)}</strong> client
              {(summary?.clients ?? 0) > 1 ? "s" : ""}
              <span className="text-muted-foreground">
                {" · "}{formatNumber(summary?.orders ?? 0)} commandes
                {" · "}{euro(summary?.revenue ?? 0)}
                {" · "}{formatNumber(summary?.pieces ?? 0)} pièces
              </span>
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {hasFilter && (
              <Button variant="ghost" size="sm" onClick={reset} className="gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" />
                Réinitialiser
              </Button>
            )}
            <Button onClick={exportExcel} disabled={exporting || !summary?.clients} className="h-9 gap-2">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Exporter ces clients
            </Button>
          </div>
        </div>

        {preview.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Aperçu — les {preview.length} plus gros acheteurs de la sélection
            </p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Client</th>
                    <th className="px-3 py-2 text-left font-medium">Ville</th>
                    <th className="px-3 py-2 text-right font-medium">Cmd</th>
                    <th className="px-3 py-2 text-right font-medium">Dépensé</th>
                    <th className="px-3 py-2 text-left font-medium">Tailles</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((c) => (
                    <tr key={c.email} className="border-t">
                      <td className="px-3 py-2">
                        <div className="font-medium">
                          {clientDisplayName(c)}
                        </div>
                        <div className="text-xs text-muted-foreground">{c.email}</div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {[c.billingCity, c.billingCountry].filter(Boolean).join(" ")}
                      </td>
                      <td className="px-3 py-2 text-right">{c.orders}</td>
                      <td className="px-3 py-2 text-right font-medium">{euro(c.spent)}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{c.sizes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          Le fichier contient les coordonnées de facturation et de livraison, le téléphone,
          les totaux, les dates de première et dernière commande et les tailles achetées —
          plus un onglet « Critères » qui rappelle le filtre utilisé. Les coordonnées sont
          celles de la <strong>dernière commande</strong> du client.
        </p>
      </CardContent>
    </Card>
  );
}

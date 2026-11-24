"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Download, Loader2, PackageX, Search, Star } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/utils";
import { fileStamp } from "@/lib/file-stamp";

interface Row {
  sku: string | null;
  model: string;
  productName: string;
  category: string;
  color: string;
  size: string;
  periods: number;
  outDays: number;
  ongoing: boolean;
  since: string | null;
  soldInWindow: number;
  dailyRate: number;
  missed: number;
  missedAmount: number;
  modelRank: number | null;
  bestSeller: boolean;
}

interface Data {
  from: string;
  to: string;
  windowFrom: string;
  windowDays: number;
  topModels: number;
  tracking: { first: string | null; last: string | null; days: number };
  rows: Row[];
}

const PAGE = 100;
const fr = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const euros = (n: number) => `${formatNumber(Math.round(n))} €`;

export function StockOuts() {
  const [data, setData] = useState<Data | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [onlyOngoing, setOnlyOngoing] = useState(false);
  const [onlyBest, setOnlyBest] = useState(false);
  const [category, setCategory] = useState("");
  const [shown, setShown] = useState(PAGE);

  const queryKey = (() => {
    const p = new URLSearchParams();
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    if (q) p.set("q", q);
    return p.toString();
  })();
  const loading = loadedKey !== queryKey;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/ruptures?${queryKey}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d: Data) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => console.error("Erreur chargement ruptures:", e))
      .finally(() => {
        if (!cancelled) setLoadedKey(queryKey);
      });
    return () => {
      cancelled = true;
    };
  }, [queryKey]);

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data?.rows ?? []) m.set(r.category, (m.get(r.category) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [data]);

  const rows = useMemo(
    () =>
      (data?.rows ?? []).filter(
        (r) => (!onlyOngoing || r.ongoing) && (!onlyBest || r.bestSeller) && (!category || r.category === category)
      ),
    [data, onlyOngoing, onlyBest, category]
  );

  const totals = useMemo(() => {
    let missed = 0;
    let amount = 0;
    let ongoing = 0;
    for (const r of rows) {
      missed += r.missed;
      amount += r.missedAmount;
      if (r.ongoing) ongoing++;
    }
    return { missed, amount, ongoing };
  }, [rows]);

  const handleExport = () => {
    if (!data) return;
    const sheet = XLSX.utils.json_to_sheet(
      rows.map((r) => ({
        Modèle: r.model,
        Produit: r.productName,
        Catégorie: r.category,
        Couleur: r.color,
        Taille: r.size,
        UGS: r.sku ?? "",
        "Rang meilleures ventes": r.modelRank ?? "",
        "Jours de rupture": r.outDays,
        "Nb de ruptures": r.periods,
        "En rupture depuis": r.ongoing ? fr(r.since) : "",
        [`Vendu sur ${data.windowDays} j`]: r.soldInWindow,
        "Pièces / jour en stock": r.dailyRate,
        "Pièces manquées (estim.)": r.missed,
        "€ manqués (estim.)": r.missedAmount,
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Ruptures");
    XLSX.writeFile(wb, `Ruptures site ${data.from} au ${data.to} ${fileStamp()}.xlsx`);
  };

  const tracking = data?.tracking;

  return (
    <div className="space-y-6">
      <Card className="overflow-visible">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">Du</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40 h-9" />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">au</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40 h-9" />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">Nom ou référence contient</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && setQ(search.trim())}
                  onBlur={() => search.trim() !== q && setQ(search.trim())}
                  placeholder="W001, 1/2 zip…"
                  className="w-56 h-9 pl-8"
                />
              </div>
            </div>
            <Button variant={onlyOngoing ? "default" : "outline"} size="sm" onClick={() => setOnlyOngoing((v) => !v)}>
              En rupture aujourd&apos;hui
            </Button>
            <Button variant={onlyBest ? "default" : "outline"} size="sm" onClick={() => setOnlyBest((v) => !v)}>
              <Star className="h-4 w-4 mr-1" />
              {data ? `${data.topModels} meilleures ventes` : "Meilleures ventes"}
            </Button>
            <Button onClick={handleExport} disabled={loading || !rows.length}>
              <Download className="h-4 w-4 mr-2" />
              Export Excel
            </Button>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          {categories.length > 1 && (
            <div className="flex flex-wrap gap-2 mt-3">
              <Button variant={!category ? "default" : "outline"} size="sm" onClick={() => setCategory("")}>
                Toutes
              </Button>
              {categories.map((c) => (
                <Button key={c} variant={category === c ? "default" : "outline"} size="sm" onClick={() => setCategory(c)}>
                  {c}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PackageX className="h-4 w-4" />
            Synthèse {data ? `du ${fr(data.from)} au ${fr(data.to)}` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <Tile label="Couleurs × tailles en rupture" value={formatNumber(rows.length)} />
            <Tile label="Dont en rupture aujourd'hui" value={formatNumber(totals.ongoing)} />
            <Tile label="Pièces manquées (estim.)" value={formatNumber(Math.round(totals.missed))} />
            <Tile label="Ventes manquées (estim.)" value={euros(totals.amount)} />
          </div>
          <p className="text-sm text-muted-foreground">
            {tracking?.first
              ? `Stock photographié chaque nuit depuis le ${fr(tracking.first)} (${formatNumber(tracking.days)} jours, dernière photo le ${fr(tracking.last)}). Les ruptures d'avant ne sont pas connues.`
              : "Aucune photo du stock pour l'instant : la première arrivera avec la prochaine synchro de nuit."}{" "}
            Ventes manquées = rythme de vente quand l&apos;article était en stock (sur {data?.windowDays ?? 365} jours) × jours de
            rupture. C&apos;est une estimation : un client a pu se reporter sur une autre taille ou couleur.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 overflow-x-auto">
          {!rows.length ? (
            <p className="text-sm text-muted-foreground">{loading ? "Chargement…" : "Aucune rupture sur cette période."}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Produit</th>
                  <th className="py-2 pr-3">Couleur</th>
                  <th className="py-2 pr-3">Taille</th>
                  <th className="py-2 pr-3 text-right">Jours</th>
                  <th className="py-2 pr-3">État</th>
                  <th className="py-2 pr-3 text-right">Vendu / jour</th>
                  <th className="py-2 pr-3 text-right">Pièces manquées</th>
                  <th className="py-2 text-right">€ manqués</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map((r, i) => (
                  <tr key={`${r.sku ?? r.productName}-${i}`} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{r.productName}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.model}
                        {r.bestSeller && r.modelRank ? (
                          <Badge variant="secondary" className="ml-2">
                            <Star className="h-3 w-3 mr-1" />
                            n°{r.modelRank} des ventes
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-2 pr-3">{r.color}</td>
                    <td className="py-2 pr-3 font-medium">{r.size}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(r.outDays)}</td>
                    <td className="py-2 pr-3">
                      {r.ongoing ? (
                        <span className="text-red-600 dark:text-red-400">depuis le {fr(r.since)}</span>
                      ) : (
                        <span className="text-muted-foreground">revenu en stock</span>
                      )}
                      {r.periods > 1 && <span className="text-xs text-muted-foreground"> · {r.periods} ruptures</span>}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.dailyRate.toLocaleString("fr-FR")}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.missed.toLocaleString("fr-FR")}</td>
                    <td className="py-2 text-right tabular-nums font-medium">{euros(r.missedAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {rows.length > shown && (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setShown((n) => n + PAGE)}>
              Afficher {Math.min(PAGE, rows.length - shown)} de plus ({formatNumber(rows.length - shown)} restantes)
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

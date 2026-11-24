"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { ChevronDown, ChevronRight, Download, History, Loader2, Search, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import { formatNumber } from "@/lib/utils";
import { fileStamp } from "@/lib/file-stamp";
import {
  buildProductGrids,
  buildSalesHistoryWorkbook,
  parseExportWorkbook,
  sizeShares,
  type ProductGrid,
  type SalesAggRow,
} from "@/lib/sales-history";

interface HistoryData {
  rows: SalesAggRow[];
  liveStart: string | null;
  coverage: { month: string; history: number; live: number }[];
  categories: { name: string; qty: number }[];
}

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const BATCH = 2000;
const PAGE = 25;
const fr = (ymd: string | null) => (ymd ? ymd.split("-").reverse().join("/") : "—");

export function BtocSalesHistoryTab() {
  const [data, setData] = useState<HistoryData | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [category, setCategory] = useState("Pull");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState(false);
  const [importLog, setImportLog] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const queryKey = (() => {
    const p = new URLSearchParams({ category });
    if (q) p.set("q", q);
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    return `${p.toString()}#${reload}`;
  })();
  const loading = loadedKey !== queryKey;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/btoc/sales-history?${queryKey.split("#")[0]}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d: HistoryData) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => console.error("Erreur chargement historique ventes:", e))
      .finally(() => {
        if (!cancelled) setLoadedKey(queryKey);
      });
    return () => {
      cancelled = true;
    };
  }, [queryKey]);

  const grids = useMemo(() => buildProductGrids(data?.rows ?? []), [data]);
  const years = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.year))].sort((a, b) => a - b), [data]);
  const totalQty = grids.reduce((s, g) => s + g.total, 0);
  const totalByYear = (y: number) => grids.reduce((s, g) => s + (g.byYear[y] ?? 0), 0);

  const coverageYears = useMemo(() => {
    const m = new Map<string, Map<number, { history: number; live: number }>>();
    for (const c of data?.coverage ?? []) {
      const [y, mo] = c.month.split("-");
      if (!m.has(y)) m.set(y, new Map());
      m.get(y)!.set(Number(mo), c);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [data]);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setImporting(true);
    const log: string[] = [];
    try {
      for (const file of Array.from(files)) {
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
        const parsed = parseExportWorkbook(wb);
        if (parsed.error) {
          log.push(`❌ ${file.name} : ${parsed.error}`);
          setImportLog([...log]);
          continue;
        }
        let inserted = 0;
        let updated = 0;
        let skippedLive = 0;
        for (let i = 0; i < parsed.lines.length; i += BATCH) {
          const res = await fetch("/api/btoc/sales-history/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileName: file.name, lines: parsed.lines.slice(i, i + BATCH) }),
          });
          if (!res.ok) throw new Error(`${file.name} : erreur serveur (HTTP ${res.status})`);
          const r: { inserted: number; updated: number; skippedLive: number } = await res.json();
          inserted += r.inserted;
          updated += r.updated;
          skippedLive += r.skippedLive;
        }
        const days = parsed.lines.map((l) => l.orderDay).sort();
        log.push(
          `✅ ${file.name} : ${formatNumber(parsed.lines.length)} lignes (${fr(days[0])} → ${fr(days[days.length - 1])}) — ` +
            `${formatNumber(inserted)} nouvelles, ${formatNumber(updated)} déjà connues` +
            (skippedLive ? `, ${formatNumber(skippedLive)} ignorées (déjà dans la synchro live)` : "") +
            (parsed.skipped ? `, ${formatNumber(parsed.skipped)} lignes sans article ignorées` : "")
        );
        setImportLog([...log]);
      }
    } catch (e) {
      log.push(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImportLog([...log]);
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
      setReload((n) => n + 1);
    }
  };

  const handleExport = () => {
    if (!data?.rows.length) return;
    const label = category === "all" ? "Toutes catégories" : category;
    const wb = buildSalesHistoryWorkbook(data.rows, `Ventes site (B2C) — ${label}${q ? ` — « ${q} »` : ""} — pièces`);
    XLSX.writeFile(wb, `historique-ventes-${label.toLowerCase().replace(/\s+/g, "-")}-${fileStamp()}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Couverture + import */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            Historique stocké
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Ventes du site par mois, en pièces. <span className="text-blue-600 font-medium">Bleu</span> = historique importé,{" "}
            <span className="text-emerald-600 font-medium">vert</span> = synchro WooCommerce en direct
            {data?.liveStart ? ` (depuis le ${fr(data.liveStart)})` : ""}, <span className="text-red-600 font-medium">rouge</span> = mois
            sans donnée. Pour combler un trou, importez l&apos;export « Commandes » WooCommerce de la période.
          </p>
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left font-medium text-muted-foreground">Année</th>
                  {MONTHS.map((m, i) => (
                    <th key={i} className="px-1 py-1 w-12 text-center font-medium text-muted-foreground">{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coverageYears.map(([y, months]) => (
                  <tr key={y}>
                    <td className="px-2 py-0.5 font-medium">{y}</td>
                    {MONTHS.map((_, i) => {
                      const c = months.get(i + 1);
                      const n = c ? c.history + c.live : 0;
                      const cls = !n
                        ? "bg-red-50 text-red-600"
                        : c!.live > 0
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-blue-50 text-blue-700";
                      return (
                        <td key={i} className={`px-1 py-0.5 text-center tabular-nums border border-background ${cls}`}>
                          {n ? formatNumber(n) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.xls"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <Button variant="outline" disabled={importing} onClick={() => fileInput.current?.click()}>
              {importing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
              Importer des exports WooCommerce
            </Button>
            <span className="text-xs text-muted-foreground">
              Fichiers xlsx « Commandes » (colonnes Numéro de commande, Date de commande, Nom du produit, UGS, Quantité, Prix du
              produit). Réimporter un fichier ne crée pas de doublon.
            </span>
          </div>
          {importLog.length > 0 && (
            <ul className="text-sm space-y-1">
              {importLog.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Filtres */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">Catégorie</label>
              <Select
                value={category}
                onValueChange={(v) => {
                  setCategory(v || "all");
                  setShown(PAGE);
                }}
              >
                <SelectTrigger className="w-44 h-9">
                  <span className="text-sm">{category === "all" ? "Toutes" : category}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes</SelectItem>
                  {(data?.categories ?? []).map((c) => (
                    <SelectItem key={c.name} value={c.name}>
                      {c.name} ({formatNumber(c.qty)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">Nom du produit contient</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && setQ(search.trim())}
                  onBlur={() => search.trim() !== q && setQ(search.trim())}
                  placeholder="1/2 zip, lambswool…"
                  className="w-52 h-9 pl-8"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">Vendu du</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40 h-9" />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">au</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40 h-9" />
            </div>
            <Button onClick={handleExport} disabled={loading || !data?.rows.length}>
              <Download className="h-4 w-4 mr-2" />
              Export Excel
            </Button>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </CardContent>
      </Card>

      {/* Synthèse */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">Produits</div>
              <div className="text-xl font-semibold">{formatNumber(grids.length)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Pièces vendues</div>
              <div className="text-xl font-semibold">{formatNumber(totalQty)}</div>
            </div>
            {years.map((y) => (
              <div key={y}>
                <div className="text-muted-foreground text-xs">{y}</div>
                <div className="text-xl font-semibold">{formatNumber(totalByYear(y))}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Grilles par produit */}
      <div className="space-y-3">
        {grids.slice(0, shown).map((g) => (
          <ProductCard
            key={g.productName}
            grid={g}
            years={years}
            open={!!open[g.productName]}
            onToggle={() => setOpen((o) => ({ ...o, [g.productName]: !o[g.productName] }))}
          />
        ))}
        {grids.length > shown && (
          <Button variant="outline" className="w-full" onClick={() => setShown((n) => n + PAGE)}>
            Afficher {Math.min(PAGE, grids.length - shown)} produits de plus ({grids.length - shown} restants)
          </Button>
        )}
        {!loading && grids.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">Aucune vente pour ces filtres.</p>
        )}
      </div>
    </div>
  );
}

function ProductCard({
  grid,
  years,
  open,
  onToggle,
}: {
  grid: ProductGrid;
  years: number[];
  open: boolean;
  onToggle: () => void;
}) {
  const shares = sizeShares(grid.allColors.sizes);
  return (
    <Card>
      <button type="button" onClick={onToggle} className="w-full text-left px-4 py-3 flex flex-wrap items-center gap-3">
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span className="font-medium">{grid.productName}</span>
        <Badge variant="secondary">{grid.category}</Badge>
        <span className="text-sm text-muted-foreground">
          {formatNumber(grid.total)} pièces · {grid.colors.length} couleur{grid.colors.length > 1 ? "s" : ""}
        </span>
        <span className="ml-auto flex gap-3 text-xs text-muted-foreground tabular-nums">
          {years.map((y) => (
            <span key={y}>
              {y} : <span className="text-foreground font-medium">{formatNumber(grid.byYear[y] ?? 0)}</span>
            </span>
          ))}
        </span>
      </button>
      {open && (
        <CardContent className="pt-0 overflow-x-auto">
          <table className="text-sm border-collapse min-w-full">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-1 text-left font-medium text-muted-foreground">Couleur</th>
                <th className="px-2 py-1 text-left font-medium text-muted-foreground">Année</th>
                {grid.sizes.map((s) => (
                  <th key={s} className="px-2 py-1 text-right font-medium text-muted-foreground">{s}</th>
                ))}
                <th className="px-2 py-1 text-right font-medium text-muted-foreground">Total</th>
              </tr>
            </thead>
            <tbody>
              {[...grid.colors, grid.allColors].map((c, ci) => {
                const isAll = ci === grid.colors.length;
                const lines = [
                  ...c.byYear.map((y) => ({ label: String(y.year), sizes: y.sizes, total: y.total, bold: false })),
                  ...(c.byYear.length > 1 ? [{ label: "Total", sizes: c.sizes, total: c.total, bold: true }] : []),
                ];
                return lines.map((l, li) => (
                  <tr
                    key={`${c.color}-${l.label}`}
                    className={`${li === 0 ? "border-t" : ""} ${isAll ? "bg-muted/50" : ""} ${l.bold ? "font-semibold" : ""}`}
                  >
                    <td className="px-2 py-1">{li === 0 ? c.color : ""}</td>
                    <td className="px-2 py-1 text-muted-foreground">{l.label}</td>
                    {grid.sizes.map((s) => (
                      <td key={s} className="px-2 py-1 text-right tabular-nums">{l.sizes[s] ? formatNumber(l.sizes[s]) : ""}</td>
                    ))}
                    <td className="px-2 py-1 text-right tabular-nums font-medium">{formatNumber(l.total)}</td>
                  </tr>
                ));
              })}
              <tr className="border-t text-xs text-muted-foreground">
                <td className="px-2 py-1" colSpan={2}>Part de chaque taille</td>
                {grid.sizes.map((s) => (
                  <td key={s} className="px-2 py-1 text-right tabular-nums">{shares[s] ?? 0} %</td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
        </CardContent>
      )}
    </Card>
  );
}

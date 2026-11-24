"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { ChevronDown, ChevronRight, Download, History, Loader2, Ruler, Search, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import { formatNumber } from "@/lib/utils";
import { fileStamp } from "@/lib/file-stamp";
import {
  buildProductGrids,
  buildSalesHistoryWorkbook,
  GROUP_MODE_LABELS,
  parseExportWorkbook,
  sizeShares,
  sizeSummary,
  topSize,
  type GroupMode,
  type ProductGrid,
  type SalesAggRow,
} from "@/lib/sales-history";

interface HistoryData {
  rows: SalesAggRow[];
  liveStart: string | null;
  coverage: { month: string; history: number; live: number }[];
  categories: { name: string; qty: number }[];
}

type Display = "qty" | "pct" | "both";
const DISPLAY_LABELS: Record<Display, string> = { qty: "Pièces", pct: "% des tailles", both: "Pièces et %" };

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const BATCH = 2000;
const PAGE = 25;
const fr = (ymd: string | null) => (ymd ? ymd.split("-").reverse().join("/") : "—");
const pctLabel = (n: number | undefined) => `${String(n ?? 0).replace(".", ",")} %`;

export function BtocSalesHistoryTab() {
  const [data, setData] = useState<HistoryData | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [categories, setCategories] = useState<string[]>(["Pull"]);
  const [group, setGroup] = useState<GroupMode>("code");
  const [display, setDisplay] = useState<Display>("both");
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
    const p = new URLSearchParams({ group });
    if (categories.length) p.set("categories", categories.join(","));
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
  const summary = useMemo(() => sizeSummary(data?.rows ?? []), [data]);
  const years = summary.years.map((y) => y.year);

  const coverageYears = useMemo(() => {
    const m = new Map<string, Map<number, { history: number; live: number }>>();
    for (const c of data?.coverage ?? []) {
      const [y, mo] = c.month.split("-");
      if (!m.has(y)) m.set(y, new Map());
      m.get(y)!.set(Number(mo), c);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [data]);

  const toggleCategory = (c: string) => {
    setCategories((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
    setShown(PAGE);
  };

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

  const selectionLabel = categories.length ? categories.join(" + ") : "Toutes catégories";

  const handleExport = () => {
    if (!data?.rows.length) return;
    const wb = buildSalesHistoryWorkbook(
      data.rows,
      `Ventes site (B2C) — ${selectionLabel}${q ? ` — « ${q} »` : ""} — regroupement : ${GROUP_MODE_LABELS[group]}`
    );
    const slug = selectionLabel.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    XLSX.writeFile(wb, `historique-ventes-${slug}-${fileStamp()}.xlsx`);
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
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">
              Catégories (cliquez pour en choisir une ou plusieurs)
            </label>
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant={categories.length === 0 ? "default" : "outline"}
                className="h-7"
                onClick={() => {
                  setCategories([]);
                  setShown(PAGE);
                }}
              >
                Toutes
              </Button>
              {(data?.categories ?? []).map((c) => (
                <Button
                  key={c.name}
                  size="sm"
                  variant={categories.includes(c.name) ? "default" : "outline"}
                  className="h-7"
                  onClick={() => toggleCategory(c.name)}
                >
                  {c.name} <span className="ml-1 opacity-70 tabular-nums">{formatNumber(c.qty)}</span>
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">Regrouper par</label>
              <Select
                value={group}
                onValueChange={(v) => {
                  setGroup((v as GroupMode) || "code");
                  setShown(PAGE);
                  setOpen({});
                }}
              >
                <SelectTrigger className="w-64 h-9">
                  <span className="text-sm">{GROUP_MODE_LABELS[group]}</span>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(GROUP_MODE_LABELS) as GroupMode[]).map((k) => (
                    <SelectItem key={k} value={k}>{GROUP_MODE_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">Afficher</label>
              <Select value={display} onValueChange={(v) => setDisplay((v as Display) || "both")}>
                <SelectTrigger className="w-40 h-9">
                  <span className="text-sm">{DISPLAY_LABELS[display]}</span>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(DISPLAY_LABELS) as Display[]).map((k) => (
                    <SelectItem key={k} value={k}>{DISPLAY_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                  placeholder="W001, 1/2 zip, lambswool…"
                  className="w-56 h-9 pl-8"
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

      {/* Synthèse + statistiques de tailles */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Ruler className="h-4 w-4" />
            {selectionLabel} — {formatNumber(grids.length)} modèles, {formatNumber(summary.all.total)} pièces
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {summary.sizes.length > 0 ? (
            <table className="text-sm border-collapse min-w-full">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-1 text-left font-medium text-muted-foreground">Année</th>
                  {summary.sizes.map((s) => (
                    <th key={s} className="px-2 py-1 text-right font-medium text-muted-foreground">{s}</th>
                  ))}
                  <th className="px-2 py-1 text-right font-medium text-muted-foreground">Total</th>
                  <th className="px-2 py-1 text-right font-medium text-muted-foreground">Taille n°1</th>
                </tr>
              </thead>
              <tbody>
                {[...summary.years.map((y) => ({ label: String(y.year), ...y, bold: false })), { label: "Toutes années", ...summary.all, bold: true }].map(
                  (y) => (
                    <tr key={y.label} className={`border-t ${y.bold ? "font-semibold bg-muted/50" : ""}`}>
                      <td className="px-2 py-1">{y.label}</td>
                      {summary.sizes.map((s) => (
                        <SizeCell key={s} qty={y.sizes[s]} pct={y.shares[s]} display={display} />
                      ))}
                      <td className="px-2 py-1 text-right tabular-nums font-medium">{formatNumber(y.total)}</td>
                      <td className="px-2 py-1 text-right">{y.top ?? "—"}</td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">{loading ? "Chargement…" : "Aucune vente pour ces filtres."}</p>
          )}
        </CardContent>
      </Card>

      {/* Grilles par modèle */}
      <div className="space-y-3">
        {grids.slice(0, shown).map((g) => (
          <ProductCard
            key={g.model}
            grid={g}
            years={years}
            display={display}
            open={!!open[g.model]}
            onToggle={() => setOpen((o) => ({ ...o, [g.model]: !o[g.model] }))}
          />
        ))}
        {grids.length > shown && (
          <Button variant="outline" className="w-full" onClick={() => setShown((n) => n + PAGE)}>
            Afficher {Math.min(PAGE, grids.length - shown)} modèles de plus ({grids.length - shown} restants)
          </Button>
        )}
      </div>
    </div>
  );
}

function SizeCell({ qty, pct, display }: { qty: number | undefined; pct: number | undefined; display: Display }) {
  if (!qty) return <td className="px-2 py-1 text-right tabular-nums text-muted-foreground/50">·</td>;
  return (
    <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">
      {display !== "pct" && <span>{formatNumber(qty)}</span>}
      {display === "both" && <span className="block text-[11px] leading-tight text-muted-foreground">{pctLabel(pct)}</span>}
      {display === "pct" && <span>{pctLabel(pct)}</span>}
    </td>
  );
}

function ProductCard({
  grid,
  years,
  display,
  open,
  onToggle,
}: {
  grid: ProductGrid;
  years: number[];
  display: Display;
  open: boolean;
  onToggle: () => void;
}) {
  const top = topSize(grid.allColors.sizes);
  const otherNames = grid.names.filter((n) => n !== grid.label);
  return (
    <Card>
      <button type="button" onClick={onToggle} className="w-full text-left px-4 py-3 space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span className="font-medium">{grid.label}</span>
          {grid.model !== grid.label && <Badge variant="outline">{grid.model}</Badge>}
          <Badge variant="secondary">{grid.category}</Badge>
          <span className="text-sm text-muted-foreground">
            {formatNumber(grid.total)} pièces · {grid.colors.length} couleur{grid.colors.length > 1 ? "s" : ""}
            {top ? ` · taille n°1 : ${top}` : ""}
          </span>
          <span className="ml-auto flex gap-3 text-xs text-muted-foreground tabular-nums">
            {years.map((y) => (
              <span key={y}>
                {y} : <span className="text-foreground font-medium">{formatNumber(grid.byYear[y] ?? 0)}</span>
              </span>
            ))}
          </span>
        </div>
        {(grid.references.length > 1 || otherNames.length > 0) && (
          <div className="pl-7 text-xs text-muted-foreground">
            {grid.references.length > 0 && <>Réf. {grid.references.join(", ")}</>}
            {otherNames.length > 0 && <> · aussi vendu sous : {otherNames.join(" / ")}</>}
          </div>
        )}
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
                <th className="px-2 py-1 text-right font-medium text-muted-foreground">Taille n°1</th>
              </tr>
            </thead>
            <tbody>
              {[...grid.colors, grid.allColors].map((c, ci) => {
                const isAll = ci === grid.colors.length;
                const lines = [
                  ...c.byYear.map((y) => ({ label: String(y.year), sizes: y.sizes, total: y.total, bold: false })),
                  ...(c.byYear.length > 1 ? [{ label: "Total", sizes: c.sizes, total: c.total, bold: true }] : []),
                ];
                return lines.map((l, li) => {
                  const sh = sizeShares(l.sizes);
                  return (
                    <tr
                      key={`${c.color}-${l.label}`}
                      className={`${li === 0 ? "border-t" : ""} ${isAll ? "bg-muted/50" : ""} ${l.bold ? "font-semibold" : ""}`}
                    >
                      <td className="px-2 py-1">{li === 0 ? c.color : ""}</td>
                      <td className="px-2 py-1 text-muted-foreground">{l.label}</td>
                      {grid.sizes.map((s) => (
                        <SizeCell key={s} qty={l.sizes[s]} pct={sh[s]} display={display} />
                      ))}
                      <td className="px-2 py-1 text-right tabular-nums font-medium">{formatNumber(l.total)}</td>
                      <td className="px-2 py-1 text-right">{topSize(l.sizes) ?? ""}</td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </CardContent>
      )}
    </Card>
  );
}

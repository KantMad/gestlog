"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useSeason } from "@/lib/season-context";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Loader2, ArrowLeftRight, Search, X } from "lucide-react";
import { cn, formatNumber, formatEuro } from "@/lib/utils";

interface CatRow {
  category: string;
  s1: { qty: number; ca: number; qtyWeight: number; caWeight: number };
  s2: { qty: number; ca: number; qtyWeight: number; caWeight: number };
  qtyPct: number;
  caPct: number;
  qtyWeightGap: number;
  caWeightGap: number;
}
interface CompData {
  season1: { name: string; qty: number; ca: number };
  season2: { name: string; qty: number; ca: number; endDate: string | null };
  global: { qtyPct: number; caPct: number };
  categories: CatRow[];
}
interface Catalog { name: string; seasonName: string | null }
interface ClientLite { code: string; name: string }

const pctCls = (p: number) => (p >= 100 ? "text-emerald-600" : "text-rose-600");
const gapCls = (g: number) => (g > 0.05 ? "text-emerald-600" : g < -0.05 ? "text-rose-600" : "text-muted-foreground");
const fmtPct = (p: number) => `${p.toFixed(0)}%`;
const fmtPts = (g: number) => `${g >= 0 ? "+" : ""}${g.toFixed(1)} pts`;
const fmtW = (w: number) => `${w.toFixed(1)}%`;

export default function SeasonComparisonPage() {
  const { seasons } = useSeason();
  const [dimension, setDimension] = useState<"season" | "catalog">("season");
  const [item1, setItem1] = useState("");
  const [item2, setItem2] = useState("");
  const [endDate, setEndDate] = useState("");
  const [data, setData] = useState<CompData | null>(null);
  const [loading, setLoading] = useState(false);

  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [clients, setClients] = useState<ClientLite[]>([]);

  // filtre boutique : mode + sélection
  const [filterMode, setFilterMode] = useState<"exclude" | "include">("exclude");
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  // listes de référence
  useEffect(() => {
    fetch("/api/catalogs").then((r) => r.json()).then((d) => setCatalogs(d.data || [])).catch(() => {});
    fetch("/api/clients").then((r) => r.json()).then((d) => setClients(d.data || [])).catch(() => {});
  }, []);

  const seasonNames = useMemo(() => [...new Set(seasons.map((s) => s.name))], [seasons]);
  const catalogNames = useMemo(() => catalogs.map((c) => c.name), [catalogs]);
  const options = dimension === "season" ? seasonNames : catalogNames;
  const labelOf = (name: string) =>
    dimension === "catalog"
      ? `${name}${catalogs.find((c) => c.name === name)?.seasonName ? ` · ${catalogs.find((c) => c.name === name)?.seasonName}` : ""}`
      : name;

  // (ré)initialise les deux items quand la dimension ou les listes changent
  useEffect(() => {
    if (!options.length) return;
    if (!options.includes(item2)) setItem2(options[0] || "");
    if (!options.includes(item1)) setItem1(options[1] || options[0] || "");
  }, [dimension, options]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    if (!item1 || !item2) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({ dimension, season1: item1, season2: item2 });
      if (endDate) p.set("endDate", endDate);
      if (selected.length) {
        p.set("filterMode", filterMode);
        p.set("clients", selected.join(","));
      }
      const res = await fetch(`/api/statistics/season-comparison?${p}`);
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      toast.error("Impossible de charger la comparaison");
    } finally {
      setLoading(false);
    }
  }, [dimension, item1, item2, endDate, filterMode, selected]);

  useEffect(() => {
    load();
  }, [load]);

  const dimLabel = dimension === "season" ? "saison" : "catalogue";

  // boutiques visibles dans la liste à cocher (filtrées par la recherche)
  const visibleClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? clients.filter(
          (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
        )
      : clients;
    return list.slice(0, 500); // garde-fou
  }, [search, clients]);
  const nameByCode = (code: string) => clients.find((c) => c.code === code)?.name || code;

  const toggleClient = (code: string) =>
    setSelected((p) => (p.includes(code) ? p.filter((x) => x !== code) : [...p, code]));
  const checkAllVisible = () =>
    setSelected((p) => [...new Set([...p, ...visibleClients.map((c) => c.code)])]);
  const uncheckAllVisible = () => {
    const vis = new Set(visibleClients.map((c) => c.code));
    setSelected((p) => p.filter((c) => !vis.has(c)));
  };

  const globalCa = data ? [{ name: "CA", [data.season1.name]: data.season1.ca, [data.season2.name]: data.season2.ca }] : [];
  const globalQty = data ? [{ name: "Quantité", [data.season1.name]: data.season1.qty, [data.season2.name]: data.season2.qty }] : [];
  const catCa = (data?.categories || []).slice(0, 12).map((c) => ({
    name: c.category,
    [data!.season1.name]: c.s1.ca,
    [data!.season2.name]: c.s2.ca,
  }));

  return (
    <div>
      <Topbar title="Comparaison saisons / catalogues" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="Comparaison saisons / catalogues"
          description="Compare deux saisons OU deux catalogues de vente. Item 1 (total) vs item 2 (filtrable par date), par catégorie : CA, quantité, poids et évolution. Filtre boutique inclusion/exclusion."
        />

        {/* Sélecteurs */}
        <Card className="overflow-visible">
          <CardContent className="pt-6 space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">Comparer par</label>
                <Select value={dimension} onValueChange={(v) => v && setDimension(v as "season" | "catalog")}>
                  <SelectTrigger className="w-44 h-9"><span className="text-sm">{dimension === "season" ? "Saison" : "Catalogue de vente"}</span></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="season">Saison</SelectItem>
                    <SelectItem value="catalog">Catalogue de vente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">{dimLabel} 1 (total)</label>
                <Select value={item1} onValueChange={(v) => v && setItem1(v)}>
                  <SelectTrigger className="w-56 h-9"><span className="text-sm truncate">{item1 ? labelOf(item1) : "—"}</span></SelectTrigger>
                  <SelectContent>{options.map((n) => <SelectItem key={n} value={n}>{labelOf(n)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <ArrowLeftRight className="h-4 w-4 text-muted-foreground mb-2.5" />
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">{dimLabel} 2 (filtré)</label>
                <Select value={item2} onValueChange={(v) => v && setItem2(v)}>
                  <SelectTrigger className="w-56 h-9"><span className="text-sm truncate">{item2 ? labelOf(item2) : "—"}</span></SelectTrigger>
                  <SelectContent>{options.map((n) => <SelectItem key={n} value={n}>{labelOf(n)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">Commandes {dimLabel} 2 jusqu&apos;au</label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-44 h-9" />
              </div>
              {endDate && <button onClick={() => setEndDate("")} className="text-xs text-muted-foreground underline mb-2.5">tout prendre</button>}
            </div>

            {/* Filtre boutique */}
            <div className="space-y-3 border-t pt-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-muted-foreground">Filtre boutique</label>
                  <Select value={filterMode} onValueChange={(v) => v && setFilterMode(v as "exclude" | "include")}>
                    <SelectTrigger className="w-56 h-9"><span className="text-sm">{filterMode === "exclude" ? "Toutes les boutiques sauf…" : "Aucune boutique sauf…"}</span></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="exclude">Toutes les boutiques sauf…</SelectItem>
                      <SelectItem value="include">Aucune boutique sauf…</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-muted-foreground">Rechercher une boutique</label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Filtrer la liste…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 w-72 h-9" />
                  </div>
                </div>
                <span className="text-xs text-muted-foreground mb-2.5">
                  {selected.length === 0
                    ? "Aucune cochée — toutes les boutiques."
                    : `${selected.length} boutique(s) ${filterMode === "exclude" ? "exclue(s)" : "incluse(s)"}.`}
                </span>
              </div>

              {/* Liste de cases à cocher (cochez plusieurs boutiques) */}
              <div className="rounded-md border">
                <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">
                    {visibleClients.length} boutique(s){search ? " trouvée(s)" : ""}
                  </span>
                  <div className="flex items-center gap-3">
                    <button onClick={checkAllVisible} className="underline hover:text-foreground">Tout cocher{search ? " (résultats)" : ""}</button>
                    <button onClick={uncheckAllVisible} className="underline hover:text-foreground">Tout décocher{search ? " (résultats)" : ""}</button>
                  </div>
                </div>
                <div className="grid max-h-64 grid-cols-1 gap-x-4 gap-y-0.5 overflow-auto p-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {visibleClients.map((c) => (
                    <label key={c.code} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={selected.includes(c.code)}
                        onChange={() => toggleClient(c.code)}
                        className="h-4 w-4 accent-primary shrink-0"
                      />
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{c.code}</span>
                    </label>
                  ))}
                  {visibleClients.length === 0 && (
                    <div className="col-span-full px-3 py-4 text-xs text-muted-foreground">Aucune boutique ne correspond.</div>
                  )}
                </div>
              </div>

              {/* Récap des boutiques cochées */}
              {selected.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {selected.map((code) => (
                    <span key={code} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs">
                      {nameByCode(code)}
                      <button onClick={() => setSelected((p) => p.filter((x) => x !== code))} aria-label="Retirer"><X className="h-3 w-3" /></button>
                    </span>
                  ))}
                  <button onClick={() => setSelected([])} className="text-xs text-muted-foreground underline">tout effacer</button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {loading && !data ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : !data ? null : (
          <>
            {/* KPI globaux */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">CA — {data.season1.name} (total)</p><p className="text-2xl font-bold">{formatEuro(data.season1.ca)}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">CA — {data.season2.name}{data.season2.endDate ? ` (≤ ${data.season2.endDate})` : ""}</p><p className="text-2xl font-bold">{formatEuro(data.season2.ca)}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">CA item 2 / item 1</p><p className={cn("text-2xl font-bold", pctCls(data.global.caPct))}>{fmtPct(data.global.caPct)}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Quantité — {data.season1.name} (total)</p><p className="text-2xl font-bold">{formatNumber(data.season1.qty)}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Quantité — {data.season2.name}{data.season2.endDate ? ` (≤ ${data.season2.endDate})` : ""}</p><p className="text-2xl font-bold">{formatNumber(data.season2.qty)}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Quantité item 2 / item 1</p><p className={cn("text-2xl font-bold", pctCls(data.global.qtyPct))}>{fmtPct(data.global.qtyPct)}</p></CardContent></Card>
            </div>

            {/* Graphiques écarts globaux */}
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle className="text-base">Écart de CA global</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={globalCa}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatEuro(v)} width={70} />
                      <Tooltip formatter={(v) => formatEuro(Number(v))} />
                      <Legend />
                      <Bar dataKey={data.season1.name} fill="#3B82F6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey={data.season2.name} fill="#F43F5E" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Écart de quantité global</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={globalQty}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} width={60} />
                      <Tooltip formatter={(v) => formatNumber(Number(v))} />
                      <Legend />
                      <Bar dataKey={data.season1.name} fill="#3B82F6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey={data.season2.name} fill="#F43F5E" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* CA par catégorie */}
            {catCa.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">CA par catégorie — {data.season1.name} vs {data.season2.name}</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={Math.max(260, catCa.length * 34 + 40)}>
                    <BarChart data={catCa} layout="vertical" margin={{ left: 8, right: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => formatEuro(v)} />
                      <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} interval={0} />
                      <Tooltip formatter={(v) => formatEuro(Number(v))} />
                      <Legend />
                      <Bar dataKey={data.season1.name} fill="#3B82F6" radius={[0, 4, 4, 0]} />
                      <Bar dataKey={data.season2.name} fill="#F43F5E" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Tableau détaillé par catégorie */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Détail par catégorie</CardTitle>
                <p className="text-xs text-muted-foreground">Poids = part de la catégorie dans son {dimLabel}. % = item 2 / item 1. Écart de poids en points entre les deux.</p>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead rowSpan={2} className="align-bottom">Catégorie</TableHead>
                      <TableHead colSpan={4} className="text-center border-l">{data.season1.name} (total)</TableHead>
                      <TableHead colSpan={4} className="text-center border-l">{data.season2.name}{data.season2.endDate ? ` (≤ ${data.season2.endDate})` : ""}</TableHead>
                      <TableHead colSpan={4} className="text-center border-l">Comparaison</TableHead>
                    </TableRow>
                    <TableRow>
                      <TableHead className="text-right border-l">Qté</TableHead>
                      <TableHead className="text-right">CA</TableHead>
                      <TableHead className="text-right">Poids qté</TableHead>
                      <TableHead className="text-right">Poids CA</TableHead>
                      <TableHead className="text-right border-l">Qté</TableHead>
                      <TableHead className="text-right">CA</TableHead>
                      <TableHead className="text-right">Poids qté</TableHead>
                      <TableHead className="text-right">Poids CA</TableHead>
                      <TableHead className="text-right border-l">% CA</TableHead>
                      <TableHead className="text-right">% Qté</TableHead>
                      <TableHead className="text-right">Δ poids CA</TableHead>
                      <TableHead className="text-right">Δ poids qté</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.categories.map((c) => (
                      <TableRow key={c.category}>
                        <TableCell className="font-medium">{c.category}</TableCell>
                        <TableCell className="text-right border-l">{formatNumber(c.s1.qty)}</TableCell>
                        <TableCell className="text-right">{formatEuro(c.s1.ca)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{fmtW(c.s1.qtyWeight)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{fmtW(c.s1.caWeight)}</TableCell>
                        <TableCell className="text-right border-l">{formatNumber(c.s2.qty)}</TableCell>
                        <TableCell className="text-right">{formatEuro(c.s2.ca)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{fmtW(c.s2.qtyWeight)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{fmtW(c.s2.caWeight)}</TableCell>
                        <TableCell className={cn("text-right font-medium border-l", pctCls(c.caPct))}>{fmtPct(c.caPct)}</TableCell>
                        <TableCell className={cn("text-right font-medium", pctCls(c.qtyPct))}>{fmtPct(c.qtyPct)}</TableCell>
                        <TableCell className={cn("text-right", gapCls(c.caWeightGap))}>{fmtPts(c.caWeightGap)}</TableCell>
                        <TableCell className={cn("text-right", gapCls(c.qtyWeightGap))}>{fmtPts(c.qtyWeightGap)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

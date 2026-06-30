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
import { Loader2, ArrowLeftRight, Search, X, Users } from "lucide-react";
import { cn, formatNumber, formatEuro } from "@/lib/utils";

interface CatRow {
  category: string;
  s1: { ca: number; qty: number };
  s2: { ca: number; qty: number };
}
interface ClientRow {
  code: string;
  name: string;
  s1: { ca: number; qty: number };
  s2: { ca: number; qty: number };
  caPct: number;
  qtyPct: number;
  categories: CatRow[];
}
interface CompData {
  season1: string;
  season2: string;
  clients: ClientRow[];
}

const pctCls = (p: number) => (p >= 100 ? "text-emerald-600" : "text-rose-600");
const fmtPct = (p: number) => `${p.toFixed(0)}%`;

export default function ClientComparisonPage() {
  const { seasons } = useSeason();
  const [season1, setSeason1] = useState("");
  const [season2, setSeason2] = useState("");
  const [data, setData] = useState<CompData | null>(null);
  const [loading, setLoading] = useState(false);

  // filtre enseigne (mode + multi-sélection à cocher + recherche)
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<"exclude" | "include">("include");

  useEffect(() => {
    if (seasons.length && !season1 && !season2) {
      setSeason2(seasons[0]?.name || "");
      setSeason1(seasons[1]?.name || seasons[0]?.name || "");
    }
  }, [seasons, season1, season2]);

  const load = useCallback(async () => {
    if (!season1 || !season2) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({ season1, season2 });
      const res = await fetch(`/api/statistics/client-comparison?${p}`);
      if (!res.ok) throw new Error();
      setData(await res.json());
      setSelected([]);
    } catch {
      toast.error("Impossible de charger la comparaison");
    } finally {
      setLoading(false);
    }
  }, [season1, season2]);

  useEffect(() => {
    load();
  }, [load]);

  const seasonNames = [...new Set(seasons.map((s) => s.name))];
  const allClients = data?.clients || [];

  // boutiques visibles dans la liste à cocher (filtrées par la recherche)
  const visibleClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? allClients.filter(
          (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
        )
      : allClients;
    return list.slice(0, 500);
  }, [search, allClients]);

  const toggleClient = (code: string) =>
    setSelected((p) => (p.includes(code) ? p.filter((x) => x !== code) : [...p, code]));
  const checkAllVisible = () =>
    setSelected((p) => [...new Set([...p, ...visibleClients.map((c) => c.code)])]);
  const uncheckAllVisible = () => {
    const vis = new Set(visibleClients.map((c) => c.code));
    setSelected((p) => p.filter((c) => !vis.has(c)));
  };

  // périmètre : selon le mode (aucune sélection → toutes les boutiques)
  const filtered = !selected.length
    ? allClients
    : filterMode === "include"
      ? allClients.filter((c) => selected.includes(c.code))
      : allClients.filter((c) => !selected.includes(c.code));

  // résumé (scopé au filtre)
  const summary = useMemo(() => {
    const s1c = filtered.filter((c) => c.s1.ca || c.s1.qty).length;
    const s2c = filtered.filter((c) => c.s2.ca || c.s2.qty).length;
    const sum = (sel: (c: ClientRow) => number) => filtered.reduce((s, c) => s + sel(c), 0);
    const ca1 = sum((c) => c.s1.ca), ca2 = sum((c) => c.s2.ca);
    const q1 = sum((c) => c.s1.qty), q2 = sum((c) => c.s2.qty);
    const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
    return { s1c, s2c, ca1, ca2, q1, q2, clientsPct: pct(s2c, s1c), caPct: pct(ca2, ca1), qtyPct: pct(q2, q1) };
  }, [filtered]);

  // Détail par catégorie : agrégé sur les boutiques FILTRÉES (Qté + CA, 2 saisons).
  const categoryBreakdown = useMemo(() => {
    const m = new Map<string, { s1: { ca: number; qty: number }; s2: { ca: number; qty: number } }>();
    for (const c of filtered) {
      for (const cat of c.categories || []) {
        const e = m.get(cat.category) || { s1: { ca: 0, qty: 0 }, s2: { ca: 0, qty: 0 } };
        e.s1.ca += cat.s1.ca;
        e.s1.qty += cat.s1.qty;
        e.s2.ca += cat.s2.ca;
        e.s2.qty += cat.s2.qty;
        m.set(cat.category, e);
      }
    }
    const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
    return [...m.entries()]
      .map(([category, v]) => ({
        category,
        ...v,
        caPct: pct(v.s2.ca, v.s1.ca),
        qtyPct: pct(v.s2.qty, v.s1.qty),
      }))
      .filter((x) => x.s1.ca || x.s1.qty || x.s2.ca || x.s2.qty)
      .sort((a, b) => b.s1.ca - a.s1.ca);
  }, [filtered]);

  const nameByCode = (code: string) => allClients.find((c) => c.code === code)?.name || code;

  return (
    <div>
      <Topbar title="Comparaison clients" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="Comparaison clients"
          description="Compare deux saisons par client (boutique). Sans filtre : totaux (nb clients, CA, quantité). Avec filtre enseigne : détail par boutique. Règle : saison 2 / saison 1."
        />

        {/* Sélecteurs saisons + filtre enseigne */}
        <Card className="overflow-visible">
          <CardContent className="pt-6 space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">Saison 1</label>
                <Select value={season1} onValueChange={(v) => v && setSeason1(v)}>
                  <SelectTrigger className="w-40 h-9"><span className="text-sm truncate">{season1 || "—"}</span></SelectTrigger>
                  <SelectContent>{seasonNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <ArrowLeftRight className="h-4 w-4 text-muted-foreground mb-2.5" />
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">Saison 2</label>
                <Select value={season2} onValueChange={(v) => v && setSeason2(v)}>
                  <SelectTrigger className="w-40 h-9"><span className="text-sm truncate">{season2 || "—"}</span></SelectTrigger>
                  <SelectContent>{seasonNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">Filtre boutique</label>
                <Select value={filterMode} onValueChange={(v) => v && setFilterMode(v as "exclude" | "include")}>
                  <SelectTrigger className="w-56 h-9"><span className="text-sm">{filterMode === "exclude" ? "Toutes les boutiques sauf…" : "Aucune boutique sauf…"}</span></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="include">Aucune boutique sauf…</SelectItem>
                    <SelectItem value="exclude">Toutes les boutiques sauf…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">Rechercher une boutique</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Filtrer la liste…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 w-72 h-9"
                  />
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
                <span className="text-muted-foreground">{visibleClients.length} boutique(s){search ? " trouvée(s)" : ""}</span>
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

            {/* chips des boutiques cochées */}
            {selected.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {selected.map((code) => (
                  <span key={code} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs">
                    {nameByCode(code)}
                    <button onClick={() => setSelected((p) => p.filter((x) => x !== code))} aria-label="Retirer">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <button onClick={() => setSelected([])} className="text-xs text-muted-foreground underline">tout effacer</button>
              </div>
            )}
          </CardContent>
        </Card>

        {loading && !data ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : !data ? null : (
          <>
            {/* Résumé (scopé au filtre) */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <Card><CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" /> Nombre de clients</div>
                <p className="text-2xl font-bold">{formatNumber(summary.s1c)} <span className="text-muted-foreground text-base font-normal">→</span> {formatNumber(summary.s2c)}</p>
                <p className={cn("text-xs font-medium", pctCls(summary.clientsPct))}>{fmtPct(summary.clientsPct)} <span className="text-muted-foreground font-normal">(S2/S1)</span></p>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <p className="text-xs text-muted-foreground">CA</p>
                <p className="text-2xl font-bold">{formatEuro(summary.ca1)} <span className="text-muted-foreground text-base font-normal">→</span> {formatEuro(summary.ca2)}</p>
                <p className={cn("text-xs font-medium", pctCls(summary.caPct))}>{fmtPct(summary.caPct)} <span className="text-muted-foreground font-normal">(S2/S1)</span></p>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Quantité</p>
                <p className="text-2xl font-bold">{formatNumber(summary.q1)} <span className="text-muted-foreground text-base font-normal">→</span> {formatNumber(summary.q2)}</p>
                <p className={cn("text-xs font-medium", pctCls(summary.qtyPct))}>{fmtPct(summary.qtyPct)} <span className="text-muted-foreground font-normal">(S2/S1)</span></p>
              </CardContent></Card>
            </div>

            {/* Détail par catégorie (agrégé sur les boutiques filtrées) */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Détail par catégorie
                  <span className="text-xs font-normal text-muted-foreground"> — {data.season1} vs {data.season2}{selected.length ? ` · ${filtered.length} boutique(s)` : ""}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Catégorie</TableHead>
                      <TableHead className="text-right border-l">CA {data.season1}</TableHead>
                      <TableHead className="text-right">CA {data.season2}</TableHead>
                      <TableHead className="text-right">% CA</TableHead>
                      <TableHead className="text-right border-l">Qté {data.season1}</TableHead>
                      <TableHead className="text-right">Qté {data.season2}</TableHead>
                      <TableHead className="text-right">% Qté</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categoryBreakdown.map((c) => (
                      <TableRow key={c.category}>
                        <TableCell className="font-medium">{c.category}</TableCell>
                        <TableCell className="text-right border-l">{formatEuro(c.s1.ca)}</TableCell>
                        <TableCell className="text-right">{formatEuro(c.s2.ca)}</TableCell>
                        <TableCell className={cn("text-right font-medium", pctCls(c.caPct))}>{c.s1.ca ? fmtPct(c.caPct) : "—"}</TableCell>
                        <TableCell className="text-right border-l">{formatNumber(c.s1.qty)}</TableCell>
                        <TableCell className="text-right">{formatNumber(c.s2.qty)}</TableCell>
                        <TableCell className={cn("text-right font-medium", pctCls(c.qtyPct))}>{c.s1.qty ? fmtPct(c.qtyPct) : "—"}</TableCell>
                      </TableRow>
                    ))}
                    {categoryBreakdown.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">Aucune catégorie.</TableCell></TableRow>
                    ) : (() => {
                      const t = categoryBreakdown.reduce(
                        (a, c) => ({ s1ca: a.s1ca + c.s1.ca, s1qty: a.s1qty + c.s1.qty, s2ca: a.s2ca + c.s2.ca, s2qty: a.s2qty + c.s2.qty }),
                        { s1ca: 0, s1qty: 0, s2ca: 0, s2qty: 0 }
                      );
                      const cp = t.s1ca > 0 ? (t.s2ca / t.s1ca) * 100 : 0;
                      const qp = t.s1qty > 0 ? (t.s2qty / t.s1qty) * 100 : 0;
                      return (
                        <TableRow className="border-t-2 font-semibold">
                          <TableCell>TOTAL</TableCell>
                          <TableCell className="text-right border-l">{formatEuro(t.s1ca)}</TableCell>
                          <TableCell className="text-right">{formatEuro(t.s2ca)}</TableCell>
                          <TableCell className={cn("text-right", pctCls(cp))}>{t.s1ca ? fmtPct(cp) : "—"}</TableCell>
                          <TableCell className="text-right border-l">{formatNumber(t.s1qty)}</TableCell>
                          <TableCell className="text-right">{formatNumber(t.s2qty)}</TableCell>
                          <TableCell className={cn("text-right", pctCls(qp))}>{t.s1qty ? fmtPct(qp) : "—"}</TableCell>
                        </TableRow>
                      );
                    })()}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Détail par boutique */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {selected.length ? `Boutiques filtrées (${filtered.length})` : `Toutes les boutiques (${filtered.length})`}
                  <span className="text-xs font-normal text-muted-foreground"> — {data.season1} vs {data.season2}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Boutique</TableHead>
                      <TableHead className="text-right border-l">CA {data.season1}</TableHead>
                      <TableHead className="text-right">CA {data.season2}</TableHead>
                      <TableHead className="text-right">% CA</TableHead>
                      <TableHead className="text-right border-l">Qté {data.season1}</TableHead>
                      <TableHead className="text-right">Qté {data.season2}</TableHead>
                      <TableHead className="text-right">% Qté</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((c) => (
                      <TableRow key={c.code}>
                        <TableCell>
                          <div className="font-medium">{c.name}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">{c.code}</div>
                        </TableCell>
                        <TableCell className="text-right border-l">{formatEuro(c.s1.ca)}</TableCell>
                        <TableCell className="text-right">{formatEuro(c.s2.ca)}</TableCell>
                        <TableCell className={cn("text-right font-medium", pctCls(c.caPct))}>{c.s1.ca ? fmtPct(c.caPct) : "—"}</TableCell>
                        <TableCell className="text-right border-l">{formatNumber(c.s1.qty)}</TableCell>
                        <TableCell className="text-right">{formatNumber(c.s2.qty)}</TableCell>
                        <TableCell className={cn("text-right font-medium", pctCls(c.qtyPct))}>{c.s1.qty ? fmtPct(c.qtyPct) : "—"}</TableCell>
                      </TableRow>
                    ))}
                    {filtered.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">Aucune boutique.</TableCell></TableRow>
                    )}
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

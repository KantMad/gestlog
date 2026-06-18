"use client";

import { useEffect, useState, useCallback } from "react";
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
import { Loader2, ArrowLeftRight } from "lucide-react";
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

function pctCls(p: number) {
  return p >= 100 ? "text-emerald-600" : "text-rose-600";
}
function gapCls(g: number) {
  return g > 0.05 ? "text-emerald-600" : g < -0.05 ? "text-rose-600" : "text-muted-foreground";
}
const fmtPct = (p: number) => `${p.toFixed(0)}%`;
const fmtPts = (g: number) => `${g >= 0 ? "+" : ""}${g.toFixed(1)} pts`;
const fmtW = (w: number) => `${w.toFixed(1)}%`;

export default function SeasonComparisonPage() {
  const { seasons } = useSeason();
  const [season1, setSeason1] = useState("");
  const [season2, setSeason2] = useState("");
  const [endDate, setEndDate] = useState("");
  const [data, setData] = useState<CompData | null>(null);
  const [loading, setLoading] = useState(false);

  // Défauts : saison 2 = la plus récente, saison 1 = la précédente.
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
      if (endDate) p.set("endDate", endDate);
      const res = await fetch(`/api/statistics/season-comparison?${p}`);
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      toast.error("Impossible de charger la comparaison");
    } finally {
      setLoading(false);
    }
  }, [season1, season2, endDate]);

  useEffect(() => {
    load();
  }, [load]);

  // noms de saisons uniques pour les sélecteurs
  const seasonNames = [...new Set(seasons.map((s) => s.name))];

  const globalCa = data
    ? [{ name: "CA", [data.season1.name]: data.season1.ca, [data.season2.name]: data.season2.ca }]
    : [];
  const globalQty = data
    ? [{ name: "Quantité", [data.season1.name]: data.season1.qty, [data.season2.name]: data.season2.qty }]
    : [];
  const catCa = (data?.categories || []).slice(0, 12).map((c) => ({
    name: c.category,
    [data!.season1.name]: c.s1.ca,
    [data!.season2.name]: c.s2.ca,
  }));

  return (
    <div>
      <Topbar title="Comparaison saisons" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="Comparaison saisons"
          description="Saison 1 (totale) vs Saison 2 (filtrée jusqu'à une date) — écarts de CA et de quantité, par catégorie, avec poids et évolution."
        />

        {/* Sélecteurs */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">Saison 1 (totale)</label>
                <Select value={season1} onValueChange={(v) => v && setSeason1(v)}>
                  <SelectTrigger className="w-44 h-9"><span className="text-sm truncate">{season1 || "—"}</span></SelectTrigger>
                  <SelectContent>{seasonNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <ArrowLeftRight className="h-4 w-4 text-muted-foreground mb-2.5" />
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">Saison 2 (filtrée)</label>
                <Select value={season2} onValueChange={(v) => v && setSeason2(v)}>
                  <SelectTrigger className="w-44 h-9"><span className="text-sm truncate">{season2 || "—"}</span></SelectTrigger>
                  <SelectContent>{seasonNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">Commandes saison 2 jusqu&apos;au</label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-44 h-9" />
              </div>
              {endDate && (
                <button onClick={() => setEndDate("")} className="text-xs text-muted-foreground underline mb-2.5">tout prendre</button>
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
              <Card><CardContent className="p-4">
                <p className="text-xs text-muted-foreground">CA — {data.season1.name} (total)</p>
                <p className="text-2xl font-bold">{formatEuro(data.season1.ca)}</p>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <p className="text-xs text-muted-foreground">CA — {data.season2.name}{data.season2.endDate ? ` (≤ ${data.season2.endDate})` : ""}</p>
                <p className="text-2xl font-bold">{formatEuro(data.season2.ca)}</p>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <p className="text-xs text-muted-foreground">CA saison 2 / saison 1</p>
                <p className={cn("text-2xl font-bold", pctCls(data.global.caPct))}>{fmtPct(data.global.caPct)}</p>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Quantité — {data.season1.name} (total)</p>
                <p className="text-2xl font-bold">{formatNumber(data.season1.qty)}</p>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Quantité — {data.season2.name}{data.season2.endDate ? ` (≤ ${data.season2.endDate})` : ""}</p>
                <p className="text-2xl font-bold">{formatNumber(data.season2.qty)}</p>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Quantité saison 2 / saison 1</p>
                <p className={cn("text-2xl font-bold", pctCls(data.global.qtyPct))}>{fmtPct(data.global.qtyPct)}</p>
              </CardContent></Card>
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
                <p className="text-xs text-muted-foreground">Poids = part de la catégorie dans sa saison. % = saison 2 / saison 1. Écart de poids en points entre les deux saisons.</p>
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

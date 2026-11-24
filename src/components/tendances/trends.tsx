"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { AlertTriangle, Download, Loader2, Search, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { formatNumber } from "@/lib/utils";
import { fileStamp } from "@/lib/file-stamp";
import {
  TREND_LEVEL_LABELS,
  VERDICT_LABELS,
  type Brand,
  type CategoryEvolution,
  type TrendLevel,
  type TrendRow,
  type TrendTotals,
  type Verdict,
} from "@/lib/trends";

interface Season {
  id: string;
  name: string;
  year: number;
  type: string;
  hasFinal: boolean;
}

interface Data {
  seasons: Season[];
  season: Season | null;
  level: TrendLevel;
  totals?: TrendTotals;
  totalsByBrand?: (TrendTotals & { brand: Brand })[];
  unpaired?: { orders: number; qty: number; amount: number } | null;
  incomplete?: { orders: number; qty: number };
  rows: (TrendRow & { verdict: Verdict | null })[];
  evolution?: { seasons: string[]; rows: CategoryEvolution[] };
}

const PAGE = 100;
const euros = (n: number) => `${formatNumber(Math.round(n))} €`;
const pctTxt = (n: number) => `${n.toLocaleString("fr-FR")} %`;
const VERDICT_STYLE: Record<Verdict, string> = {
  tient: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  moyenne: "bg-muted text-muted-foreground",
  perd: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

export function Trends() {
  const [data, setData] = useState<Data | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState("");
  const [brand, setBrand] = useState<"" | Brand>("MCS");
  const [level, setLevel] = useState<TrendLevel>("category");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE);

  const queryKey = (() => {
    const p = new URLSearchParams({ level });
    if (seasonId) p.set("seasonId", seasonId);
    if (brand) p.set("brand", brand);
    return p.toString();
  })();
  const loading = loadedKey !== queryKey;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tendances?${queryKey}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d: Data) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => console.error("Erreur chargement tendances:", e))
      .finally(() => {
        if (!cancelled) setLoadedKey(queryKey);
      });
    return () => {
      cancelled = true;
    };
  }, [queryKey]);

  const season = data?.season ?? null;
  const hasFinal = !!season?.hasFinal;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = data?.rows ?? [];
    return q
      ? all.filter((r) => `${r.label} ${r.reference ?? ""} ${r.color ?? ""} ${r.category} ${r.subCategory}`.toLowerCase().includes(q))
      : all;
  }, [data, search]);

  const labelOf = (r: TrendRow) =>
    level === "color" ? `${r.label} — ${r.color}` : level === "subCategory" ? `${r.category} › ${r.subCategory}` : r.label;

  const handleExport = () => {
    if (!data || !season) return;
    const wb = XLSX.utils.book_new();
    const comp = rows.map((r) => ({
      Marque: r.brand,
      Catégorie: r.category,
      ...(level !== "category" ? { "Sous-catégorie": r.subCategory } : {}),
      ...(level === "product" || level === "color" ? { Référence: r.reference ?? "", Produit: r.label } : {}),
      ...(level === "color" ? { Coloris: r.color ?? "" } : {}),
      "Précommande (pcs)": r.preQty,
      "Précommande (€)": Math.round(r.preAmount),
      ...(hasFinal
        ? {
            "Commande finale (pcs)": r.finalQty,
            "Commande finale (€)": Math.round(r.finalAmount),
            "Pièces perdues": r.lostQty,
            "Perte pcs (%)": r.lossRate,
            "Perte € (%)": r.lossRateAmount,
            "Dont commandes perdues en entier (pcs)": r.lostOrdersQty,
            Verdict: r.verdict ? VERDICT_LABELS[r.verdict] : "",
          }
        : {}),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(comp), "Comparaison");
    if (data.totalsByBrand) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          data.totalsByBrand.map((t) => ({
            Marque: t.brand,
            "Précommande (pcs)": t.preQty,
            "Précommande (€)": Math.round(t.preAmount),
            "Commande finale (pcs)": hasFinal ? t.finalQty : "",
            "Commande finale (€)": hasFinal ? Math.round(t.finalAmount) : "",
            "Perte pcs (%)": hasFinal ? t.lossRate : "",
            "Perte € (%)": hasFinal ? t.lossRateAmount : "",
            "Commandes perdues en entier (pcs)": hasFinal ? t.lostOrdersQty : "",
          }))
        ),
        "Synthèse marques"
      );
    }
    if (data.evolution) {
      const ev = data.evolution;
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          ev.rows.map((e) => {
            const o: Record<string, string | number> = { Marque: e.brand, Catégorie: e.category };
            for (const s of ev.seasons) {
              o[`${s} pcs`] = e.bySeason[s]?.qty ?? 0;
              o[`${s} part %`] = e.bySeason[s]?.share ?? 0;
            }
            o.Tendance = e.trend ?? "";
            return o;
          })
        ),
        "Évolution précommandes"
      );
    }
    XLSX.writeFile(wb, `Tendances ${season.name}${brand ? ` ${brand}` : ""} ${TREND_LEVEL_LABELS[level]} ${fileStamp()}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <Card className="overflow-visible">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">Saison</label>
              <Select
                value={season?.id ?? ""}
                onValueChange={(v) => {
                  setSeasonId(String(v || ""));
                  setShown(PAGE);
                }}
              >
                <SelectTrigger className="w-64 h-9">
                  <span className="text-sm">
                    {season ? `${season.name}${season.hasFinal ? " — précommande + finale" : " — précommande seule"}` : "…"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {(data?.seasons ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} {s.hasFinal ? "— précommande + finale" : "— précommande seule"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">Marque</label>
              <div className="flex gap-1">
                {(["MCS", "TDH", ""] as const).map((b) => (
                  <Button key={b || "all"} size="sm" variant={brand === b ? "default" : "outline"} onClick={() => setBrand(b)}>
                    {b || "Les deux"}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">Détail par</label>
              <Select
                value={level}
                onValueChange={(v) => {
                  setLevel((v as TrendLevel) || "category");
                  setShown(PAGE);
                }}
              >
                <SelectTrigger className="w-48 h-9">
                  <span className="text-sm">{TREND_LEVEL_LABELS[level]}</span>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TREND_LEVEL_LABELS) as TrendLevel[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {TREND_LEVEL_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">Contient</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Chemise, W001…" className="w-52 h-9 pl-8" />
              </div>
            </div>
            <Button onClick={handleExport} disabled={loading || !rows.length}>
              <Download className="h-4 w-4 mr-2" />
              Export Excel
            </Button>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </CardContent>
      </Card>

      {/* Synthèse par marque */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingDown className="h-4 w-4" />
            {season ? `${season.name} : précommandes ${hasFinal ? "et commandes finales" : ""}` : "Synthèse"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            {(data?.totalsByBrand ?? []).map((t) => (
              <div key={t.brand} className={`rounded-md border p-3 space-y-2 ${brand && brand !== t.brand ? "opacity-50" : ""}`}>
                <div className="font-semibold">{t.brand === "TDH" ? "TDH — Territoire d'homme" : "MCS"}</div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <Stat label="Précommande" value={`${formatNumber(t.preQty)} pcs`} sub={euros(t.preAmount)} />
                  {hasFinal ? (
                    <>
                      <Stat label="Commande finale" value={`${formatNumber(t.finalQty)} pcs`} sub={euros(t.finalAmount)} />
                      <Stat label="Perte" value={`${pctTxt(t.lossRate)} des pièces`} sub={`${pctTxt(t.lossRateAmount)} du CA`} />
                      <Stat label="Commandes perdues en entier" value={`${formatNumber(t.lostOrdersQty)} pcs`} sub={euros(t.lostOrdersAmount)} />
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          {!hasFinal && season && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Pas de commande finale Texas importée pour {season.name} : seules les précommandes sont connues. Importer
              l&apos;export Texas de la saison (écran Import → Commandes clients Texas) pour calculer les pertes.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Précommande = commandes prises sur TIO ; commande finale = la même commande dans Texas (reliée par sa référence
            TIO). Une commande TIO absente de Texas compte comme « perdue en entier ». Hors PLV, hors VSS, pièces soldées
            déduites côté Texas. Le verdict compare chaque ligne au taux de perte moyen de sa marque (±5 points, au-delà de 50
            pièces).
            {data?.unpaired?.orders
              ? ` ${formatNumber(data.unpaired.orders)} commandes Texas sans commande TIO (réassorts, ${formatNumber(data.unpaired.qty)} pcs) sont hors comparaison.`
              : ""}
          </p>
          {data?.incomplete?.orders ? (
            <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              {formatNumber(data.incomplete.orders)} commandes TIO sans catalogue, sans date et sans montant (
              {formatNumber(data.incomplete.qty)} pcs) sont écartées : elles fausseraient les pertes. À vérifier dans TIO.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Détail */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Détail par {TREND_LEVEL_LABELS[level].toLowerCase()} {hasFinal ? "— trié par pièces perdues" : "— trié par pièces précommandées"}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!rows.length ? (
            <p className="text-sm text-muted-foreground">{loading ? "Chargement…" : "Aucune donnée."}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">{TREND_LEVEL_LABELS[level]}</th>
                  <th className="py-2 pr-3 text-right">Précommande</th>
                  {hasFinal && (
                    <>
                      <th className="py-2 pr-3 text-right">Finale</th>
                      <th className="py-2 pr-3 text-right">Perdu</th>
                      <th className="py-2 pr-3 text-right">Perte pcs</th>
                      <th className="py-2 pr-3 text-right">Perte €</th>
                      <th className="py-2 pr-3 text-right">Cmd perdues</th>
                      <th className="py-2">Verdict</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map((r) => (
                  <tr key={r.key} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium">
                        {!brand && <Badge variant="outline" className="mr-2">{r.brand}</Badge>}
                        {labelOf(r)}
                      </div>
                      {(level === "product" || level === "color") && (
                        <div className="text-xs text-muted-foreground">
                          {r.reference} · {r.category}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatNumber(r.preQty)}
                      <div className="text-xs text-muted-foreground">{euros(r.preAmount)}</div>
                    </td>
                    {hasFinal && (
                      <>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatNumber(r.finalQty)}
                          <div className="text-xs text-muted-foreground">{euros(r.finalAmount)}</div>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums font-medium">{formatNumber(r.lostQty)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{pctTxt(r.lossRate)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{pctTxt(r.lossRateAmount)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(r.lostOrdersQty)}</td>
                        <td className="py-2">
                          {r.verdict ? (
                            <span className={`rounded px-2 py-0.5 text-xs ${VERDICT_STYLE[r.verdict]}`}>{VERDICT_LABELS[r.verdict]}</span>
                          ) : null}
                        </td>
                      </>
                    )}
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

      {/* Évolution des précommandes */}
      {data?.evolution && data.evolution.seasons.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4" />
              Précommandes par catégorie, saison après saison ({season?.type === "PE" ? "été" : "hiver"})
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto space-y-2">
            <p className="text-sm text-muted-foreground">
              Part de chaque catégorie dans les pièces précommandées de sa marque. Tendance : écart de part entre la première
              et la dernière saison (±2 points).
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Catégorie</th>
                  {data.evolution.seasons.map((s) => (
                    <th key={s} className="py-2 pr-3 text-right">
                      {s}
                    </th>
                  ))}
                  <th className="py-2">Tendance</th>
                </tr>
              </thead>
              <tbody>
                {data.evolution.rows.map((e) => (
                  <tr key={`${e.brand}-${e.category}`} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">
                      {!brand && <Badge variant="outline" className="mr-2">{e.brand}</Badge>}
                      {e.category}
                    </td>
                    {data.evolution!.seasons.map((s) => (
                      <td key={s} className="py-2 pr-3 text-right tabular-nums">
                        {e.bySeason[s] ? pctTxt(e.bySeason[s].share) : "—"}
                        <div className="text-xs text-muted-foreground">{e.bySeason[s] ? `${formatNumber(e.bySeason[s].qty)} pcs` : ""}</div>
                      </td>
                    ))}
                    <td className="py-2">
                      {e.trend === "hausse" ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                          <TrendingUp className="h-4 w-4" /> hausse
                        </span>
                      ) : e.trend === "baisse" ? (
                        <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">
                          <TrendingDown className="h-4 w-4" /> baisse
                        </span>
                      ) : e.trend === "stable" ? (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Minus className="h-4 w-4" /> stable
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  );
}

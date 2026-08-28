"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Download, Loader2, Users, Percent, Ruler, Wallet } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import * as XLSX from "xlsx";
import { SegmentationExport } from "@/components/btoc/segmentation-export";

const euro = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

interface Segmentation {
  overview: {
    clients: number; orders: number; revenue: number; pieces: number;
    ordersPerClient: number; averageBasket: number;
  };
  frequency: { bucket: string; clients: number; orders: number; revenue: number }[];
  promo: {
    windows: { key: string; label: string; orders: number; clients: number; revenue: number }[];
    discounted: { orders: number; clients: number; revenue: number };
    promoOnlyClients: number;
    neverPromoClients: number;
  };
  baskets: { bucket: string; orders: number; revenue: number }[];
  sizes: { size: string; pieces: number; orders: number; clients: number }[];
}

/** Barre de proportion — plus lisible qu'un camembert pour comparer des rangs. */
function Bar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full bg-primary", className)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function BtocSegmentationTab() {
  const [data, setData] = useState<Segmentation | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
      const res = await fetch(`/api/btoc/segmentation?${p}`);
      const d = await res.json();
      if (res.ok) setData(d);
    } catch {
      /* on garde l'affichage précédent */
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  const exportExcel = () => {
    if (!data) return;
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        { Indicateur: "Clients", Valeur: data.overview.clients },
        { Indicateur: "Commandes", Valeur: data.overview.orders },
        { Indicateur: "Commandes par client", Valeur: Math.round(data.overview.ordersPerClient * 100) / 100 },
        { Indicateur: "Panier moyen (€)", Valeur: Math.round(data.overview.averageBasket * 100) / 100 },
        { Indicateur: "CA net (€)", Valeur: data.overview.revenue },
        { Indicateur: "Pièces vendues", Valeur: data.overview.pieces },
        { Indicateur: "Clients n'achetant QUE en promo", Valeur: data.promo.promoOnlyClients },
        { Indicateur: "Clients jamais en promo", Valeur: data.promo.neverPromoClients },
      ]),
      "Vue d'ensemble"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        data.frequency.map((f) => ({
          "Nb d'achats": f.bucket, Clients: f.clients, Commandes: f.orders, "CA (€)": f.revenue,
        }))
      ),
      "Fréquence"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        ...data.promo.windows.map((w) => ({
          Segment: w.label, Commandes: w.orders, Clients: w.clients, "CA (€)": w.revenue,
        })),
        {
          Segment: "Avec remise réelle (code promo ou remise)",
          Commandes: data.promo.discounted.orders,
          Clients: data.promo.discounted.clients,
          "CA (€)": data.promo.discounted.revenue,
        },
      ]),
      "Promotions"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(data.baskets.map((b) => ({ Panier: b.bucket, Commandes: b.orders, "CA (€)": b.revenue }))),
      "Paniers"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        data.sizes.map((s) => ({ Taille: s.size, Pièces: s.pieces, Commandes: s.orders, Clients: s.clients }))
      ),
      "Tailles"
    );
    XLSX.writeFile(wb, `segmentation-btoc-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  if (loading && !data) {
    return <p className="py-16 text-center text-sm text-muted-foreground">Chargement…</p>;
  }
  if (!data) {
    return <p className="py-16 text-center text-sm text-muted-foreground">Aucune donnée.</p>;
  }

  const o = data.overview;
  const maxFreq = Math.max(...data.frequency.map((f) => f.clients), 1);
  const maxBasket = Math.max(...data.baskets.map((b) => b.orders), 1);
  const maxSize = Math.max(...data.sizes.map((s) => s.pieces), 1);
  const loyal = data.frequency.filter((f) => f.bucket !== "1").reduce((s, f) => s + f.clients, 0);
  const once = data.frequency.find((f) => f.bucket === "1")?.clients ?? 0;

  return (
    <div className="space-y-6">
      {/* ── Période ── */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted-foreground">Date début</label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-40" />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted-foreground">Date fin</label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-40" />
          </div>
          {(dateFrom || dateTo) && (
            <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }}>
              Toute la période
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            <Button onClick={exportExcel} className="h-9 gap-2">
              <Download className="h-4 w-4" />
              Exporter Excel
            </Button>
          </div>
        </CardContent>
      </Card>

      <SegmentationExport
        availableSizes={data.sizes.map((s) => s.size)}
        dateFrom={dateFrom}
        dateTo={dateTo}
      />

      {/* ── Vue d'ensemble ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {[
          { l: "Clients", v: formatNumber(o.clients) },
          { l: "Commandes", v: formatNumber(o.orders) },
          { l: "Commandes / client", v: o.ordersPerClient.toFixed(2) },
          { l: "Panier moyen", v: euro(o.averageBasket) },
          { l: "CA net", v: euro(o.revenue) },
          { l: "Pièces vendues", v: formatNumber(o.pieces) },
        ].map((t) => (
          <Card key={t.l}>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{t.v}</div>
              <p className="text-sm text-muted-foreground">{t.l}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Fréquence d'achat ── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
                <Users className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <CardTitle className="text-base">Fréquence d&apos;achat</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Combien de clients ont acheté 1, 2, 3 fois…
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.frequency.map((f) => (
              <div key={f.bucket} className="space-y-1">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">
                    {f.bucket === "5+" ? "5 achats et +" : `${f.bucket} achat${f.bucket === "1" ? "" : "s"}`}
                  </span>
                  <span className="text-muted-foreground">
                    <strong className="text-foreground">{formatNumber(f.clients)}</strong> clients ·{" "}
                    {euro(f.revenue)}
                  </span>
                </div>
                <Bar value={f.clients} max={maxFreq} />
              </div>
            ))}
            <div className="flex items-center justify-between border-t pt-3 text-sm">
              <span className="text-muted-foreground">Clients fidélisés (2 achats et +)</span>
              <span className="font-semibold">
                {formatNumber(loyal)}
                <span className="ml-1 font-normal text-muted-foreground">
                  ({o.clients ? Math.round((loyal / o.clients) * 100) : 0} %)
                </span>
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Clients à achat unique</span>
              <span className="font-semibold">
                {formatNumber(once)}
                <span className="ml-1 font-normal text-muted-foreground">
                  ({o.clients ? Math.round((once / o.clients) * 100) : 0} %)
                </span>
              </span>
            </div>
          </CardContent>
        </Card>

        {/* ── Achats en promotion ── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50">
                <Percent className="h-4 w-4 text-rose-600" />
              </div>
              <div>
                <CardTitle className="text-base">Achats en promotion</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Par période commerciale, et par remise réellement appliquée
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border bg-rose-50/50 p-3">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">Commandes réellement remisées</span>
                <span className="font-semibold">{formatNumber(data.promo.discounted.orders)}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Code promo ou remise appliquée · {formatNumber(data.promo.discounted.clients)} clients ·{" "}
                {euro(data.promo.discounted.revenue)}
              </p>
            </div>
            <p className="text-xs font-medium text-muted-foreground">Par période commerciale</p>
            {data.promo.windows.map((w) => (
              <div key={w.key} className="flex items-baseline justify-between text-sm">
                <span className={cn(w.key === "any" && "font-medium")}>{w.label}</span>
                <span className="text-muted-foreground">
                  <strong className="text-foreground">{formatNumber(w.orders)}</strong> cmd ·{" "}
                  {formatNumber(w.clients)} clients · {euro(w.revenue)}
                </span>
              </div>
            ))}
            <div className="space-y-1.5 border-t pt-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Clients qui n&apos;achètent QUE en promo</span>
                <Badge variant="destructive">{formatNumber(data.promo.promoOnlyClients)}</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Clients jamais en promo</span>
                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                  {formatNumber(data.promo.neverPromoClients)}
                </Badge>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              ⚠️ Une commande passée dans une période commerciale n&apos;est pas forcément
              remisée — et une remise peut tomber hors période. Les deux lectures se lisent
              séparément.
            </p>
          </CardContent>
        </Card>

        {/* ── Paniers ── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50">
                <Wallet className="h-4 w-4 text-amber-600" />
              </div>
              <div>
                <CardTitle className="text-base">Montant des commandes</CardTitle>
                <p className="text-xs text-muted-foreground">Répartition des paniers</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.baskets.map((b) => (
              <div key={b.bucket} className="space-y-1">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">{b.bucket}</span>
                  <span className="text-muted-foreground">
                    <strong className="text-foreground">{formatNumber(b.orders)}</strong> cmd ·{" "}
                    {euro(b.revenue)}
                  </span>
                </div>
                <Bar value={b.orders} max={maxBasket} className="bg-amber-500" />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* ── Tailles ── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-50">
                <Ruler className="h-4 w-4 text-teal-600" />
              </div>
              <div>
                <CardTitle className="text-base">Tailles commandées</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {data.sizes.length} taille(s) — pièces vendues
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {data.sizes.slice(0, 14).map((s) => (
              <div key={s.size} className="space-y-1">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">{s.size}</span>
                  <span className="text-muted-foreground">
                    <strong className="text-foreground">{formatNumber(s.pieces)}</strong> pcs ·{" "}
                    {formatNumber(s.clients)} clients
                  </span>
                </div>
                <Bar value={s.pieces} max={maxSize} className="bg-teal-500" />
              </div>
            ))}
            {data.sizes.length > 14 && (
              <p className="text-xs text-muted-foreground">
                14 premières sur {data.sizes.length} — l&apos;export contient tout.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

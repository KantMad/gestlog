"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Download, Layers, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { formatNumber } from "@/lib/utils";
import { fileStamp } from "@/lib/file-stamp";
import type { FamilyCounts } from "@/lib/collections";

interface Catalog {
  tioCatalogId: number;
  name: string;
  status: string | null;
  deleted: boolean;
  items: number;
  selected: boolean;
  isDefault: boolean;
}

interface Data {
  seasons: string[];
  season: string | null;
  family: "category" | "subCategory";
  catalogs: Catalog[];
  hasFactory?: boolean;
  rows: FamilyCounts[];
  total?: FamilyCounts;
  events?: { kind: string; day: string | null; catalog: string; reference: string | null; label: string | null; color: string | null; family: string }[];
  comparison: (FamilyCounts & { season: string; catalogs: number; hasFactory: boolean })[];
  tracking: { first: string | null; last: string | null };
}

const fr = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const pct = (part: number, total: number) => (total > 0 ? `${(Math.round((part / total) * 1000) / 10).toLocaleString("fr-FR")} %` : "—");

export function CollectionsTracking() {
  const [data, setData] = useState<Data | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [season, setSeason] = useState("");
  const [family, setFamily] = useState<"category" | "subCategory">("category");
  const [catalogs, setCatalogs] = useState<number[] | null>(null);

  const queryKey = (() => {
    const p = new URLSearchParams({ family });
    if (season) p.set("season", season);
    if (catalogs) p.set("catalogs", catalogs.join(","));
    return p.toString();
  })();
  const loading = loadedKey !== queryKey;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/suivi-collections?${queryKey}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d: Data) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => console.error("Erreur chargement suivi collections:", e))
      .finally(() => {
        if (!cancelled) setLoadedKey(queryKey);
      });
    return () => {
      cancelled = true;
    };
  }, [queryKey]);

  const selectedIds = useMemo(() => (data?.catalogs ?? []).filter((c) => c.selected).map((c) => c.tioCatalogId), [data]);
  const toggleCatalog = (id: number) => {
    const cur = new Set(selectedIds);
    if (cur.has(id)) cur.delete(id);
    else cur.add(id);
    setCatalogs([...cur]);
  };

  const hasFactory = !!data?.hasFactory;
  const famLabel = family === "subCategory" ? "Sous-catégorie" : "Catégorie";

  const handleExport = () => {
    if (!data?.season) return;
    const wb = XLSX.utils.book_new();
    const toRow = (r: FamilyCounts) => ({
      [famLabel]: r.family,
      "Produits présentés": r.presentedProducts,
      "Coloris présentés": r.presentedColors,
      "Produits retirés": r.removedProducts,
      "Coloris retirés": r.removedColors,
      "Coloris ajoutés (depuis le suivi)": r.addedColors,
      "Produits gardés": r.keptProducts,
      "Coloris gardés": r.keptColors,
      "Produits commandés clients": r.clientProducts,
      "Coloris commandés clients": r.clientColors,
      "Produits commandés usine": hasFactory ? r.factoryProducts : "",
      "Coloris commandés usine": hasFactory ? r.factoryColors : "",
      "% coloris présentés produits": r.factoryRate ?? "",
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([...data.rows.map(toRow), ...(data.total ? [toRow(data.total)] : [])]), data.season);
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        data.comparison.map((c) => ({
          Saison: c.season,
          Catalogues: c.catalogs,
          "Produits présentés": c.presentedProducts,
          "Coloris présentés": c.presentedColors,
          "Coloris retirés": c.removedColors,
          "Coloris commandés clients": c.clientColors,
          "Coloris commandés usine": c.hasFactory ? c.factoryColors : "",
          "% coloris présentés produits": c.factoryRate ?? "",
        }))
      ),
      "Comparaison saisons"
    );
    if (data.events?.length) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          data.events.map((e) => ({ Date: fr(e.day), Mouvement: e.kind, Catalogue: e.catalog, Référence: e.reference ?? "", Produit: e.label ?? "", Coloris: e.color ?? "", Famille: e.family }))
        ),
        "Ajouts et retraits"
      );
    }
    XLSX.writeFile(wb, `Suivi collection ${data.season} ${fileStamp()}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <Card className="overflow-visible">
        <CardContent className="pt-6 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">Saison</label>
              <Select
                value={data?.season ?? ""}
                onValueChange={(v) => {
                  setSeason(String(v || ""));
                  setCatalogs(null);
                }}
              >
                <SelectTrigger className="w-32 h-9">
                  <span className="text-sm">{data?.season ?? "…"}</span>
                </SelectTrigger>
                <SelectContent>
                  {(data?.seasons ?? []).map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">Famille</label>
              <div className="flex gap-1">
                <Button size="sm" variant={family === "category" ? "default" : "outline"} onClick={() => setFamily("category")}>
                  Catégorie
                </Button>
                <Button size="sm" variant={family === "subCategory" ? "default" : "outline"} onClick={() => setFamily("subCategory")}>
                  Sous-catégorie
                </Button>
              </div>
            </div>
            <Button onClick={handleExport} disabled={loading || !data?.rows.length}>
              <Download className="h-4 w-4 mr-2" />
              Export Excel
            </Button>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          {!!data?.catalogs.length && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">
                Catalogues TIO retenus (par défaut : catalogues de collection, hors stock / offres / propositions)
              </div>
              <div className="flex flex-wrap gap-2">
                {data.catalogs.map((c) => (
                  <Button
                    key={c.tioCatalogId}
                    size="sm"
                    variant={c.selected ? "default" : "outline"}
                    onClick={() => toggleCatalog(c.tioCatalogId)}
                    title={`${formatNumber(c.items)} produits × coloris${c.deleted ? " — catalogue supprimé" : ""}`}
                  >
                    {c.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4" />
            {data?.season ? `${data.season} : présenté, gardé, commandé` : "Synthèse"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 overflow-x-auto">
          <p className="text-sm text-muted-foreground">
            Présenté = produits × coloris mis dans les catalogues retenus (même s&apos;ils ont été retirés ensuite). Retiré =
            enlevé de tous ces catalogues. Commandé clients = au moins une pièce commandée par une boutique. Commandé usine = présent
            dans une commande fournisseur de la saison.
            {data?.tracking.first
              ? ` Ajouts et retraits datés depuis le ${fr(data.tracking.first)} (relevé chaque nuit) ; avant, TIO ne garde pas de date.`
              : " Relevé quotidien pas encore démarré : retraits non datés."}
          </p>
          {data && !hasFactory && data.season && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Aucune commande fournisseur importée pour {data.season} : impossible de dire ce qui a été produit. Importer les commandes
              fournisseurs de la saison (écran Import).
            </p>
          )}
          {!data?.rows.length ? (
            <p className="text-sm text-muted-foreground">{loading ? "Chargement…" : "Aucun catalogue relevé pour cette saison."}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">{famLabel}</th>
                  <th className="py-2 pr-3 text-right">Présentés</th>
                  <th className="py-2 pr-3 text-right">Retirés</th>
                  <th className="py-2 pr-3 text-right">Gardés</th>
                  <th className="py-2 pr-3 text-right">Commandés clients</th>
                  <th className="py-2 pr-3 text-right">Commandés usine</th>
                  <th className="py-2 text-right">Présenté → usine</th>
                </tr>
              </thead>
              <tbody>
                {[...data.rows, ...(data.total ? [data.total] : [])].map((r) => (
                  <tr key={r.family} className={`border-b last:border-0 ${r.family === "Total" ? "font-semibold" : ""}`}>
                    <td className="py-2 pr-3">{r.family}</td>
                    <Cell products={r.presentedProducts} colors={r.presentedColors} />
                    <Cell products={r.removedProducts} colors={r.removedColors} sub={pct(r.removedColors, r.presentedColors)} />
                    <Cell products={r.keptProducts} colors={r.keptColors} />
                    <Cell products={r.clientProducts} colors={r.clientColors} sub={pct(r.clientColors, r.presentedColors)} />
                    {hasFactory ? <Cell products={r.factoryProducts} colors={r.factoryColors} /> : <td className="py-2 pr-3 text-right">—</td>}
                    <td className="py-2 text-right tabular-nums">{r.factoryRate != null ? `${r.factoryRate.toLocaleString("fr-FR")} %` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-muted-foreground">Chaque case : produits / coloris (et % des coloris présentés).</p>
        </CardContent>
      </Card>

      {!!data?.comparison.length && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">D&apos;une saison à l&apos;autre (catalogues de collection)</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Saison</th>
                  <th className="py-2 pr-3 text-right">Catalogues</th>
                  <th className="py-2 pr-3 text-right">Présentés</th>
                  <th className="py-2 pr-3 text-right">Retirés</th>
                  <th className="py-2 pr-3 text-right">Commandés clients</th>
                  <th className="py-2 pr-3 text-right">Commandés usine</th>
                  <th className="py-2 text-right">Présenté → usine</th>
                </tr>
              </thead>
              <tbody>
                {data.comparison.map((c) => (
                  <tr key={c.season} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{c.season}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.catalogs}</td>
                    <Cell products={c.presentedProducts} colors={c.presentedColors} />
                    <Cell products={c.removedProducts} colors={c.removedColors} sub={pct(c.removedColors, c.presentedColors)} />
                    <Cell products={c.clientProducts} colors={c.clientColors} sub={pct(c.clientColors, c.presentedColors)} />
                    {c.hasFactory ? <Cell products={c.factoryProducts} colors={c.factoryColors} /> : <td className="py-2 pr-3 text-right">—</td>}
                    <td className="py-2 text-right tabular-nums">{c.factoryRate != null ? `${c.factoryRate.toLocaleString("fr-FR")} %` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {!!data?.events?.length && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ajouts et retraits datés</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Mouvement</th>
                  <th className="py-2 pr-3">Produit</th>
                  <th className="py-2 pr-3">Coloris</th>
                  <th className="py-2">Catalogue</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((e, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 pr-3 tabular-nums">{fr(e.day)}</td>
                    <td className="py-2 pr-3">{e.kind}</td>
                    <td className="py-2 pr-3">
                      {e.label ?? e.reference}
                      <div className="text-xs text-muted-foreground">
                        {e.reference} · {e.family}
                      </div>
                    </td>
                    <td className="py-2 pr-3">{e.color ?? "—"}</td>
                    <td className="py-2">{e.catalog}</td>
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

function Cell({ products, colors, sub }: { products: number; colors: number; sub?: string }) {
  return (
    <td className="py-2 pr-3 text-right tabular-nums">
      {formatNumber(products)} / {formatNumber(colors)}
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </td>
  );
}

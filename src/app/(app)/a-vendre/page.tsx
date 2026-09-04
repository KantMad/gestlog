"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tags, Download, Loader2, Search, RefreshCw } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import { sortSizeScale } from "@/lib/size-order";
import { computeTotals, discounted, colorText, type AVendreRow } from "@/lib/a-vendre";
import * as XLSX from "xlsx";
import { fileStamp } from "@/lib/file-stamp";

const euro = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

/** Petit sélecteur multiple à cases — même esprit que le périmètre de validation. */
function MultiPicker({
  label, options, selected, onToggle,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <span className="block text-xs font-medium text-muted-foreground">
        {label} {selected.length > 0 && <Badge variant="secondary" className="ml-1">{selected.length}</Badge>}
      </span>
      <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-lg border bg-muted/30 p-2">
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => onToggle(o)}
              className={cn(
                "rounded-md border px-2 py-1 text-xs transition-colors",
                on ? "border-primary bg-primary/10 font-medium text-primary" : "bg-background hover:bg-accent"
              )}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function AVendrePage() {
  // Les saisons proposées ici ne viennent PAS du sélecteur global : cet écran ne connaît
  // que des collections PE/AH, reconstituées produit par produit (cf. lib/a-vendre-season).
  // Réassort et Hors-saison n'y ont pas leur place — un stock à écouler appartient
  // toujours à une collection.
  const [seasonNames, setSeasonNames] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [subCategories, setSubCategories] = useState<string[]>([]);
  const [minQty, setMinQty] = useState("10");
  // Trous de tailles : non = gammes continues seulement, oui = tout le stock.
  const [allowGaps, setAllowGaps] = useState(false);
  const [discount, setDiscount] = useState("0");
  const [search, setSearch] = useState("");

  const [rows, setRows] = useState<AVendreRow[]>([]);
  const [facets, setFacets] = useState<{
    categories: string[]; subCategories: string[]; seasons: string[];
  }>({ categories: [], subCategories: [], seasons: [] });
  const [withoutSeason, setWithoutSeason] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (seasonNames.length) p.set("seasons", seasonNames.join(","));
      if (categories.length) p.set("categories", categories.join(","));
      if (subCategories.length) p.set("subCategories", subCategories.join(","));
      if (minQty.trim()) p.set("minQty", minQty.trim());
      p.set("maxGaps", allowGaps ? "-1" : "0");
      const res = await fetch(`/api/a-vendre?${p}`);
      const data = await res.json();
      if (res.ok) {
        setRows(data.rows || []);
        setFacets(data.facets || { categories: [], subCategories: [], seasons: [] });
        setWithoutSeason(data.meta?.withoutSeason ?? 0);
      }
    } catch {
      /* silencieux : l'écran reste utilisable, on peut relancer */
    } finally {
      setLoading(false);
    }
  }, [seasonNames, categories, subCategories, minQty, allowGaps]);

  useEffect(() => {
    load();
  }, [load]);

  const pct = Math.max(0, Math.min(100, parseFloat(discount.replace(",", ".")) || 0));

  // Recherche libre (référence, couleur, désignation) appliquée côté écran.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.reference, r.color, r.colorLabel, r.label, r.category, r.subCategory]
        .some((v) => v && String(v).toLowerCase().includes(q))
    );
  }, [rows, search]);

  // Colonnes de tailles = union des grilles affichées, dans l'ordre d'habillage.
  const sizeCols = useMemo(
    () => sortSizeScale(visible.flatMap((r) => r.sizeScale)),
    [visible]
  );

  const totals = useMemo(() => computeTotals(visible, pct), [visible, pct]);

  const toggle = (list: string[], set: (v: string[]) => void) => (v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const exportExcel = () => {
    if (visible.length === 0) return;
    const header = [
      "Référence", "Collection", "Couleur", "Désignation", "Catégorie", "Sous-catégorie",
      ...sizeCols, "Total dispo", "Trous",
      "Prix de gros", pct > 0 ? `Prix de gros remisé (-${pct}%)` : "Prix de gros remisé",
      "Montant", "Prix public", "Valeur au prix public",
    ];
    const remiseCol = header[header.length - 4];
    const data = visible.map((r) => {
      const wholesale = discounted(r.costPrice, pct);
      const row: Record<string, string | number> = {
        "Référence": r.reference,
        // Une saison DÉDUITE (référence sœur ou préfixe) est signalée : sans ça, une
        // hypothèse se lirait comme un fait dans le fichier.
        "Collection":
          r.season
            ? r.seasonOrigin === "commande"
              ? r.season
              : `${r.season} (déduit)`
            : "Indéterminée",
        "Couleur": colorText(r.color, r.colorLabel),
        "Désignation": r.label || "",
        "Catégorie": r.category || "",
        "Sous-catégorie": r.subCategory || "",
      };
      for (const s of sizeCols) row[s] = r.stock[s] ?? "";
      row["Total dispo"] = r.total;
      row["Trous"] = r.gaps;
      row["Prix de gros"] = r.costPrice ?? "";
      row[remiseCol] = wholesale ?? "";
      row["Montant"] = wholesale != null ? Math.round(wholesale * r.total * 100) / 100 : "";
      row["Prix public"] = r.salePrice ?? "";
      row["Valeur au prix public"] =
        r.salePrice != null ? Math.round(r.salePrice * r.total * 100) / 100 : "";
      return row;
    });
    // Ligne de totaux, pour retrouver les chiffres de l'écran dans le fichier.
    const totalRow: Record<string, string | number> = { "Référence": "TOTAL" };
    for (const s of sizeCols) totalRow[s] = visible.reduce((a, r) => a + (r.stock[s] || 0), 0);
    totalRow["Total dispo"] = totals.pieces;
    totalRow["Montant"] = totals.wholesaleValue;
    totalRow["Valeur au prix public"] = totals.retailValue;
    data.push(totalRow);

    const ws = XLSX.utils.json_to_sheet(data, { header });
    ws["!cols"] = header.map((h) => ({ wch: Math.min(34, Math.max(h.length + 2, 10)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "À vendre");
    const stamp = fileStamp();
    XLSX.writeFile(wb, `A vendre ${stamp}.xlsx`);
  };

  return (
    <div>
      <Topbar title="À vendre" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="À vendre"
          description="Le stock entrepôt à écouler en priorité — gammes complètes d'abord, avec simulation de remise"
          action={
            visible.length > 0 ? (
              <Button onClick={exportExcel} className="gap-2">
                <Download className="h-4 w-4" />
                Exporter Excel
              </Button>
            ) : undefined
          }
        />

        {/* ── Critères ── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50">
                <Tags className="h-5 w-5 text-teal-600" />
              </div>
              <div>
                <CardTitle className="text-base">Critères</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Le stock vient de l&apos;entrepôt (synchro TIO). Une gamme sans trou se vend
                  mieux qu&apos;une gamme dépareillée.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-muted-foreground">
                  Trous de tailles autorisés
                </span>
                <div className="inline-flex rounded-lg border bg-muted/50 p-0.5 text-sm">
                  {([[false, "Non"], [true, "Oui"]] as [boolean, string][]).map(([val, lbl]) => (
                    <button
                      key={lbl}
                      type="button"
                      onClick={() => setAllowGaps(val)}
                      className={cn(
                        "rounded-md px-4 py-1.5 font-medium transition-colors",
                        allowGaps === val
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {allowGaps
                    ? "Tout le stock, gammes dépareillées comprises."
                    : "Gammes continues seulement (les tailles absentes en bout de gamme ne comptent pas)."}
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">
                  Quantité min. à la couleur
                </label>
                <Input
                  type="number" min={0} value={minQty}
                  onChange={(e) => setMinQty(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">
                  Remise simulée (%)
                </label>
                <Input
                  type="number" min={0} max={100} value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  className="h-9"
                />
                <p className="text-[11px] text-muted-foreground">
                  Appliquée au <strong>prix de gros</strong> (facturé aux boutiques). Le prix
                  public reste au plein tarif.
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">Recherche</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Référence, couleur…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-9 pl-9"
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              <MultiPicker
                label="Collections"
                options={facets.seasons}
                selected={seasonNames}
                onToggle={toggle(seasonNames, setSeasonNames)}
              />
              <MultiPicker
                label="Catégories"
                options={facets.categories}
                selected={categories}
                onToggle={toggle(categories, setCategories)}
              />
              <MultiPicker
                label="Sous-catégories"
                options={facets.subCategories}
                selected={subCategories}
                onToggle={toggle(subCategories, setSubCategories)}
              />
            </div>

            {/* Les produits qu'aucune règle ne rattache sont ANNONCÉS plutôt que rangés
                d'office dans une collection au hasard. */}
            {withoutSeason > 0 && (
              <p className="text-xs text-muted-foreground">
                <strong>{withoutSeason}</strong> produit(s) sans collection identifiable
                (collections antérieures à PE23) — ils apparaissent avec «&nbsp;—&nbsp;» et
                ne ressortent sur aucun filtre de collection.
              </p>
            )}

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Actualiser
              </Button>
              {(seasonNames.length > 0 || categories.length > 0 || subCategories.length > 0) && (
                <Button
                  variant="ghost" size="sm"
                  onClick={() => { setSeasonNames([]); setCategories([]); setSubCategories([]); }}
                >
                  Effacer les filtres
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Totaux ── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent>
              <div className="text-2xl font-bold">{formatNumber(totals.products)}</div>
              <p className="text-sm text-muted-foreground">Produits-couleurs</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="text-2xl font-bold">{formatNumber(totals.pieces)}</div>
              <p className="text-sm text-muted-foreground">Pièces disponibles</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600">{euro(totals.wholesaleValue)}</div>
              <p className="text-sm text-muted-foreground">
                Montant {pct > 0 ? `remise ${pct} % déduite` : "au prix de gros"}
              </p>
              {totals.piecesWithoutPrice > 0 && (
                <p className="mt-1 text-[11px] text-amber-600">
                  {formatNumber(totals.piecesWithoutPrice)} pièce(s) sans prix de gros — non valorisées
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="text-2xl font-bold">{euro(totals.retailValue)}</div>
              <p className="text-sm text-muted-foreground">Valeur au prix public (non remisée)</p>
            </CardContent>
          </Card>
        </div>

        {/* ── Liste ── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">
                {loading ? "Chargement…" : `${formatNumber(visible.length)} produit(s)-couleur`}
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                Triés par quantité décroissante — le plus gros stock à écouler en premier
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {visible.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {loading ? "Recherche en cours…" : "Aucun produit ne correspond à ces critères."}
              </p>
            ) : (
              <ScrollArea>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">Référence</TableHead>
                      <TableHead className="whitespace-nowrap">Collection</TableHead>
                      <TableHead className="whitespace-nowrap">Couleur</TableHead>
                      {sizeCols.map((s) => (
                        <TableHead key={s} className="text-right whitespace-nowrap">{s}</TableHead>
                      ))}
                      <TableHead className="text-right">Dispo</TableHead>
                      <TableHead className="text-right">Trous</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Prix gros</TableHead>
                      {pct > 0 && (
                        <TableHead className="text-right whitespace-nowrap">−{pct} %</TableHead>
                      )}
                      <TableHead className="text-right whitespace-nowrap">Montant</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Prix public</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.slice(0, 300).map((r) => {
                      const wholesale = discounted(r.costPrice, pct);
                      return (
                        <TableRow key={r.productId}>
                          <TableCell className="whitespace-nowrap font-mono text-sm">
                            {r.reference}
                            {r.label && (
                              <span className="block text-[11px] font-sans text-muted-foreground">
                                {r.label}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            {r.season ? (
                              <span
                                className={cn(
                                  "rounded px-1.5 py-0.5 text-xs font-medium",
                                  r.seasonOrigin === "commande"
                                    ? "bg-muted text-foreground"
                                    : "bg-amber-50 text-amber-800"
                                )}
                                title={
                                  r.seasonOrigin === "commande"
                                    ? "Collection constatée sur les commandes clients"
                                    : r.seasonOrigin === "reference-soeur"
                                      ? "Déduite d'un autre coloris de la même référence"
                                      : "Déduite de la lettre de la référence"
                                }
                              >
                                {r.season}
                                {r.seasonOrigin !== "commande" && " ?"}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            {colorText(r.color, r.colorLabel)}
                          </TableCell>
                          {sizeCols.map((s) => {
                            const q = r.stock[s];
                            const inScale = r.sizeScale.includes(s);
                            return (
                              <TableCell
                                key={s}
                                className={cn(
                                  "text-right tabular-nums",
                                  !inScale && "bg-muted/30",
                                  inScale && !q && "text-red-500"
                                )}
                              >
                                {!inScale ? (
                                  <span className="text-muted-foreground/30">·</span>
                                ) : q ? (
                                  q
                                ) : (
                                  "0"
                                )}
                              </TableCell>
                            );
                          })}
                          <TableCell className="text-right font-semibold tabular-nums">{r.total}</TableCell>
                          <TableCell className="text-right">
                            {r.gaps === 0 ? (
                              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">0</Badge>
                            ) : (
                              <Badge variant="outline" className="text-amber-700">{r.gaps}</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.costPrice != null ? euro(r.costPrice) : <span className="text-amber-600">—</span>}
                          </TableCell>
                          {pct > 0 && (
                            <TableCell className="text-right tabular-nums text-emerald-700">
                              {wholesale != null ? euro(wholesale) : "—"}
                            </TableCell>
                          )}
                          <TableCell className="text-right font-medium tabular-nums">
                            {wholesale != null ? euro(wholesale * r.total) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {r.salePrice != null ? euro(r.salePrice) : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
            {visible.length > 300 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Aperçu des 300 premières lignes sur {formatNumber(visible.length)} — l&apos;export Excel
                contient tout.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

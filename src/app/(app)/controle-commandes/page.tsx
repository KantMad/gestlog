"use client";

import { useEffect, useState, useCallback } from "react";
import { useSeason, formatSeasonLabel } from "@/lib/season-context";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Download, ScanSearch, Info, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

interface Row {
  orderNumber: string;
  clientCode: string;
  clientName: string;
  reference: string;
  color: string;
  colorLabel: string | null;
  productLabel: string | null;
  sizeScale: string;
  sizeCount: number;
  size: string;
  quantity: number;
}
interface Summary {
  lines: number;
  orders: number;
  clients: number;
  pieces: number;
}

export default function ControleCommandesPage() {
  const { activeSeason } = useSeason();
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [source, setSource] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    if (!activeSeason) {
      setRows([]);
      setSummary(null);
      return;
    }
    setLoading(true);
    fetch(`/api/controle-commandes?seasonId=${activeSeason.id}`)
      .then((r) => r.json())
      .then((d) => {
        setRows(d.data || []);
        setSummary(d.summary || null);
        setSource(d.source || "");
      })
      .catch(() => toast.error("Chargement impossible"))
      .finally(() => setLoading(false));
  }, [activeSeason]);

  useEffect(() => {
    load();
  }, [load]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? rows.filter(
        (r) =>
          r.clientName.toLowerCase().includes(q) ||
          r.clientCode.toLowerCase().includes(q) ||
          r.orderNumber.toLowerCase().includes(q) ||
          r.reference.toLowerCase().includes(q)
      )
    : rows;

  const exportExcel = () => {
    if (filtered.length === 0) {
      toast.error("Rien à exporter");
      return;
    }
    const data = filtered.map((r) => ({
      "N° commande": r.orderNumber,
      "Code boutique": r.clientCode,
      Boutique: r.clientName,
      Référence: r.reference,
      Produit: r.productLabel || "",
      Couleur: r.color,
      "Libellé couleur": r.colorLabel || "",
      "Taille commandée": r.size,
      Quantité: r.quantity,
      "Tailles au catalogue": r.sizeScale,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sélections");
    XLSX.writeFile(wb, `selections_${activeSeason?.name || ""}.xlsx`);
    toast.success(`${data.length} ligne(s) exportée(s)`);
  };

  return (
    <div>
      <Topbar title="Contrôle commandes" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="Contrôle commandes — sélections"
          description="Repère les lignes où le client n'a commandé qu'une seule taille pour un produit/couleur, afin de les supprimer dans TIO."
          action={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Rafraîchir
              </Button>
              {filtered.length > 0 && (
                <Button variant="outline" size="sm" onClick={exportExcel} className="gap-2">
                  <Download className="h-4 w-4" />
                  Exporter Excel
                </Button>
              )}
            </div>
          }
        />

        <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
          <span>
            Une « <strong>sélection</strong> » = une seule taille commandée alors que le produit en
            propose plusieurs. Les produits en <strong>taille unique</strong> (ex. TU) sont exclus,
            c&apos;est normal pour eux. Données lues sur la source{" "}
            <strong>{source || "—"}</strong> de la saison.
            <br />
            ⚠️ En saison <strong>Réassort</strong>, commander une seule taille est{" "}
            <strong>normal</strong> (réassort à l&apos;unité) — ce contrôle vise les commandes de
            collection.
          </span>
        </div>

        {!activeSeason ? (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              Sélectionne une saison pour lancer le contrôle.
            </CardContent>
          </Card>
        ) : loading ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground animate-pulse">
              Analyse des commandes…
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-4">
              <Card>
                <CardContent className="pt-6">
                  <div className={summary?.lines ? "text-2xl font-bold text-amber-600" : "text-2xl font-bold text-emerald-600"}>
                    {summary?.lines ?? 0}
                  </div>
                  <p className="text-sm text-muted-foreground">Lignes concernées</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold">{summary?.orders ?? 0}</div>
                  <p className="text-sm text-muted-foreground">Commandes</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold">{summary?.clients ?? 0}</div>
                  <p className="text-sm text-muted-foreground">Boutiques</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold">{summary?.pieces ?? 0}</div>
                  <p className="text-sm text-muted-foreground">Pièces</p>
                </CardContent>
              </Card>
            </div>

            {rows.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center gap-2 py-16">
                  <ScanSearch className="h-10 w-10 text-emerald-500/50" />
                  <p className="text-sm font-medium">Aucune sélection détectée 🎉</p>
                  <p className="text-xs text-muted-foreground">
                    Toutes les lignes de {formatSeasonLabel(activeSeason)} ont au moins 2 tailles
                    commandées (ou sont en taille unique).
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="relative max-w-sm">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filtrer (boutique, n° commande, référence)…"
                    className="h-9 pl-9 text-sm"
                  />
                </div>

                <Card>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                          <tr>
                            <th className="px-4 py-2.5 font-medium">Boutique</th>
                            <th className="px-4 py-2.5 font-medium">N° commande</th>
                            <th className="px-4 py-2.5 font-medium">Référence</th>
                            <th className="px-4 py-2.5 font-medium">Couleur</th>
                            <th className="px-4 py-2.5 font-medium">Taille</th>
                            <th className="px-4 py-2.5 text-right font-medium">Qté</th>
                            <th className="px-4 py-2.5 font-medium">Tailles au catalogue</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {filtered.map((r, i) => (
                            <tr key={`${r.orderNumber}-${r.reference}-${r.color}-${i}`} className="hover:bg-muted/20">
                              <td className="px-4 py-2.5">
                                {r.clientName}{" "}
                                <span className="text-xs text-muted-foreground">({r.clientCode})</span>
                              </td>
                              <td className="px-4 py-2.5 font-medium">{r.orderNumber}</td>
                              <td className="px-4 py-2.5">
                                <span className="font-mono text-xs">{r.reference}</span>
                                {r.productLabel && (
                                  <span className="ml-2 text-xs text-muted-foreground">{r.productLabel}</span>
                                )}
                              </td>
                              <td className="px-4 py-2.5">
                                {r.color}
                                {r.colorLabel && (
                                  <span className="ml-1 text-xs text-muted-foreground">({r.colorLabel})</span>
                                )}
                              </td>
                              <td className="px-4 py-2.5">
                                <Badge variant="outline" className="border-amber-300 text-amber-700">
                                  {r.size}
                                </Badge>
                              </td>
                              <td className="px-4 py-2.5 text-right font-medium tabular-nums">{r.quantity}</td>
                              <td className="px-4 py-2.5 text-xs text-muted-foreground">
                                {r.sizeScale} <span className="opacity-60">({r.sizeCount})</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {filtered.length === 0 && (
                      <p className="py-10 text-center text-sm text-muted-foreground">
                        Aucun résultat pour ce filtre.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useSeason } from "@/lib/season-context";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  GitCompareArrows,
  Check,
  AlertTriangle,
  XCircle,
  Download,
  ChevronDown,
  ChevronRight,
  Pencil,
  Search,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { ComparisonSummary } from "@/lib/comparison/engine";
import * as XLSX from "xlsx";

function StatusBadge({ status }: { status: string }) {
  if (status === "conforme")
    return (
      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
        <Check className="h-3 w-3 mr-1" />
        Conforme
      </Badge>
    );
  if (status === "ecart_mineur")
    return (
      <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">
        <AlertTriangle className="h-3 w-3 mr-1" />
        Écart mineur
      </Badge>
    );
  return (
    <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
      <XCircle className="h-3 w-3 mr-1" />
      Écart majeur
    </Badge>
  );
}

const fmtRecDate = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });

function SupplierSection({ summary }: { summary: ComparisonSummary }) {
  const [expanded, setExpanded] = useState(summary.anomalyCount > 0);

  const receptions = summary.receptions;
  // On ne « déplie » les colonnes par réception que s'il y en a au moins deux : avec une seule
  // réception, la colonne « Reçu » EST déjà son total → inutile de la dupliquer.
  const showRecCols = receptions.length >= 2;

  // Totaux affichés (recalculés sur les lignes réellement visibles, cf. filtre réception).
  const footOrdered = summary.rows.reduce((s, r) => s + r.totalOrdered, 0);
  const footReceived = summary.rows.reduce((s, r) => s + r.totalReceived, 0);
  const footGap = footOrdered - footReceived;
  const footByReception = (id: string) =>
    summary.rows.reduce((s, r) => s + (r.receivedByReception[id] || 0), 0);

  return (
    <Card>
      <CardHeader
        className="cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <div>
              <CardTitle className="text-base">
                {summary.supplierName}
                <span className="text-muted-foreground font-normal ml-2 text-sm">
                  ({summary.supplierCode})
                </span>
              </CardTitle>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right text-sm">
              <span className="text-muted-foreground">Conformité : </span>
              <span
                className={cn(
                  "font-semibold",
                  summary.conformityRate >= 95
                    ? "text-emerald-600"
                    : summary.conformityRate >= 80
                      ? "text-amber-600"
                      : "text-red-600"
                )}
              >
                {summary.conformityRate}%
              </span>
            </div>
            <Badge variant="outline">
              {summary.lineCount} ref.
            </Badge>
            {summary.anomalyCount > 0 && (
              <Badge variant="destructive">
                {summary.anomalyCount} anomalie{summary.anomalyCount > 1 ? "s" : ""}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-3">
          {/* Légende des réceptions : chaque réception avec sa date et SON total de pièces. */}
          {receptions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {receptions.length} réception{receptions.length > 1 ? "s" : ""} :
              </span>
              {receptions.map((rec, i) => (
                <Badge
                  key={rec.id}
                  variant="outline"
                  className="gap-1 font-normal"
                  title={`Réception ${rec.receptionNumber} — commande ${rec.orderNumber}`}
                >
                  <span className="font-semibold">R{i + 1}</span>
                  <span className="text-muted-foreground">· {fmtRecDate(rec.receptionDate)} ·</span>
                  <span className="font-semibold">{rec.totalReceived}</span>
                  <span className="text-muted-foreground">pcs</span>
                </Badge>
              ))}
            </div>
          )}
          <ScrollArea>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Référence</TableHead>
                  <TableHead>Couleur</TableHead>
                  <TableHead className="text-right">Commandé</TableHead>
                  {showRecCols &&
                    receptions.map((rec, i) => (
                      <TableHead
                        key={rec.id}
                        className="text-right whitespace-nowrap"
                        title={`Réception ${rec.receptionNumber} — commande ${rec.orderNumber}`}
                      >
                        R{i + 1}
                        <span className="block text-[10px] font-normal text-muted-foreground">
                          {fmtRecDate(rec.receptionDate)}
                        </span>
                      </TableHead>
                    ))}
                  <TableHead className="text-right">Reçu</TableHead>
                  <TableHead className="text-right">Écart</TableHead>
                  <TableHead className="text-right">%</TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.rows.map((row) => (
                  <TableRow
                    key={row.productId}
                    className={cn(
                      row.status === "ecart_majeur" && "bg-red-50/50",
                      row.status === "ecart_mineur" && "bg-amber-50/50"
                    )}
                  >
                    <TableCell className="font-mono text-sm">
                      {row.reference}
                    </TableCell>
                    <TableCell>{row.color}</TableCell>
                    <TableCell className="text-right font-medium">
                      {row.totalOrdered}
                    </TableCell>
                    {showRecCols &&
                      receptions.map((rec) => {
                        const q = row.receivedByReception[rec.id] || 0;
                        return (
                          <TableCell
                            key={rec.id}
                            className={cn(
                              "text-right tabular-nums",
                              q === 0 && "text-muted-foreground/40"
                            )}
                          >
                            {q === 0 ? "—" : q}
                          </TableCell>
                        );
                      })}
                    <TableCell className="text-right font-medium">
                      {row.totalReceived}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-medium",
                        row.totalGap > 0
                          ? "text-red-600"
                          : row.totalGap < 0
                            ? "text-blue-600"
                            : ""
                      )}
                    >
                      {row.totalGap > 0
                        ? `-${row.totalGap}`
                        : row.totalGap < 0
                          ? `+${Math.abs(row.totalGap)}`
                          : "0"}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {row.gapPercent}%
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                  </TableRow>
                ))}
                {/* Ligne de totaux : total commandé, total de CHAQUE réception, total reçu, écart. */}
                <TableRow className="border-t-2 font-semibold hover:bg-transparent">
                  <TableCell colSpan={2}>Total</TableCell>
                  <TableCell className="text-right">{footOrdered}</TableCell>
                  {showRecCols &&
                    receptions.map((rec) => (
                      <TableCell key={rec.id} className="text-right tabular-nums">
                        {footByReception(rec.id)}
                      </TableCell>
                    ))}
                  <TableCell className="text-right">{footReceived}</TableCell>
                  <TableCell
                    className={cn(
                      "text-right",
                      footGap > 0 ? "text-red-600" : footGap < 0 ? "text-blue-600" : ""
                    )}
                  >
                    {footGap > 0 ? `-${footGap}` : footGap < 0 ? `+${Math.abs(footGap)}` : "0"}
                  </TableCell>
                  <TableCell />
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      )}
    </Card>
  );
}

type ReceptionFilter = "all" | "received" | "not_received";

export default function ComparisonPage() {
  const { activeSeason } = useSeason();
  const [summaries, setSummaries] = useState<ComparisonSummary[]>([]);
  const [loading, setLoading] = useState(false);
  // Recherche fournisseur + filtre réception (tout / réceptionné / non réceptionné).
  const [supplierSearch, setSupplierSearch] = useState("");
  const [receptionFilter, setReceptionFilter] = useState<ReceptionFilter>("all");

  useEffect(() => {
    if (!activeSeason) {
      setSummaries([]);
      return;
    }
    setLoading(true);
    fetch(`/api/comparison?seasonId=${activeSeason.id}`)
      .then((res) => res.json())
      .then((data) => setSummaries(data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeSeason]);

  // Filtrage : recherche par nom/code fournisseur + filtre réception au niveau des lignes.
  // Les compteurs (réf./anomalies) sont recalculés sur les lignes réellement affichées.
  const q = supplierSearch.trim().toLowerCase();
  const filteredSummaries = summaries
    .filter(
      (s) =>
        !q ||
        s.supplierName.toLowerCase().includes(q) ||
        s.supplierCode.toLowerCase().includes(q)
    )
    .map((s) => {
      const rows =
        receptionFilter === "all"
          ? s.rows
          : s.rows.filter((r) =>
              receptionFilter === "received" ? r.totalReceived > 0 : r.totalReceived === 0
            );
      return {
        ...s,
        rows,
        lineCount: rows.length,
        anomalyCount: rows.filter((r) => r.status !== "conforme").length,
      };
    })
    .filter((s) => s.rows.length > 0);

  const totalAnomaly = filteredSummaries.reduce((s, a) => s + a.anomalyCount, 0);

  const exportToExcel = () => {
    const rows = summaries.flatMap((s) =>
      s.rows.map((r) => ({
        Fournisseur: s.supplierName,
        Référence: r.reference,
        Couleur: r.color,
        Commandé: r.totalOrdered,
        // Détail par réception : « R1 12/07: 30 | R2 20/07: 12 » (réceptions ayant livré ce produit).
        Réceptions: s.receptions
          .map((rec, i) =>
            (r.receivedByReception[rec.id] || 0) > 0
              ? `R${i + 1} ${fmtRecDate(rec.receptionDate)}: ${r.receivedByReception[rec.id]}`
              : null
          )
          .filter(Boolean)
          .join(" | "),
        Reçu: r.totalReceived,
        Écart: r.totalGap,
        "Écart %": r.gapPercent,
        Statut: r.status === "conforme" ? "Conforme" : r.status === "ecart_mineur" ? "Écart mineur" : "Écart majeur",
      }))
    );
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Comparaison");
    XLSX.writeFile(wb, `comparaison_${activeSeason?.name || ""}.xlsx`);
  };

  return (
    <div>
      <Topbar title="Comparaison" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="Comparaison commande / réception"
          description="Analysez les écarts entre commandes fournisseurs et réceptions réelles"
          action={
            <div className="flex items-center gap-2">
              <Link href="/import/receptions">
                <Button variant="outline" size="sm" className="gap-2">
                  <Pencil className="h-4 w-4" />
                  Corriger une réception
                </Button>
              </Link>
              {summaries.length > 0 && (
                <Button variant="outline" size="sm" onClick={exportToExcel} className="gap-2">
                  <Download className="h-4 w-4" />
                  Exporter Excel
                </Button>
              )}
            </div>
          }
        />

        {!activeSeason ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <p className="text-sm text-muted-foreground">
                Sélectionnez une saison pour voir les comparaisons
              </p>
            </CardContent>
          </Card>
        ) : loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground animate-pulse">
              Calcul des comparaisons...
            </p>
          </div>
        ) : summaries.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <GitCompareArrows className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-sm text-muted-foreground text-center">
                Aucune commande fournisseur à comparer.
                <br />
                Importez des commandes fournisseurs et des réceptions pour voir les écarts.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold">{filteredSummaries.length}</div>
                  <p className="text-sm text-muted-foreground">Fournisseurs</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold">
                    {filteredSummaries.reduce((s, a) => s + a.lineCount, 0)}
                  </div>
                  <p className="text-sm text-muted-foreground">Références</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className={cn("text-2xl font-bold", totalAnomaly > 0 ? "text-red-600" : "text-emerald-600")}>
                    {totalAnomaly}
                  </div>
                  <p className="text-sm text-muted-foreground">Anomalies</p>
                </CardContent>
              </Card>
            </div>

            {/* Recherche fournisseur + filtre réception (tout / réceptionné / non). */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative w-full sm:max-w-xs">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Rechercher un fournisseur…"
                  value={supplierSearch}
                  onChange={(e) => setSupplierSearch(e.target.value)}
                  className="h-9 pl-9 text-sm"
                />
              </div>
              <div className="inline-flex rounded-lg border bg-muted/50 p-0.5 text-sm">
                {(
                  [
                    ["all", "Tout"],
                    ["received", "Réceptionné"],
                    ["not_received", "Non réceptionné"],
                  ] as [ReceptionFilter, string][]
                ).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setReceptionFilter(val)}
                    className={cn(
                      "rounded-md px-3 py-1.5 font-medium transition-colors",
                      receptionFilter === val
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              {filteredSummaries.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="flex items-center justify-center py-12">
                    <p className="text-sm text-muted-foreground">
                      Aucun résultat pour ce filtre.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                filteredSummaries.map((summary) => (
                  <SupplierSection key={summary.supplierId} summary={summary} />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

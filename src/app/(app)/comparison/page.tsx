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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  GitCompareArrows,
  Check,
  AlertTriangle,
  XCircle,
  Download,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
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

function SupplierSection({ summary }: { summary: ComparisonSummary }) {
  const [expanded, setExpanded] = useState(summary.anomalyCount > 0);

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
        <CardContent>
          <ScrollArea>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Référence</TableHead>
                  <TableHead>Couleur</TableHead>
                  <TableHead className="text-right">Commandé</TableHead>
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
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      )}
    </Card>
  );
}

export default function ComparisonPage() {
  const { activeSeason } = useSeason();
  const [summaries, setSummaries] = useState<ComparisonSummary[]>([]);
  const [loading, setLoading] = useState(false);

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

  const totalAnomaly = summaries.reduce((s, a) => s + a.anomalyCount, 0);

  const exportToExcel = () => {
    const rows = summaries.flatMap((s) =>
      s.rows.map((r) => ({
        Fournisseur: s.supplierName,
        Référence: r.reference,
        Couleur: r.color,
        Commandé: r.totalOrdered,
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
            summaries.length > 0 ? (
              <Button variant="outline" size="sm" onClick={exportToExcel} className="gap-2">
                <Download className="h-4 w-4" />
                Exporter Excel
              </Button>
            ) : undefined
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
                  <div className="text-2xl font-bold">{summaries.length}</div>
                  <p className="text-sm text-muted-foreground">Fournisseurs</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold">
                    {summaries.reduce((s, a) => s + a.lineCount, 0)}
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

            <div className="space-y-4">
              {summaries.map((summary) => (
                <SupplierSection key={summary.supplierId} summary={summary} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

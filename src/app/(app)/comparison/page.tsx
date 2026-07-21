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
import type { ComparisonSummary, ComparisonRow } from "@/lib/comparison/engine";
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

// Écart / statut d'une ligne DANS un bloc réception (commandé vs reçu de cette réception).
function deriveGap(ordered: number, received: number) {
  const gap = ordered - received;
  const gapPercent = ordered > 0 ? Math.round((Math.abs(gap) / ordered) * 100) : 0;
  const status: ComparisonRow["status"] =
    gap === 0 ? "conforme" : gapPercent <= 10 ? "ecart_mineur" : "ecart_majeur";
  return { gap, gapPercent, status };
}

type BlockRow = {
  row: ComparisonRow;
  received: number;
  gap: number;
  gapPercent: number;
  status: ComparisonRow["status"];
};
type Block = {
  key: string;
  title: string; // « R1 » ou « Non réceptionné »
  subtitle?: string; // date
  missing?: boolean;
  rows: BlockRow[];
  totalOrdered: number;
  totalReceived: number; // pièces reçues sur des références COMMANDÉES (somme des lignes du bloc)
  // Total PHYSIQUE de la réception (toutes lignes, y compris références non commandées) — c'est
  // « le total de la réception ». Peut dépasser totalReceived si le fournisseur a livré des
  // références absentes de la commande.
  receptionTotal?: number;
};

function GapCell({ gap }: { gap: number }) {
  // Écart = commandé − reçu : positif = manquant (rouge), négatif = surplus (bleu).
  return (
    <TableCell
      className={cn(
        "text-right font-medium",
        gap > 0 ? "text-red-600" : gap < 0 ? "text-blue-600" : ""
      )}
    >
      {gap > 0 ? `-${gap}` : gap < 0 ? `+${Math.abs(gap)}` : "0"}
    </TableCell>
  );
}

// Un bloc = UNE réception (ou le bloc « Non réceptionné »), avec son propre tableau et SON total.
function ReceptionBlock({ block }: { block: Block }) {
  const footGap = block.totalOrdered - block.totalReceived;
  // Pièces livrées sur des références HORS commande (total physique − reçu sur commandé).
  const offOrder = block.receptionTotal ? block.receptionTotal - block.totalReceived : 0;
  return (
    <div className="rounded-lg border">
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-3 py-2",
          block.missing ? "bg-red-50/60" : "bg-muted/40"
        )}
      >
        <div className="flex items-center gap-2 text-sm font-semibold">
          {block.missing ? (
            <XCircle className="h-4 w-4 text-red-600" />
          ) : (
            <span className="rounded bg-background px-1.5 py-0.5 text-xs shadow-sm">
              {block.title}
            </span>
          )}
          <span>{block.missing ? "Non réceptionné" : "Réception"}</span>
          {block.subtitle && (
            <span className="font-normal text-muted-foreground">· {block.subtitle}</span>
          )}
        </div>
        <div className="text-sm">
          <span className="text-muted-foreground">Total réception : </span>
          <span className="font-semibold">{block.receptionTotal ?? block.totalReceived}</span>
          <span className="text-muted-foreground"> pcs</span>
          {offOrder > 0 && (
            <span className="ml-1 text-xs text-amber-600">
              (dont {offOrder} hors commande)
            </span>
          )}
        </div>
      </div>
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
            {block.rows.map((b, idx) => (
              <TableRow
                key={`${b.row.productId}-${idx}`}
                className={cn(
                  b.status === "ecart_majeur" && "bg-red-50/50",
                  b.status === "ecart_mineur" && "bg-amber-50/50"
                )}
              >
                <TableCell className="font-mono text-sm">{b.row.reference}</TableCell>
                <TableCell>{b.row.color}</TableCell>
                <TableCell className="text-right font-medium">{b.row.totalOrdered}</TableCell>
                <TableCell className="text-right font-medium">{b.received}</TableCell>
                <GapCell gap={b.gap} />
                <TableCell className="text-right text-sm text-muted-foreground">
                  {b.gapPercent}%
                </TableCell>
                <TableCell>
                  <StatusBadge status={b.status} />
                </TableCell>
              </TableRow>
            ))}
            {/* Total DU BLOC (de cette réception). */}
            <TableRow className="border-t-2 font-semibold hover:bg-transparent">
              <TableCell colSpan={2}>Total {block.missing ? "" : block.title}</TableCell>
              <TableCell className="text-right">{block.totalOrdered}</TableCell>
              <TableCell className="text-right">{block.totalReceived}</TableCell>
              <GapCell gap={footGap} />
              <TableCell />
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}

function SupplierSection({ summary }: { summary: ComparisonSummary }) {
  const [expanded, setExpanded] = useState(summary.anomalyCount > 0);

  // Un bloc par réception : les lignes reçues DANS cette réception, avec écart et total du bloc.
  // Les lignes commandées mais reçues nulle part vont dans un bloc « Non réceptionné ».
  const blocks: Block[] = [];
  summary.receptions.forEach((rec, i) => {
    const rows: BlockRow[] = summary.rows
      .filter((r) => (r.receivedByReception[rec.id] || 0) > 0)
      .map((r) => {
        const received = r.receivedByReception[rec.id] || 0;
        return { row: r, received, ...deriveGap(r.totalOrdered, received) };
      });
    if (rows.length === 0) return;
    blocks.push({
      key: rec.id,
      title: `R${i + 1}`,
      subtitle: fmtRecDate(rec.receptionDate),
      rows,
      totalOrdered: rows.reduce((s, b) => s + b.row.totalOrdered, 0),
      totalReceived: rows.reduce((s, b) => s + b.received, 0),
      receptionTotal: rec.totalReceived,
    });
  });
  const missingRows: BlockRow[] = summary.rows
    .filter((r) => r.totalReceived === 0)
    .map((r) => ({ row: r, received: 0, ...deriveGap(r.totalOrdered, 0) }));
  if (missingRows.length > 0) {
    blocks.push({
      key: "__missing__",
      title: "Non réceptionné",
      missing: true,
      rows: missingRows,
      totalOrdered: missingRows.reduce((s, b) => s + b.row.totalOrdered, 0),
      totalReceived: 0,
    });
  }

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
        <CardContent className="space-y-4">
          {blocks.map((block) => (
            <ReceptionBlock key={block.key} block={block} />
          ))}
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

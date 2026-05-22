"use client";

import { useEffect, useState, useCallback } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Calculator,
  Play,
  CheckCircle,
  AlertTriangle,
  Users,
  Package,
  TrendingDown,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  Download,
  History,
  Info,
} from "lucide-react";
import { cn, sumQuantities, formatNumber, type SizeQuantities } from "@/lib/utils";
import { toast } from "sonner";
import * as XLSX from "xlsx";

interface SimulationLine {
  clientId: string;
  clientOrderId: string;
  clientName: string;
  productId: string;
  productReference: string;
  productColor: string;
  sizeScale: string[];
  original: SizeQuantities;
  allocated: SizeQuantities;
  reduced: SizeQuantities;
  reductionReason: string;
  status: "LIVRABLE" | "EN_ATTENTE" | "ANNULE";
  isManualAdjustment: boolean;
}

interface ClientImpact {
  clientId: string;
  clientName: string;
  totalOriginal: number;
  totalAllocated: number;
  totalReduced: number;
  reductionPercent: number;
  lineCount: number;
  reducedLineCount: number;
}

interface SimulationSummary {
  totalDemands: number;
  totalProducts: number;
  totalClients: number;
  totalOriginal: number;
  totalAllocated: number;
}

interface SessionEntry {
  id: string;
  status: string;
  sessionDate: string;
  notes: string | null;
  _count: { lines: number };
}

interface CatalogEntry {
  id: string;
  name: string;
  orderCount: number;
}

function ImpactCard({ impact }: { impact: ClientImpact }) {
  const severity =
    impact.reductionPercent === 0
      ? "none"
      : impact.reductionPercent <= 15
        ? "low"
        : impact.reductionPercent <= 30
          ? "medium"
          : "high";

  return (
    <Card
      className={cn(
        "transition-colors",
        severity === "none" && "border-emerald-200 bg-emerald-50/50",
        severity === "low" && "border-amber-200 bg-amber-50/50",
        severity === "medium" && "border-orange-200 bg-orange-50/50",
        severity === "high" && "border-red-200 bg-red-50/50"
      )}
    >
      <CardContent className="pt-4 pb-4 px-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium text-sm truncate">{impact.clientName}</span>
          <Badge
            className={cn(
              "text-xs",
              severity === "none" &&
                "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
              severity === "low" &&
                "bg-amber-100 text-amber-700 hover:bg-amber-100",
              severity === "medium" &&
                "bg-orange-100 text-orange-700 hover:bg-orange-100",
              severity === "high" &&
                "bg-red-100 text-red-700 hover:bg-red-100"
            )}
          >
            {impact.reductionPercent === 0
              ? "100%"
              : `-${impact.reductionPercent}%`}
          </Badge>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
          <div>
            <span className="block font-medium text-foreground">
              {formatNumber(impact.totalOriginal)}
            </span>
            Commandé
          </div>
          <div>
            <span className="block font-medium text-foreground">
              {formatNumber(impact.totalAllocated)}
            </span>
            Alloué
          </div>
          <div>
            <span
              className={cn(
                "block font-medium",
                impact.totalReduced > 0 ? "text-red-600" : "text-foreground"
              )}
            >
              {impact.totalReduced > 0
                ? `-${formatNumber(impact.totalReduced)}`
                : "0"}
            </span>
            Réduit
          </div>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          {impact.reducedLineCount > 0
            ? `${impact.reducedLineCount}/${impact.lineCount} lignes impactées`
            : `${impact.lineCount} lignes — aucune réduction`}
        </div>
      </CardContent>
    </Card>
  );
}

function ProductGroup({
  productId,
  reference,
  color,
  sizeScale,
  lines,
}: {
  productId: string;
  reference: string;
  color: string;
  sizeScale: string[];
  lines: SimulationLine[];
}) {
  const [expanded, setExpanded] = useState(
    lines.some((l) => l.reductionReason !== "NONE")
  );

  const totalOriginal = lines.reduce((s, l) => s + sumQuantities(l.original), 0);
  const totalAllocated = lines.reduce(
    (s, l) => s + sumQuantities(l.allocated),
    0
  );
  const hasReduction = totalOriginal > totalAllocated;

  return (
    <Card className="overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <div>
            <span className="font-mono text-sm font-medium">{reference}</span>
            <span className="text-muted-foreground text-sm ml-2">{color}</span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">
            {lines.length} client{lines.length > 1 ? "s" : ""}
          </span>
          <span>
            {formatNumber(totalAllocated)} / {formatNumber(totalOriginal)}
          </span>
          {hasReduction && (
            <Badge className="bg-red-100 text-red-700 hover:bg-red-100 text-xs">
              <TrendingDown className="h-3 w-3 mr-1" />-
              {formatNumber(totalOriginal - totalAllocated)}
            </Badge>
          )}
        </div>
      </div>
      {expanded && (
        <div className="border-t">
          <ScrollArea>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Client</TableHead>
                  {sizeScale.map((s) => (
                    <TableHead key={s} className="text-center w-[60px]">
                      {s}
                    </TableHead>
                  ))}
                  <TableHead className="text-right w-[80px]">Total</TableHead>
                  <TableHead className="text-right w-[80px]">Réduit</TableHead>
                  <TableHead className="w-[100px]">Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => {
                  const origTotal = sumQuantities(line.original);
                  const allocTotal = sumQuantities(line.allocated);
                  const reduced = origTotal - allocTotal;
                  return (
                    <TableRow
                      key={`${line.clientId}:${line.clientOrderId}`}
                      className={cn(
                        reduced > 0 && "bg-red-50/30",
                        line.status === "ANNULE" && "bg-zinc-100/50 opacity-60"
                      )}
                    >
                      <TableCell className="font-medium text-sm">
                        {line.clientName}
                      </TableCell>
                      {sizeScale.map((size) => {
                        const orig = line.original[size] || 0;
                        const alloc = line.allocated[size] || 0;
                        const isReduced = orig > alloc;
                        return (
                          <TableCell
                            key={size}
                            className={cn(
                              "text-center text-sm",
                              isReduced && "text-red-600 font-medium"
                            )}
                          >
                            {alloc > 0 ? alloc : "-"}
                            {isReduced && (
                              <span className="block text-[10px] text-muted-foreground line-through">
                                {orig}
                              </span>
                            )}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right font-medium text-sm">
                        {formatNumber(allocTotal)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right text-sm",
                          reduced > 0 ? "text-red-600 font-medium" : ""
                        )}
                      >
                        {reduced > 0 ? `-${reduced}` : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs",
                            line.status === "LIVRABLE" &&
                              "border-emerald-300 text-emerald-700",
                            line.status === "EN_ATTENTE" &&
                              "border-amber-300 text-amber-700",
                            line.status === "ANNULE" &&
                              "border-zinc-300 text-zinc-500"
                          )}
                        >
                          {line.status === "LIVRABLE"
                            ? "Livrable"
                            : line.status === "EN_ATTENTE"
                              ? "En attente"
                              : "Annulé"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      )}
    </Card>
  );
}

export default function AllocationPage() {
  const { activeSeason } = useSeason();
  const [lines, setLines] = useState<SimulationLine[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [clientImpacts, setClientImpacts] = useState<ClientImpact[]>([]);
  const [summary, setSummary] = useState<SimulationSummary | null>(null);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [catalogs, setCatalogs] = useState<CatalogEntry[]>([]);
  const [selectedCatalog, setSelectedCatalog] = useState<string>("ALL");
  const [simulating, setSimulating] = useState(false);
  const [validating, setValidating] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const loadSessions = useCallback(async () => {
    if (!activeSeason) return;
    try {
      const res = await fetch(
        `/api/allocation/sessions?seasonId=${activeSeason.id}`
      );
      const data = await res.json();
      setSessions(data.data || []);
    } catch {}
  }, [activeSeason]);

  const loadCatalogs = useCallback(async () => {
    if (!activeSeason) return;
    try {
      const res = await fetch(`/api/catalogs?seasonId=${activeSeason.id}`);
      const data = await res.json();
      setCatalogs(data.data || []);
    } catch {}
  }, [activeSeason]);

  useEffect(() => {
    setLines([]);
    setWarnings([]);
    setClientImpacts([]);
    setSummary(null);
    setSelectedCatalog("ALL");
    loadSessions();
    loadCatalogs();
  }, [activeSeason, loadSessions, loadCatalogs]);

  const runSimulation = async () => {
    if (!activeSeason) return;
    setSimulating(true);
    try {
      const payload: Record<string, string> = { seasonId: activeSeason.id };
      if (selectedCatalog !== "ALL") {
        payload.catalogId = selectedCatalog;
      }
      const res = await fetch("/api/allocation/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      setLines(data.lines || []);
      setWarnings(data.warnings || []);
      setClientImpacts(data.clientImpacts || []);
      setSummary(data.summary || null);
      toast.success("Simulation terminée", {
        description: `${data.lines?.length || 0} lignes calculées`,
      });
    } catch (e) {
      toast.error("Erreur lors de la simulation", {
        description: String(e),
      });
    } finally {
      setSimulating(false);
    }
  };

  const validateAllocation = async () => {
    if (!activeSeason || lines.length === 0) return;
    setValidating(true);
    try {
      const res = await fetch("/api/allocation/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seasonId: activeSeason.id,
          lines: lines.map((l) => ({
            clientId: l.clientId,
            clientOrderId: l.clientOrderId,
            productId: l.productId,
            original: l.original,
            allocated: l.allocated,
            reduced: l.reduced,
            reductionReason: l.reductionReason,
            status: l.status,
            isManualAdjustment: l.isManualAdjustment,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      toast.success("Répartition validée", {
        description: `Session créée avec ${data.lineCount} lignes`,
      });
      setLines([]);
      setWarnings([]);
      setClientImpacts([]);
      setSummary(null);
      loadSessions();
    } catch (e) {
      toast.error("Erreur lors de la validation", {
        description: String(e),
      });
    } finally {
      setValidating(false);
    }
  };

  const exportToExcel = () => {
    const rows = lines.map((l) => {
      const row: Record<string, string | number> = {
        Client: l.clientName,
        Référence: l.productReference,
        Couleur: l.productColor,
      };
      for (const size of l.sizeScale) {
        row[`Commandé ${size}`] = l.original[size] || 0;
        row[`Alloué ${size}`] = l.allocated[size] || 0;
      }
      row["Total commandé"] = sumQuantities(l.original);
      row["Total alloué"] = sumQuantities(l.allocated);
      row["Réduction"] = sumQuantities(l.original) - sumQuantities(l.allocated);
      row["Statut"] = l.status;
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Répartition");
    XLSX.writeFile(wb, `repartition_${activeSeason?.name || ""}.xlsx`);
  };

  const productGroups = new Map<
    string,
    {
      reference: string;
      color: string;
      sizeScale: string[];
      lines: SimulationLine[];
    }
  >();
  for (const line of lines) {
    if (!productGroups.has(line.productId)) {
      productGroups.set(line.productId, {
        reference: line.productReference,
        color: line.productColor,
        sizeScale: line.sizeScale,
        lines: [],
      });
    }
    productGroups.get(line.productId)!.lines.push(line);
  }

  return (
    <div>
      <Topbar title="Répartition" />
      <div className="p-8 space-y-6">
        <PageHeader
          title="Répartition des quantités"
          description="Simulez et validez la répartition automatique des manquants entre clients"
          action={
            <div className="flex items-center gap-2">
              {sessions.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowHistory(!showHistory)}
                  className="gap-2"
                >
                  <History className="h-4 w-4" />
                  Historique ({sessions.length})
                </Button>
              )}
              {lines.length > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportToExcel}
                    className="gap-2"
                  >
                    <Download className="h-4 w-4" />
                    Exporter
                  </Button>
                  <Button
                    size="sm"
                    onClick={validateAllocation}
                    disabled={validating}
                    className="gap-2"
                  >
                    <CheckCircle className="h-4 w-4" />
                    {validating ? "Validation..." : "Valider"}
                  </Button>
                </>
              )}
            </div>
          }
        />

        {!activeSeason ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <p className="text-sm text-muted-foreground">
                Sélectionnez une saison pour lancer une répartition
              </p>
            </CardContent>
          </Card>
        ) : lines.length === 0 && !showHistory ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
              <Calculator className="h-12 w-12 text-muted-foreground/50" />
              <div className="text-center space-y-1">
                <p className="text-sm text-muted-foreground">
                  Lancez une simulation pour calculer la répartition optimale
                </p>
                <p className="text-xs text-muted-foreground/70">
                  L&apos;algorithme prend en compte les 8 règles de répartition
                  configurées
                </p>
              </div>
              {catalogs.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Catalogue :</span>
                  <Select value={selectedCatalog} onValueChange={(v: string | null) => v && setSelectedCatalog(v)}>
                    <SelectTrigger className="w-[240px] text-sm">
                      <SelectValue placeholder="Tous les catalogues" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">Tous les catalogues</SelectItem>
                      {catalogs.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} ({c.orderCount} cmd)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button
                onClick={runSimulation}
                disabled={simulating}
                className="gap-2 mt-2"
              >
                <Play className="h-4 w-4" />
                {simulating ? "Calcul en cours..." : "Lancer la simulation"}
              </Button>
            </CardContent>
          </Card>
        ) : showHistory ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Sessions précédentes</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowHistory(false)}
              >
                Retour
              </Button>
            </div>
            {sessions.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <p className="text-sm text-muted-foreground">
                    Aucune session de répartition enregistrée
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {sessions.map((session) => (
                  <Card key={session.id}>
                    <CardContent className="flex items-center justify-between py-3 px-4">
                      <div className="flex items-center gap-3">
                        <Badge
                          className={cn(
                            "text-xs",
                            session.status === "VALIDATED" &&
                              "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
                            session.status === "SIMULATION" &&
                              "bg-blue-100 text-blue-700 hover:bg-blue-100",
                            session.status === "CANCELLED" &&
                              "bg-zinc-100 text-zinc-500 hover:bg-zinc-100"
                          )}
                        >
                          {session.status === "VALIDATED"
                            ? "Validé"
                            : session.status === "SIMULATION"
                              ? "Simulation"
                              : "Annulé"}
                        </Badge>
                        <div>
                          <span className="text-sm font-medium">
                            {new Date(session.sessionDate).toLocaleDateString(
                              "fr-FR",
                              {
                                day: "numeric",
                                month: "long",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              }
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground ml-2">
                            {session._count.lines} lignes
                          </span>
                        </div>
                      </div>
                      {session.notes && (
                        <span className="text-xs text-muted-foreground max-w-[200px] truncate">
                          {session.notes}
                        </span>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Summary cards */}
            {summary && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2 mb-1">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Clients
                      </span>
                    </div>
                    <div className="text-2xl font-bold">
                      {summary.totalClients}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2 mb-1">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Produits
                      </span>
                    </div>
                    <div className="text-2xl font-bold">
                      {summary.totalProducts}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2 mb-1">
                      <ArrowDown className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Pièces commandées
                      </span>
                    </div>
                    <div className="text-2xl font-bold">
                      {formatNumber(summary.totalOriginal)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2 mb-1">
                      <TrendingDown className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Pièces allouées
                      </span>
                    </div>
                    <div
                      className={cn(
                        "text-2xl font-bold",
                        summary.totalAllocated < summary.totalOriginal
                          ? "text-amber-600"
                          : "text-emerald-600"
                      )}
                    >
                      {formatNumber(summary.totalAllocated)}
                    </div>
                    {summary.totalAllocated < summary.totalOriginal && (
                      <p className="text-xs text-muted-foreground mt-1">
                        -{formatNumber(summary.totalOriginal - summary.totalAllocated)}{" "}
                        pièces (
                        {Math.round(
                          ((summary.totalOriginal - summary.totalAllocated) /
                            summary.totalOriginal) *
                            100
                        )}
                        %)
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Warnings */}
            {warnings.length > 0 && (
              <Card className="border-amber-200 bg-amber-50/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 text-amber-700">
                    <AlertTriangle className="h-4 w-4" />
                    Avertissements ({warnings.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1">
                    {warnings.map((w, i) => (
                      <li
                        key={i}
                        className="text-xs text-amber-700 flex items-start gap-2"
                      >
                        <span className="mt-1 h-1 w-1 rounded-full bg-amber-400 shrink-0" />
                        {w}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Client impact cards */}
            {clientImpacts.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                  <Info className="h-4 w-4" />
                  Impact par client
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {clientImpacts
                    .sort((a, b) => b.reductionPercent - a.reductionPercent)
                    .map((impact) => (
                      <ImpactCard key={impact.clientId} impact={impact} />
                    ))}
                </div>
              </div>
            )}

            {/* Actions bar */}
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Détail par produit ({productGroups.size} produits,{" "}
                {lines.length} lignes)
              </h3>
              <Button
                variant="outline"
                size="sm"
                onClick={runSimulation}
                disabled={simulating}
                className="gap-2"
              >
                <Play className="h-4 w-4" />
                {simulating ? "Calcul..." : "Relancer"}
              </Button>
            </div>

            {/* Product groups */}
            <div className="space-y-3">
              {Array.from(productGroups.entries()).map(
                ([productId, group]) => (
                  <ProductGroup
                    key={productId}
                    productId={productId}
                    reference={group.reference}
                    color={group.color}
                    sizeScale={group.sizeScale}
                    lines={group.lines}
                  />
                )
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

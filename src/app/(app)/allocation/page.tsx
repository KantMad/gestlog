"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
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
  Barcode,
  History,
  Pencil,
  X,
  Filter,
  Store,
  Search,
} from "lucide-react";
import { cn, sumQuantities, formatNumber, type SizeQuantities } from "@/lib/utils";
import { toast } from "sonner";
import * as XLSX from "xlsx";

interface SimulationLine {
  clientId: string;
  clientOrderId: string;
  clientName: string;
  clientCode: string;
  productId: string;
  productReference: string;
  productColor: string;
  productColorLabel: string;
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

interface ClientEntry {
  id: string;
  name: string;
  code: string;
}

interface SupplierEntry {
  id: string;
  name: string;
  code: string;
}

// ─── Editable cell for manual adjustments ────────────────────

function EditableCell({
  value,
  original,
  onChange,
}: {
  value: number;
  original: number;
  onChange: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    const n = parseInt(draft, 10);
    if (!isNaN(n) && n >= 0 && n <= original) {
      onChange(n);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <Input
        ref={inputRef}
        type="number"
        min={0}
        max={original}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-7 w-14 text-center text-sm p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    );
  }

  const isReduced = original > value;
  return (
    <span
      className={cn(
        "cursor-pointer hover:bg-muted rounded px-1 py-0.5 transition-colors inline-block min-w-[2rem] text-center",
        isReduced && "text-red-600 font-medium"
      )}
      onClick={() => {
        setDraft(String(value));
        setEditing(true);
      }}
      title="Cliquer pour modifier"
    >
      {value > 0 ? value : "-"}
      {isReduced && (
        <span className="block text-[10px] text-muted-foreground line-through">
          {original}
        </span>
      )}
    </span>
  );
}

// ─── Client group (boutique) ─────────────────────────────────

function ClientGroup({
  clientId,
  clientName,
  lines,
  onLineChange,
}: {
  clientId: string;
  clientName: string;
  lines: SimulationLine[];
  onLineChange: (lineKey: string, size: string, value: number) => void;
}) {
  const [expanded, setExpanded] = useState(
    lines.some((l) => l.reductionReason !== "NONE")
  );

  const totalOriginal = lines.reduce((s, l) => s + sumQuantities(l.original), 0);
  const totalAllocated = lines.reduce((s, l) => s + sumQuantities(l.allocated), 0);
  const hasReduction = totalOriginal > totalAllocated;
  const reductionPct = totalOriginal > 0
    ? Math.round(((totalOriginal - totalAllocated) / totalOriginal) * 100)
    : 0;

  const severity =
    reductionPct === 0 ? "none" : reductionPct <= 15 ? "low" : reductionPct <= 30 ? "medium" : "high";

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
          <Store className="h-4 w-4 text-muted-foreground" />
          <div>
            <span className="font-semibold text-sm">{clientName}</span>
            <span className="text-muted-foreground text-xs ml-2">
              {lines.length} produit{lines.length > 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="text-right">
            <span className="text-xs text-muted-foreground">Commandé</span>
            <span className="block font-medium">{formatNumber(totalOriginal)}</span>
          </div>
          <div className="text-right">
            <span className="text-xs text-muted-foreground">Alloué</span>
            <span className={cn("block font-medium", hasReduction ? "text-amber-600" : "text-emerald-600")}>
              {formatNumber(totalAllocated)}
            </span>
          </div>
          {hasReduction && (
            <Badge
              className={cn(
                "text-xs",
                severity === "low" && "bg-amber-100 text-amber-700 hover:bg-amber-100",
                severity === "medium" && "bg-orange-100 text-orange-700 hover:bg-orange-100",
                severity === "high" && "bg-red-100 text-red-700 hover:bg-red-100"
              )}
            >
              <TrendingDown className="h-3 w-3 mr-1" />
              -{reductionPct}%
            </Badge>
          )}
          {!hasReduction && (
            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-xs">
              100%
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
                  <TableHead className="w-[160px]">Référence</TableHead>
                  <TableHead className="w-[80px]">Couleur</TableHead>
                  {/* Gather all sizes from all lines */}
                  {getAllSizes(lines).map((s) => (
                    <TableHead key={s} className="text-center w-[55px]">
                      {s}
                    </TableHead>
                  ))}
                  <TableHead className="text-right w-[70px]">Total</TableHead>
                  <TableHead className="text-right w-[70px]">Écart</TableHead>
                  <TableHead className="w-[90px]">Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => {
                  const lineKey = `${line.clientId}:${line.clientOrderId}:${line.productId}`;
                  const origTotal = sumQuantities(line.original);
                  const allocTotal = sumQuantities(line.allocated);
                  const diff = origTotal - allocTotal;
                  const sizes = getAllSizes(lines);
                  return (
                    <TableRow
                      key={lineKey}
                      className={cn(
                        diff > 0 && "bg-red-50/30",
                        line.status === "ANNULE" && "bg-zinc-100/50 opacity-60"
                      )}
                    >
                      <TableCell className="font-mono text-sm font-medium">
                        {line.productReference}
                      </TableCell>
                      <TableCell className="text-sm">{line.productColor}</TableCell>
                      {sizes.map((size) => {
                        const orig = line.original[size] || 0;
                        const alloc = line.allocated[size] || 0;
                        if (orig === 0 && alloc === 0) {
                          return (
                            <TableCell key={size} className="text-center text-sm text-muted-foreground">
                              -
                            </TableCell>
                          );
                        }
                        return (
                          <TableCell key={size} className="text-center text-sm p-1">
                            <EditableCell
                              value={alloc}
                              original={orig}
                              onChange={(v) => onLineChange(lineKey, size, v)}
                            />
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right font-medium text-sm">
                        {formatNumber(allocTotal)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right text-sm tabular-nums",
                          diff > 0 ? "text-red-600 font-medium" : diff < 0 ? "text-emerald-600 font-medium" : ""
                        )}
                      >
                        {diff === 0
                          ? "—"
                          : diff > 0
                            ? `-${diff} (-${origTotal > 0 ? Math.round((diff / origTotal) * 100) : 0}%)`
                            : `+${-diff} (+${origTotal > 0 ? Math.round((-diff / origTotal) * 100) : 0}%)`}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs",
                            line.status === "LIVRABLE" && "border-emerald-300 text-emerald-700",
                            line.status === "EN_ATTENTE" && "border-amber-300 text-amber-700",
                            line.status === "ANNULE" && "border-zinc-300 text-zinc-500"
                          )}
                        >
                          {line.status === "LIVRABLE" ? "Livrable" : line.status === "EN_ATTENTE" ? "En attente" : "Annulé"}
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

function getAllSizes(lines: SimulationLine[]): string[] {
  const sizeOrder: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    for (const s of line.sizeScale) {
      if (!seen.has(s)) {
        seen.add(s);
        sizeOrder.push(s);
      }
    }
  }
  return sizeOrder;
}

// ─── Product group (vue par produit) ─────────────────────────

function ProductGroup({
  reference,
  color,
  lines,
  received,
  onLineChange,
  onDistributeSurplus,
}: {
  reference: string;
  color: string;
  lines: SimulationLine[];
  received?: SizeQuantities;
  onLineChange: (lineKey: string, size: string, value: number) => void;
  onDistributeSurplus: () => void;
}) {
  const [expanded, setExpanded] = useState(
    lines.some((l) => l.reductionReason !== "NONE")
  );

  const totalOriginal = lines.reduce((s, l) => s + sumQuantities(l.original), 0);
  const totalAllocated = lines.reduce((s, l) => s + sumQuantities(l.allocated), 0);
  // Total reçu (réception fournisseur) pour ce produit et écart avec la demande client.
  // Écart = Reçu − Commande (négatif = manque de réception, positif = surplus livré),
  // même convention de signe que la colonne Écart des lignes boutique.
  const totalReceived = received ? sumQuantities(received) : 0;
  const demandGap = totalReceived - totalOriginal;
  // Surplus RÉPARTISSABLE = reçu − déjà alloué, uniquement sur les tailles commandées
  // (une taille reçue que personne n'a commandée n'est pas auto-répartissable).
  const allocBySize: Record<string, number> = {};
  const orderedBySize: Record<string, number> = {};
  for (const l of lines) {
    for (const [s, q] of Object.entries(l.allocated)) allocBySize[s] = (allocBySize[s] || 0) + q;
    for (const [s, q] of Object.entries(l.original)) orderedBySize[s] = (orderedBySize[s] || 0) + q;
  }
  const surplusTotal = received
    ? Object.entries(received).reduce(
        (s, [sz, r]) => s + ((orderedBySize[sz] || 0) > 0 ? Math.max(0, r - (allocBySize[sz] || 0)) : 0),
        0
      )
    : 0;
  const hasReduction = totalOriginal > totalAllocated;
  const reductionPct = totalOriginal > 0
    ? Math.round(((totalOriginal - totalAllocated) / totalOriginal) * 100)
    : 0;
  const sizes = getAllSizes(lines);

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
          <Package className="h-4 w-4 text-muted-foreground" />
          <div>
            <span className="font-mono text-sm font-semibold">{reference}</span>
            <span className="text-muted-foreground text-sm ml-2">{color}</span>
            <span className="text-muted-foreground text-xs ml-3">
              {lines.length} boutique{lines.length > 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="text-right">
            <span className="text-xs text-muted-foreground">Cmd. clients</span>
            <span className="block font-medium">{formatNumber(totalOriginal)}</span>
          </div>
          <div className="text-right">
            <span className="text-xs text-muted-foreground">Reçu fourn.</span>
            <span
              className={cn(
                "block font-medium",
                demandGap < 0 ? "text-red-600" : "text-foreground"
              )}
              title="Total reçu (réceptions fournisseur) pour ce produit"
            >
              {formatNumber(totalReceived)}
            </span>
          </div>
          <div className="text-right">
            <span className="text-xs text-muted-foreground">Écart</span>
            <span
              className={cn(
                "block font-medium tabular-nums",
                demandGap < 0 ? "text-red-600" : demandGap > 0 ? "text-emerald-600" : "text-muted-foreground"
              )}
              title="Reçu fournisseur − commandes clients (négatif = réception insuffisante, positif = surplus)"
            >
              {demandGap === 0 ? "—" : demandGap > 0 ? `+${formatNumber(demandGap)}` : formatNumber(demandGap)}
            </span>
          </div>
          <div className="text-right">
            <span className="text-xs text-muted-foreground">Alloué</span>
            <span className={cn("block font-medium", hasReduction ? "text-amber-600" : "text-emerald-600")}>
              {formatNumber(totalAllocated)}
            </span>
          </div>
          {surplusTotal > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              onClick={(e) => {
                e.stopPropagation();
                onDistributeSurplus();
              }}
              title="Répartir les pièces livrées en plus, au prorata des commandes (ranking pour les arrondis)"
            >
              <ArrowDown className="h-3.5 w-3.5 rotate-180" />
              Répartir surplus (+{formatNumber(surplusTotal)})
            </Button>
          )}
          {hasReduction ? (
            <Badge
              className={cn(
                "text-xs",
                reductionPct <= 15 && "bg-amber-100 text-amber-700 hover:bg-amber-100",
                reductionPct > 15 && reductionPct <= 30 && "bg-orange-100 text-orange-700 hover:bg-orange-100",
                reductionPct > 30 && "bg-red-100 text-red-700 hover:bg-red-100"
              )}
            >
              <TrendingDown className="h-3 w-3 mr-1" />
              -{reductionPct}%
            </Badge>
          ) : (
            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-xs">
              100%
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
                  <TableHead className="w-[180px]">Boutique</TableHead>
                  {sizes.map((s) => (
                    <TableHead key={s} className="text-center w-[55px]">
                      {s}
                    </TableHead>
                  ))}
                  <TableHead className="text-right w-[70px]">Total</TableHead>
                  <TableHead className="text-right w-[70px]">Écart</TableHead>
                  <TableHead className="w-[90px]">Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => {
                  const lineKey = `${line.clientId}:${line.clientOrderId}:${line.productId}`;
                  const origTotal = sumQuantities(line.original);
                  const allocTotal = sumQuantities(line.allocated);
                  const diff = origTotal - allocTotal;
                  return (
                    <TableRow
                      key={lineKey}
                      className={cn(
                        diff > 0 && "bg-red-50/30",
                        line.status === "ANNULE" && "bg-zinc-100/50 opacity-60"
                      )}
                    >
                      <TableCell className="font-medium text-sm">
                        {line.clientName}
                      </TableCell>
                      {sizes.map((size) => {
                        const orig = line.original[size] || 0;
                        const alloc = line.allocated[size] || 0;
                        if (orig === 0 && alloc === 0) {
                          return (
                            <TableCell key={size} className="text-center text-sm text-muted-foreground">
                              -
                            </TableCell>
                          );
                        }
                        return (
                          <TableCell key={size} className="text-center text-sm p-1">
                            <EditableCell
                              value={alloc}
                              original={orig}
                              onChange={(v) => onLineChange(lineKey, size, v)}
                            />
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right font-medium text-sm">
                        {formatNumber(allocTotal)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right text-sm tabular-nums",
                          diff > 0 ? "text-red-600 font-medium" : diff < 0 ? "text-emerald-600 font-medium" : ""
                        )}
                      >
                        {diff === 0
                          ? "—"
                          : diff > 0
                            ? `-${diff} (-${origTotal > 0 ? Math.round((diff / origTotal) * 100) : 0}%)`
                            : `+${-diff} (+${origTotal > 0 ? Math.round((-diff / origTotal) * 100) : 0}%)`}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs",
                            line.status === "LIVRABLE" && "border-emerald-300 text-emerald-700",
                            line.status === "EN_ATTENTE" && "border-amber-300 text-amber-700",
                            line.status === "ANNULE" && "border-zinc-300 text-zinc-500"
                          )}
                        >
                          {line.status === "LIVRABLE" ? "Livrable" : line.status === "EN_ATTENTE" ? "En attente" : "Annulé"}
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

// ─── Filter panel ────────────────────────────────────────────

function FilterPanel({
  clients,
  suppliers,
  catalogs,
  selectedClients,
  setSelectedClients,
  selectedSuppliers,
  setSelectedSuppliers,
  selectedCatalog,
  setSelectedCatalog,
  orderType,
  setOrderType,
  productSearch,
  setProductSearch,
}: {
  clients: ClientEntry[];
  suppliers: SupplierEntry[];
  catalogs: CatalogEntry[];
  selectedClients: string[];
  setSelectedClients: (v: string[]) => void;
  selectedSuppliers: string[];
  setSelectedSuppliers: (v: string[]) => void;
  selectedCatalog: string;
  setSelectedCatalog: (v: string) => void;
  orderType: string;
  setOrderType: (v: string) => void;
  productSearch: string;
  setProductSearch: (v: string) => void;
}) {
  const hasFilters =
    selectedClients.length > 0 ||
    selectedSuppliers.length > 0 ||
    selectedCatalog !== "ALL" ||
    orderType !== "COMMANDE" ||
    productSearch !== "";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Filter className="h-4 w-4" />
          Filtres de simulation
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-muted-foreground"
              onClick={() => {
                setSelectedClients([]);
                setSelectedSuppliers([]);
                setSelectedCatalog("ALL");
                setOrderType("COMMANDE");
                setProductSearch("");
              }}
            >
              <X className="h-3 w-3 mr-1" />
              Réinitialiser
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {/* Order type */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Type de commande
            </label>
            <Select value={orderType} onValueChange={(v: string | null) => v && setOrderType(v)}>
              <SelectTrigger className="text-sm">
                <span className="text-sm truncate">
                  {{ COMMANDE: "Commandes uniquement", VSS: "Réassorts (VSS) uniquement", ALL: "Tout" }[orderType] || orderType}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="COMMANDE">Commandes uniquement</SelectItem>
                <SelectItem value="VSS">Réassorts (VSS) uniquement</SelectItem>
                <SelectItem value="ALL">Tout</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Catalog */}
          {catalogs.length > 0 && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Catalogue
              </label>
              <Select value={selectedCatalog} onValueChange={(v: string | null) => v && setSelectedCatalog(v)}>
                <SelectTrigger className="text-sm">
                  <span className="text-sm truncate">
                    {selectedCatalog === "ALL"
                      ? "Tous les catalogues"
                      : catalogs.find((c) => c.id === selectedCatalog)?.name || "Tous"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Tous les catalogues</SelectItem>
                  {catalogs.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} ({c.orderCount})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Clients (multi-select via chips) */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Clients ({selectedClients.length === 0 ? "tous" : selectedClients.length})
            </label>
            <Select
              value="__placeholder__"
              onValueChange={(v: string | null) => {
                if (v && v !== "__placeholder__" && !selectedClients.includes(v)) {
                  setSelectedClients([...selectedClients, v]);
                }
              }}
            >
              <SelectTrigger className="text-sm">
                <span className="text-sm text-muted-foreground truncate">Ajouter un client...</span>
              </SelectTrigger>
              <SelectContent>
                {clients
                  .filter((c) => !selectedClients.includes(c.id))
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {selectedClients.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {selectedClients.map((id) => {
                  const c = clients.find((cl) => cl.id === id);
                  return (
                    <Badge
                      key={id}
                      variant="secondary"
                      className="text-xs cursor-pointer gap-1"
                      onClick={() => setSelectedClients(selectedClients.filter((x) => x !== id))}
                    >
                      {c?.name || id}
                      <X className="h-3 w-3" />
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>

          {/* Suppliers (multi-select) */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Fournisseurs ({selectedSuppliers.length === 0 ? "tous" : selectedSuppliers.length})
            </label>
            <Select
              value="__placeholder__"
              onValueChange={(v: string | null) => {
                if (v && v !== "__placeholder__" && !selectedSuppliers.includes(v)) {
                  setSelectedSuppliers([...selectedSuppliers, v]);
                }
              }}
            >
              <SelectTrigger className="text-sm">
                <span className="text-sm text-muted-foreground truncate">Ajouter un fournisseur...</span>
              </SelectTrigger>
              <SelectContent>
                {suppliers
                  .filter((s) => !selectedSuppliers.includes(s.id))
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.code})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {selectedSuppliers.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {selectedSuppliers.map((id) => {
                  const s = suppliers.find((su) => su.id === id);
                  return (
                    <Badge
                      key={id}
                      variant="secondary"
                      className="text-xs cursor-pointer gap-1"
                      onClick={() => setSelectedSuppliers(selectedSuppliers.filter((x) => x !== id))}
                    >
                      {s?.name || id}
                      <X className="h-3 w-3" />
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>

          {/* Product reference search */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Références produit
            </label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="ex: AMBELT, JACKET..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>
            {productSearch && (
              <p className="text-[10px] text-muted-foreground mt-1">
                Séparer par virgule pour filtrer plusieurs références
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ───────────────────────────────────────────────

export default function AllocationPage() {
  const { activeSeason } = useSeason();
  const [lines, setLines] = useState<SimulationLine[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [clientImpacts, setClientImpacts] = useState<ClientImpact[]>([]);
  const [summary, setSummary] = useState<SimulationSummary | null>(null);
  // Reçu (réception fournisseur) et EAN par produit → écart demande/réception + export EAN.
  const [receivedByProduct, setReceivedByProduct] = useState<Record<string, SizeQuantities>>({});
  const [eansByProduct, setEansByProduct] = useState<Record<string, Record<string, string>>>({});
  const [rankingByClient, setRankingByClient] = useState<Record<string, number>>({});
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [catalogs, setCatalogs] = useState<CatalogEntry[]>([]);
  const [clients, setClients] = useState<ClientEntry[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierEntry[]>([]);
  const [simulating, setSimulating] = useState(false);
  const [validating, setValidating] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [manualEdits, setManualEdits] = useState(0);
  const [viewMode, setViewMode] = useState<"client" | "product">("client");
  // Filtre réception des résultats : tout / produits réceptionnés / non réceptionnés.
  const [receptionFilter, setReceptionFilter] = useState<"all" | "received" | "not_received">("all");

  // Filters
  const [selectedCatalog, setSelectedCatalog] = useState<string>("ALL");
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [selectedSuppliers, setSelectedSuppliers] = useState<string[]>([]);
  const [orderType, setOrderType] = useState<string>("COMMANDE");
  const [productSearch, setProductSearch] = useState<string>("");
  const [resultSearch, setResultSearch] = useState<string>("");

  // ── Persistance de la simulation entre les pages (sessionStorage) ──────────────
  // Conserve résultats + filtres pour ne pas devoir relancer la simulation à chaque
  // navigation. Restauré une fois au montage si même saison ; vidé au changement de saison.
  const STORE_KEY = "gestlog:allocation:sim:v1";
  const restoredRef = useRef(false);
  const seasonIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (restoredRef.current || !activeSeason) return;
    restoredRef.current = true;
    seasonIdRef.current = activeSeason.id;
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.seasonId !== activeSeason.id || !Array.isArray(s.lines) || s.lines.length === 0) return;
      setLines(s.lines);
      setWarnings(s.warnings || []);
      setClientImpacts(s.clientImpacts || []);
      setSummary(s.summary || null);
      setReceivedByProduct(s.receivedByProduct || {});
      setEansByProduct(s.eansByProduct || {});
      setRankingByClient(s.rankingByClient || {});
      setManualEdits(s.manualEdits || 0);
      const f = s.filters || {};
      setSelectedCatalog(f.selectedCatalog ?? "ALL");
      setSelectedClients(f.selectedClients ?? []);
      setSelectedSuppliers(f.selectedSuppliers ?? []);
      setOrderType(f.orderType ?? "COMMANDE");
      setProductSearch(f.productSearch ?? "");
      setViewMode(f.viewMode ?? "client");
      setReceptionFilter(f.receptionFilter ?? "all");
    } catch {
      /* stockage indisponible/corrompu → on ignore */
    }
  }, [activeSeason]);

  // Changement de saison → réinitialise la simulation (données d'une autre saison).
  useEffect(() => {
    if (!activeSeason || seasonIdRef.current === null || seasonIdRef.current === activeSeason.id) return;
    seasonIdRef.current = activeSeason.id;
    setLines([]);
    setWarnings([]);
    setClientImpacts([]);
    setSummary(null);
    setReceivedByProduct({});
    setEansByProduct({});
    setRankingByClient({});
    setManualEdits(0);
    try {
      sessionStorage.removeItem(STORE_KEY);
    } catch {
      /* noop */
    }
  }, [activeSeason]);

  // Sauvegarde à chaque changement (résultats + filtres), après la restauration initiale.
  useEffect(() => {
    if (!restoredRef.current || !activeSeason) return;
    try {
      if (lines.length === 0) {
        sessionStorage.removeItem(STORE_KEY);
        return;
      }
      sessionStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          seasonId: activeSeason.id,
          lines,
          warnings,
          clientImpacts,
          summary,
          receivedByProduct,
          eansByProduct,
          rankingByClient,
          manualEdits,
          filters: {
            selectedCatalog,
            selectedClients,
            selectedSuppliers,
            orderType,
            productSearch,
            viewMode,
            receptionFilter,
          },
        })
      );
    } catch {
      /* quota dépassé/indisponible → on n'échoue pas l'UI */
    }
  }, [
    activeSeason,
    lines,
    warnings,
    clientImpacts,
    summary,
    receivedByProduct,
    eansByProduct,
    rankingByClient,
    manualEdits,
    selectedCatalog,
    selectedClients,
    selectedSuppliers,
    orderType,
    productSearch,
    viewMode,
    receptionFilter,
  ]);

  const loadSessions = useCallback(async () => {
    if (!activeSeason) return;
    try {
      const res = await fetch(`/api/allocation/sessions?seasonId=${activeSeason.id}`);
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

  const loadClients = useCallback(async () => {
    if (!activeSeason) return;
    try {
      const res = await fetch(`/api/clients?seasonId=${activeSeason.id}`);
      const data = await res.json();
      setClients(
        (data.data || []).map((c: { id: string; name: string; code: string }) => ({
          id: c.id,
          name: c.name,
          code: c.code,
        }))
      );
    } catch {}
  }, [activeSeason]);

  const loadSuppliers = useCallback(async () => {
    try {
      const res = await fetch("/api/suppliers");
      const data = await res.json();
      setSuppliers(
        (data.data || []).map((s: { id: string; name: string; code: string }) => ({
          id: s.id,
          name: s.name,
          code: s.code,
        }))
      );
    } catch {}
  }, []);

  useEffect(() => {
    setLines([]);
    setWarnings([]);
    setClientImpacts([]);
    setSummary(null);
    setSelectedCatalog("ALL");
    setSelectedClients([]);
    setSelectedSuppliers([]);
    setOrderType("COMMANDE");
    setProductSearch("");
    setManualEdits(0);
    loadSessions();
    loadCatalogs();
    loadClients();
    loadSuppliers();
  }, [activeSeason, loadSessions, loadCatalogs, loadClients, loadSuppliers]);

  const runSimulation = async () => {
    if (!activeSeason) return;
    setSimulating(true);
    setManualEdits(0);
    try {
      const payload: Record<string, unknown> = {
        seasonId: activeSeason.id,
        orderType,
      };
      if (selectedCatalog !== "ALL") payload.catalogId = selectedCatalog;
      if (selectedClients.length > 0) payload.clientIds = selectedClients;
      if (selectedSuppliers.length > 0) payload.supplierIds = selectedSuppliers;

      // Parse product references from comma-separated input
      if (productSearch.trim()) {
        const refs = productSearch
          .split(",")
          .map((r) => r.trim().toUpperCase())
          .filter(Boolean);
        if (refs.length > 0) payload.productReferences = refs;
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
      setReceivedByProduct(data.receivedByProduct || {});
      setEansByProduct(data.eansByProduct || {});
      setRankingByClient(data.rankingByClient || {});
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

  const handleLineChange = (lineKey: string, size: string, value: number) => {
    setLines((prev) =>
      prev.map((l) => {
        const key = `${l.clientId}:${l.clientOrderId}:${l.productId}`;
        if (key !== lineKey) return l;
        const newAllocated = { ...l.allocated, [size]: value };
        const origTotal = sumQuantities(l.original);
        const newTotal = sumQuantities(newAllocated);
        const newReduced: SizeQuantities = {};
        for (const [s, qty] of Object.entries(l.original)) {
          const diff = qty - (newAllocated[s] || 0);
          if (diff > 0) newReduced[s] = diff;
        }
        return {
          ...l,
          allocated: newAllocated,
          reduced: newReduced,
          reductionReason: newTotal < origTotal ? "MANUAL" : "NONE",
          isManualAdjustment: true,
          status: newTotal === 0 ? "ANNULE" as const : l.status === "ANNULE" ? "LIVRABLE" as const : l.status,
        };
      })
    );
    setManualEdits((e) => e + 1);
  };

  // Répartit le SURPLUS reçu (pièces livrées en plus) d'un produit entre les boutiques,
  // AU PRORATA de leur commande, taille par taille (le ranking départage les arrondis).
  // Alloue au-delà de la commande ; ne dépasse jamais le reçu.
  const distributeSurplus = (productId: string) => {
    const received = receivedByProduct[productId] || {};
    const additions = new Map<string, SizeQuantities>(); // lineKey → { size: extra }
    let addedTotal = 0;

    const productLines = lines.filter((l) => l.productId === productId);
    for (const size of Object.keys(received)) {
      const recv = received[size] || 0;
      const currentAlloc = productLines.reduce((s, l) => s + (l.allocated[size] || 0), 0);
      const surplus = recv - currentAlloc;
      if (surplus <= 0) continue;
      const eligible = productLines.filter((l) => (l.original[size] || 0) > 0);
      const totalOrder = eligible.reduce((s, l) => s + (l.original[size] || 0), 0);
      if (totalOrder <= 0) continue;
      const floors = eligible.map((l) => Math.floor(surplus * ((l.original[size] || 0) / totalOrder)));
      let remainder = surplus - floors.reduce((s, n) => s + n, 0);
      const addOne = (l: SimulationLine, n: number) => {
        if (n <= 0) return;
        const k = `${l.clientId}:${l.clientOrderId}:${l.productId}`;
        const m = additions.get(k) || {};
        m[size] = (m[size] || 0) + n;
        additions.set(k, m);
        addedTotal += n;
      };
      eligible.forEach((l, i) => addOne(l, floors[i]));
      // Reliquat (arrondis) : 1 pièce chacun, aux mieux classés d'abord.
      const byRank = [...eligible].sort(
        (a, b) => (rankingByClient[a.clientId] ?? 9999) - (rankingByClient[b.clientId] ?? 9999)
      );
      for (let i = 0; i < byRank.length && remainder > 0; i++, remainder--) addOne(byRank[i], 1);
    }

    if (additions.size === 0) {
      toast.info("Aucun surplus à répartir sur ce produit");
      return;
    }
    setLines((prev) =>
      prev.map((l) => {
        const k = `${l.clientId}:${l.clientOrderId}:${l.productId}`;
        const extra = additions.get(k);
        if (!extra) return l;
        const newAllocated = { ...l.allocated };
        for (const [s, n] of Object.entries(extra)) newAllocated[s] = (newAllocated[s] || 0) + n;
        const newTotal = sumQuantities(newAllocated);
        const newReduced: SizeQuantities = {};
        for (const [s, qty] of Object.entries(l.original)) {
          const d = qty - (newAllocated[s] || 0);
          if (d > 0) newReduced[s] = d;
        }
        return {
          ...l,
          allocated: newAllocated,
          reduced: newReduced,
          reductionReason: Object.keys(newReduced).length > 0 ? l.reductionReason : "NONE",
          isManualAdjustment: true,
          status: newTotal === 0 ? ("ANNULE" as const) : l.status === "ANNULE" ? ("LIVRABLE" as const) : l.status,
        };
      })
    );
    setManualEdits((e) => e + 1);
    toast.success(`Surplus réparti : +${addedTotal} pièce(s) au prorata des commandes`);
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
      setManualEdits(0);
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
      row["Ajusté manuellement"] = l.isManualAdjustment ? "Oui" : "Non";
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Répartition");
    XLSX.writeFile(wb, `repartition_${activeSeason?.name || ""}.xlsx`);
  };

  // Export « EAN / quantité » : une ligne par (boutique × produit/couleur × taille) allouée,
  // avec l'EAN et la quantité répartie. Format destiné à la réception boutique / caisse.
  const exportEanFile = () => {
    const rows: Record<string, string | number>[] = [];
    let missing = 0;
    for (const l of lines) {
      if (l.status === "ANNULE") continue;
      const eans = eansByProduct[l.productId] || {};
      for (const [size, qty] of Object.entries(l.allocated)) {
        if (!qty || qty <= 0) continue;
        const ean = eans[size];
        if (!ean) missing++;
        rows.push({
          Boutique: l.clientName,
          "Code boutique": l.clientCode,
          Référence: l.productReference,
          Couleur: l.productColor,
          "Libellé couleur": l.productColorLabel || "",
          Taille: size,
          EAN: ean || `MANQUANT_${l.productReference}_${l.productColor}_${size}`,
          Quantité: qty,
        });
      }
    }
    if (rows.length === 0) {
      toast.error("Aucune quantité allouée à exporter");
      return;
    }
    rows.sort(
      (a, b) =>
        String(a.Boutique).localeCompare(String(b.Boutique), "fr") ||
        String(a.Référence).localeCompare(String(b.Référence), "fr") ||
        String(a.Couleur).localeCompare(String(b.Couleur), "fr")
    );
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "EAN");
    XLSX.writeFile(wb, `repartition_EAN_${activeSeason?.name || ""}.xlsx`);
    if (missing > 0) {
      toast.warning(`${missing} ligne(s) sans EAN au référentiel (marquées « MANQUANT_… »)`);
    }
  };

  // Filtre réception : un produit est « réceptionné » si son total reçu > 0.
  const isReceived = (productId: string) =>
    sumQuantities(receivedByProduct[productId] || {}) > 0;
  const visibleLines =
    receptionFilter === "all"
      ? lines
      : lines.filter((l) =>
          receptionFilter === "received" ? isReceived(l.productId) : !isReceived(l.productId)
        );

  // Group lines by client
  const clientGroups = new Map<
    string,
    { clientName: string; lines: SimulationLine[] }
  >();
  for (const line of visibleLines) {
    if (!clientGroups.has(line.clientId)) {
      clientGroups.set(line.clientId, { clientName: line.clientName, lines: [] });
    }
    clientGroups.get(line.clientId)!.lines.push(line);
  }

  // Group lines by product
  const productGroups = new Map<
    string,
    { reference: string; color: string; lines: SimulationLine[] }
  >();
  for (const line of visibleLines) {
    if (!productGroups.has(line.productId)) {
      productGroups.set(line.productId, {
        reference: line.productReference,
        color: line.productColor,
        lines: [],
      });
    }
    productGroups.get(line.productId)!.lines.push(line);
  }

  // Helper: sort groups by most impacted first
  const sortByImpact = <T,>(entries: [string, { lines: SimulationLine[] } & T][]) => {
    entries.sort((a, b) => {
      const aOrig = a[1].lines.reduce((s, l) => s + sumQuantities(l.original), 0);
      const aAlloc = a[1].lines.reduce((s, l) => s + sumQuantities(l.allocated), 0);
      const bOrig = b[1].lines.reduce((s, l) => s + sumQuantities(l.original), 0);
      const bAlloc = b[1].lines.reduce((s, l) => s + sumQuantities(l.allocated), 0);
      const aRed = aOrig > 0 ? (aOrig - aAlloc) / aOrig : 0;
      const bRed = bOrig > 0 ? (bOrig - bAlloc) / bOrig : 0;
      return bRed - aRed;
    });
    return entries;
  };

  // Filter + sort client groups
  const filteredClientGroups = sortByImpact(
    (resultSearch && viewMode === "client"
      ? Array.from(clientGroups.entries()).filter(([, g]) =>
          g.clientName.toLowerCase().includes(resultSearch.toLowerCase())
        )
      : Array.from(clientGroups.entries())
    ) as [string, { clientName: string; lines: SimulationLine[] }][]
  );

  // Filter + sort product groups
  const filteredProductGroups = sortByImpact(
    (resultSearch && viewMode === "product"
      ? Array.from(productGroups.entries()).filter(([, g]) =>
          g.reference.toLowerCase().includes(resultSearch.toLowerCase()) ||
          g.color.toLowerCase().includes(resultSearch.toLowerCase())
        )
      : Array.from(productGroups.entries())
    ) as [string, { reference: string; color: string; lines: SimulationLine[] }][]
  );

  return (
    <div>
      <Topbar title="Répartition" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="Répartition des quantités"
          description="Simulez et ajustez la répartition entre boutiques — cliquez sur une quantité pour la modifier"
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
                  {manualEdits > 0 && (
                    <Badge variant="outline" className="text-xs gap-1 border-blue-300 text-blue-700">
                      <Pencil className="h-3 w-3" />
                      {manualEdits} modif{manualEdits > 1 ? "s" : ""} manuelles
                    </Badge>
                  )}
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
                    variant="outline"
                    size="sm"
                    onClick={exportEanFile}
                    className="gap-2"
                    title="Fichier EAN / quantité : boutique, produit, couleur, taille, EAN, quantité"
                  >
                    <Barcode className="h-4 w-4" />
                    Export EAN
                  </Button>
                  <Button
                    size="sm"
                    onClick={validateAllocation}
                    disabled={validating}
                    className="gap-2"
                  >
                    <CheckCircle className="h-4 w-4" />
                    {validating ? "Validation..." : "Valider la répartition"}
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
        ) : showHistory ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Sessions précédentes</h3>
              <Button variant="ghost" size="sm" onClick={() => setShowHistory(false)}>
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
                            session.status === "VALIDATED" && "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
                            session.status === "SIMULATION" && "bg-blue-100 text-blue-700 hover:bg-blue-100",
                            session.status === "CANCELLED" && "bg-zinc-100 text-zinc-500 hover:bg-zinc-100"
                          )}
                        >
                          {session.status === "VALIDATED" ? "Validé" : session.status === "SIMULATION" ? "Simulation" : "Annulé"}
                        </Badge>
                        <div>
                          <span className="text-sm font-medium">
                            {new Date(session.sessionDate).toLocaleDateString("fr-FR", {
                              day: "numeric",
                              month: "long",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
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
            {/* Filters + launch */}
            <FilterPanel
              clients={clients}
              suppliers={suppliers}
              catalogs={catalogs}
              selectedClients={selectedClients}
              setSelectedClients={setSelectedClients}
              selectedSuppliers={selectedSuppliers}
              setSelectedSuppliers={setSelectedSuppliers}
              selectedCatalog={selectedCatalog}
              setSelectedCatalog={setSelectedCatalog}
              orderType={orderType}
              setOrderType={setOrderType}
              productSearch={productSearch}
              setProductSearch={setProductSearch}
            />

            <div className="flex justify-center">
              <Button
                onClick={runSimulation}
                disabled={simulating}
                className="gap-2"
                size="lg"
              >
                <Play className="h-4 w-4" />
                {simulating ? "Calcul en cours..." : lines.length > 0 ? "Relancer la simulation" : "Lancer la simulation"}
              </Button>
            </div>

            {lines.length === 0 && !simulating && (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12 gap-2">
                  <Calculator className="h-10 w-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">
                    Configurez vos filtres puis lancez la simulation
                  </p>
                  <p className="text-xs text-muted-foreground/70">
                    L&apos;algorithme prend en compte les 8 règles de répartition configurées par client
                  </p>
                </CardContent>
              </Card>
            )}

            {lines.length > 0 && (
              <>
                {/* Summary cards */}
                {summary && (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Card>
                      <CardContent className="pt-6">
                        <div className="flex items-center gap-2 mb-1">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">Boutiques</span>
                        </div>
                        <div className="text-2xl font-bold">{summary.totalClients}</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-6">
                        <div className="flex items-center gap-2 mb-1">
                          <Package className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">Produits</span>
                        </div>
                        <div className="text-2xl font-bold">{summary.totalProducts}</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-6">
                        <div className="flex items-center gap-2 mb-1">
                          <ArrowDown className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">Pièces commandées</span>
                        </div>
                        <div className="text-2xl font-bold">{formatNumber(summary.totalOriginal)}</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-6">
                        <div className="flex items-center gap-2 mb-1">
                          <TrendingDown className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">Pièces allouées</span>
                        </div>
                        <div
                          className={cn(
                            "text-2xl font-bold",
                            summary.totalAllocated < summary.totalOriginal ? "text-amber-600" : "text-emerald-600"
                          )}
                        >
                          {formatNumber(summary.totalAllocated)}
                        </div>
                        {summary.totalAllocated < summary.totalOriginal && (
                          <p className="text-xs text-muted-foreground mt-1">
                            -{formatNumber(summary.totalOriginal - summary.totalAllocated)} pièces (
                            {Math.round(((summary.totalOriginal - summary.totalAllocated) / summary.totalOriginal) * 100)}%)
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
                      <ScrollArea className="max-h-48">
                        <ul className="space-y-1">
                          {warnings.map((w, i) => (
                            <li key={i} className="text-xs text-amber-700 flex items-start gap-2">
                              <span className="mt-1 h-1 w-1 rounded-full bg-amber-400 shrink-0" />
                              {w}
                            </li>
                          ))}
                        </ul>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                )}

                {/* View toggle + search */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex rounded-lg border bg-muted p-0.5">
                      <button
                        onClick={() => { setViewMode("client"); setResultSearch(""); }}
                        className={cn(
                          "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                          viewMode === "client"
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <Store className="h-3.5 w-3.5" />
                        Par boutique
                        <Badge variant="secondary" className="text-[10px] h-5 px-1.5">{clientGroups.size}</Badge>
                      </button>
                      <button
                        onClick={() => { setViewMode("product"); setResultSearch(""); }}
                        className={cn(
                          "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                          viewMode === "product"
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <Package className="h-3.5 w-3.5" />
                        Par produit
                        <Badge variant="secondary" className="text-[10px] h-5 px-1.5">{productGroups.size}</Badge>
                      </button>
                    </div>
                    <span className="text-xs text-muted-foreground ml-2">
                      {lines.length} lignes · cliquez sur une quantité pour la modifier
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Filtre réception (comme dans Comparaison) */}
                    <div className="inline-flex rounded-lg border bg-muted/50 p-0.5 text-sm">
                      {(
                        [
                          ["all", "Tout"],
                          ["received", "Réceptionné"],
                          ["not_received", "Non réceptionné"],
                        ] as ["all" | "received" | "not_received", string][]
                      ).map(([val, label]) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setReceptionFilter(val)}
                          className={cn(
                            "rounded-md px-2.5 py-1.5 font-medium transition-colors",
                            receptionFilter === val
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder={viewMode === "client" ? "Filtrer les boutiques..." : "Filtrer les produits..."}
                        value={resultSearch}
                        onChange={(e) => setResultSearch(e.target.value)}
                        className="pl-9 w-56 h-9 text-sm"
                      />
                    </div>
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
                </div>

                {/* Client view */}
                {viewMode === "client" && (
                  <div className="space-y-3">
                    {filteredClientGroups.length === 0 ? (
                      <Card className="border-dashed">
                        <CardContent className="flex items-center justify-center py-8">
                          <p className="text-sm text-muted-foreground">
                            Aucune boutique ne correspond à la recherche
                          </p>
                        </CardContent>
                      </Card>
                    ) : (
                      filteredClientGroups.map(([clientId, group]) => (
                        <ClientGroup
                          key={clientId}
                          clientId={clientId}
                          clientName={group.clientName}
                          lines={group.lines}
                          onLineChange={handleLineChange}
                        />
                      ))
                    )}
                  </div>
                )}

                {/* Product view */}
                {viewMode === "product" && (
                  <div className="space-y-3">
                    {filteredProductGroups.length === 0 ? (
                      <Card className="border-dashed">
                        <CardContent className="flex items-center justify-center py-8">
                          <p className="text-sm text-muted-foreground">
                            Aucun produit ne correspond à la recherche
                          </p>
                        </CardContent>
                      </Card>
                    ) : (
                      filteredProductGroups.map(([productId, group]) => (
                        <ProductGroup
                          key={productId}
                          reference={group.reference}
                          color={group.color}
                          lines={group.lines}
                          received={receivedByProduct[productId]}
                          onLineChange={handleLineChange}
                          onDistributeSurplus={() => distributeSurplus(productId)}
                        />
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

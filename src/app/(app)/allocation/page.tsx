"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
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
  Upload,
  Truck,
  History,
  Pencil,
  X,
  Filter,
  Store,
  Search,
  PackagePlus,
} from "lucide-react";
import { cn, sumQuantities, formatNumber, type SizeQuantities } from "@/lib/utils";
import { distributeSurplus as distributeSurplusRule } from "@/lib/allocation/surplus";
import Link from "next/link";
import { toast } from "sonner";
import * as XLSX from "xlsx";

// Ligne d'un fichier EAN à rejouer (cf. bouton « Importer une répartition »).
interface ImportedRow {
  clientCode: string;
  reference: string;
  color: string;
  size: string;
  qty: number;
}

// Produit reçu ajoutable à une répartition en cours de modification (reprise).
interface AddableProduct {
  productId: string;
  reference: string;
  color: string;
  colorLabel: string | null;
  totalReceived: number;
}

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
  /** Fournisseur(s) des produits répartis — pour repérer une session d'un coup d'œil. */
  suppliers?: string[];
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

// Détail des écarts d'une ligne, taille par taille : combien de pièces ont été RETIRÉES et
// combien AJOUTÉES. Le net seul (commandé − alloué) masque le cas mixte : perdre 3 pièces
// sur M et en gagner 1 sur XL donne un net de -2, ce qui cache l'ajout.
function sizeDelta(line: SimulationLine): { minusPieces: number; plusPieces: number } {
  let minusPieces = 0;
  let plusPieces = 0;
  const sizes = new Set([...Object.keys(line.original), ...Object.keys(line.allocated)]);
  for (const s of sizes) {
    const o = line.original[s] || 0;
    const a = line.allocated[s] || 0;
    if (o > a) minusPieces += o - a;
    else if (a > o) plusPieces += a - o;
  }
  return { minusPieces, plusPieces };
}

function EditableCell({
  value,
  original,
  max,
  onChange,
}: {
  value: number;
  original: number;
  /** Plafond de saisie. Permet d'AJOUTER du surplus à la main au-delà de la commande :
   *  = quantité actuelle + reliquat reçu non alloué sur cette taille. Par défaut, la
   *  commande (aucun surplus disponible → on ne peut que retirer). */
  max?: number;
  onChange: (v: number) => void;
}) {
  const ceiling = Math.max(max ?? original, 0);
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
    // Borné par le reçu (on ne peut pas allouer plus que ce qui existe physiquement).
    if (!isNaN(n) && n >= 0 && n <= ceiling) {
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
        max={ceiling}
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

  // Rouge = pièces retirées ; vert = pièces AJOUTÉES au-dessus de la commande (surplus
  // réparti). Dans les deux cas la quantité commandée est rappelée en dessous.
  const isReduced = original > value;
  const isAdded = value > original;
  return (
    <span
      className={cn(
        "cursor-pointer hover:bg-muted rounded px-1 py-0.5 transition-colors inline-block min-w-[2rem] text-center",
        isReduced && "text-red-600 font-medium",
        isAdded && "text-emerald-600 font-semibold"
      )}
      onClick={() => {
        setDraft(String(value));
        setEditing(true);
      }}
      title={
        isAdded
          ? `+${value - original} en plus (commandé : ${original})`
          : isReduced
            ? `-${original - value} retiré(s) (commandé : ${original})`
            : "Cliquer pour modifier"
      }
    >
      {/* La valeur affichée est le TOTAL alloué (pas un delta) → pas de « + ». */}
      {value > 0 ? value : "-"}
      {/* Quantité commandée rappelée en dessous, SANS rature (illisible en petit). */}
      {(isReduced || isAdded) && (
        <span className="block text-[10px] font-normal text-muted-foreground">{original}</span>
      )}
    </span>
  );
}

// ─── Client group (boutique) ─────────────────────────────────

function ClientGroup({
  clientId,
  clientName,
  lines,
  remainingByProduct,
  onLineChange,
}: {
  clientId: string;
  clientName: string;
  lines: SimulationLine[];
  /** Reliquat reçu non alloué par produit/taille → plafond de saisie manuelle. */
  remainingByProduct: Record<string, Record<string, number>>;
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
                  // Détail : pièces retirées / ajoutées, taille par taille (une ligne peut
                  // perdre sur une taille et gagner sur une autre → le net seul le masque).
                  const { minusPieces, plusPieces } = sizeDelta(line);
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
                              // Ajout MANUEL du surplus : plafond = quantité actuelle +
                              // reliquat reçu non encore alloué sur cette taille.
                              max={alloc + (remainingByProduct[line.productId]?.[size] ?? 0)}
                              onChange={(v) => onLineChange(lineKey, size, v)}
                            />
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right font-medium text-sm">
                        {formatNumber(allocTotal)}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {/* Écart NET (avec %) + détail des pièces retirées / ajoutées :
                            une même ligne peut perdre sur une taille et gagner sur une autre. */}
                        <span
                          className={cn(
                            diff > 0
                              ? "text-red-600 font-medium"
                              : diff < 0
                                ? "text-emerald-600 font-medium"
                                : "text-muted-foreground"
                          )}
                        >
                          {diff === 0
                            ? "—"
                            : diff > 0
                              ? `-${diff} (-${origTotal > 0 ? Math.round((diff / origTotal) * 100) : 0}%)`
                              : `+${-diff} (+${origTotal > 0 ? Math.round((-diff / origTotal) * 100) : 0}%)`}
                        </span>
                        {minusPieces > 0 && plusPieces > 0 && (
                          <span className="block text-[10px] font-normal">
                            <span className="text-red-600">-{minusPieces}</span>
                            <span className="text-muted-foreground"> / </span>
                            <span className="text-emerald-600">+{plusPieces}</span>
                          </span>
                        )}
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
  sampled,
  allocatedElsewhere,
  remainingByProduct,
  onLineChange,
  onDistributeSurplus,
}: {
  reference: string;
  color: string;
  lines: SimulationLine[];
  received?: SizeQuantities;
  /** Pièces mises de côté (échantillons contrôle qualité) → retirées du disponible. */
  sampled?: SizeQuantities;
  /** Déjà réparti dans d'AUTRES répartitions validées → retiré du disponible. */
  allocatedElsewhere?: SizeQuantities;
  /** Reliquat reçu non alloué par produit/taille → plafond de saisie manuelle. */
  remainingByProduct: Record<string, Record<string, number>>;
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
  // Échantillons prélevés : jamais livrés → expliquent qu'on alloue moins que le reçu.
  const totalSampled = sampled ? sumQuantities(sampled) : 0;
  // Pièces déjà engagées dans d'AUTRES répartitions validées → retirées du disponible.
  const totalElsewhere = allocatedElsewhere ? sumQuantities(allocatedElsewhere) : 0;
  // Disponible PAR TAILLE = reçu − échantillons − déjà engagé ailleurs (jamais négatif).
  // ⚠️ C'est cette base — et non le reçu — qui doit servir au surplus : sinon on proposait
  // de « répartir » des pièces déjà engagées (bouton « +117 » alors que Dispo = 0).
  const availableBySize: SizeQuantities = {};
  for (const [sz, n] of Object.entries(received || {})) {
    const left = n - (sampled?.[sz] || 0) - (allocatedElsewhere?.[sz] || 0);
    if (left > 0) availableBySize[sz] = left;
  }
  const totalAvailable = sumQuantities(availableBySize);
  // Surplus RÉPARTISSABLE = reçu − déjà alloué, uniquement sur les tailles commandées
  // (une taille reçue que personne n'a commandée n'est pas auto-répartissable).
  const allocBySize: Record<string, number> = {};
  const orderedBySize: Record<string, number> = {};
  for (const l of lines) {
    for (const [s, q] of Object.entries(l.allocated)) allocBySize[s] = (allocBySize[s] || 0) + q;
    for (const [s, q] of Object.entries(l.original)) orderedBySize[s] = (orderedBySize[s] || 0) + q;
  }
  const surplusTotal = Object.entries(availableBySize).reduce(
    (s, [sz, r]) => s + ((orderedBySize[sz] || 0) > 0 ? Math.max(0, r - (allocBySize[sz] || 0)) : 0),
    0
  );
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
            {totalSampled > 0 && (
              <span
                className="block text-[10px] text-amber-600"
                title="Pièces mises de côté pour le contrôle qualité — retirées du disponible à la répartition"
              >
                dont {formatNumber(totalSampled)} éch.
              </span>
            )}
            {totalElsewhere > 0 && (
              <span
                className="block text-[10px] text-violet-600"
                title="Pièces déjà réparties dans une autre répartition VALIDÉE — retirées du disponible"
              >
                dont {formatNumber(totalElsewhere)} engagé
              </span>
            )}
          </div>
          {(totalElsewhere > 0 || totalSampled > 0) && (
            <div className="text-right">
              <span className="text-xs text-muted-foreground">Dispo</span>
              <span
                className={cn(
                  "block font-medium",
                  totalAvailable === 0 ? "text-red-600" : "text-foreground"
                )}
                title="Disponible réel = reçu − échantillons − déjà réparti dans les répartitions validées"
              >
                {formatNumber(totalAvailable)}
              </span>
            </div>
          )}
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
                  // Détail : pièces retirées / ajoutées, taille par taille (une ligne peut
                  // perdre sur une taille et gagner sur une autre → le net seul le masque).
                  const { minusPieces, plusPieces } = sizeDelta(line);
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
                              // Ajout MANUEL du surplus : plafond = quantité actuelle +
                              // reliquat reçu non encore alloué sur cette taille.
                              max={alloc + (remainingByProduct[line.productId]?.[size] ?? 0)}
                              onChange={(v) => onLineChange(lineKey, size, v)}
                            />
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right font-medium text-sm">
                        {formatNumber(allocTotal)}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {/* Écart NET (avec %) + détail des pièces retirées / ajoutées :
                            une même ligne peut perdre sur une taille et gagner sur une autre. */}
                        <span
                          className={cn(
                            diff > 0
                              ? "text-red-600 font-medium"
                              : diff < 0
                                ? "text-emerald-600 font-medium"
                                : "text-muted-foreground"
                          )}
                        >
                          {diff === 0
                            ? "—"
                            : diff > 0
                              ? `-${diff} (-${origTotal > 0 ? Math.round((diff / origTotal) * 100) : 0}%)`
                              : `+${-diff} (+${origTotal > 0 ? Math.round((-diff / origTotal) * 100) : 0}%)`}
                        </span>
                        {minusPieces > 0 && plusPieces > 0 && (
                          <span className="block text-[10px] font-normal">
                            <span className="text-red-600">-{minusPieces}</span>
                            <span className="text-muted-foreground"> / </span>
                            <span className="text-emerald-600">+{plusPieces}</span>
                          </span>
                        )}
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
              {/* Totaux PAR TAILLE : commandé (toutes boutiques) vs reçu fournisseur, et
                  l'écart — c'est ce qui révèle qu'une taille est en manque ou sur-livrée. */}
              <tfoot className="border-t-2 bg-muted/40 text-xs">
                <tr>
                  <td className="px-3 py-1.5 font-semibold">Cmd. clients</td>
                  {sizes.map((s) => (
                    <td key={s} className="px-1 py-1.5 text-center tabular-nums">
                      {orderedBySize[s] || 0}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">
                    {formatNumber(totalOriginal)}
                  </td>
                  <td colSpan={2} />
                </tr>
                <tr>
                  <td className="px-3 py-1.5 font-semibold">Reçu fourn.</td>
                  {sizes.map((s) => (
                    <td key={s} className="px-1 py-1.5 text-center tabular-nums">
                      {received?.[s] ?? 0}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">
                    {formatNumber(totalReceived)}
                  </td>
                  <td colSpan={2} />
                </tr>
                <tr>
                  <td className="px-3 py-1.5 font-semibold">Écart</td>
                  {sizes.map((s) => {
                    const gap = (received?.[s] ?? 0) - (orderedBySize[s] || 0);
                    return (
                      <td
                        key={s}
                        className={cn(
                          "px-1 py-1.5 text-center font-medium tabular-nums",
                          gap < 0 ? "text-red-600" : gap > 0 ? "text-emerald-600" : "text-muted-foreground"
                        )}
                        title={gap > 0 ? "Sur-livré sur cette taille" : gap < 0 ? "Manque sur cette taille" : ""}
                      >
                        {gap === 0 ? "—" : gap > 0 ? `+${gap}` : gap}
                      </td>
                    );
                  })}
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-semibold tabular-nums",
                      demandGap < 0 ? "text-red-600" : demandGap > 0 ? "text-emerald-600" : "text-muted-foreground"
                    )}
                  >
                    {demandGap === 0 ? "—" : demandGap > 0 ? `+${formatNumber(demandGap)}` : formatNumber(demandGap)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
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
  const { activeSeason, setActiveSeasonId } = useSeason();
  const [lines, setLines] = useState<SimulationLine[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [clientImpacts, setClientImpacts] = useState<ClientImpact[]>([]);
  const [summary, setSummary] = useState<SimulationSummary | null>(null);
  // Reçu (réception fournisseur) et EAN par produit → écart demande/réception + export EAN.
  const [receivedByProduct, setReceivedByProduct] = useState<Record<string, SizeQuantities>>({});
  // Disponible RÉEL = reçu − échantillons − déjà réparti dans d'autres répartitions validées.
  // Plafonne les ajustements manuels et le surplus (le reçu seul laisserait redistribuer des
  // pièces déjà engagées auprès des boutiques).
  const [availableByProduct, setAvailableByProduct] = useState<Record<string, SizeQuantities>>({});
  const [allocatedElsewhereByProduct, setAllocatedElsewhereByProduct] = useState<
    Record<string, SizeQuantities>
  >({});
  const [eansByProduct, setEansByProduct] = useState<Record<string, Record<string, string>>>({});
  const [rankingByClient, setRankingByClient] = useState<Record<string, number>>({});
  const [excludedSizesByClient, setExcludedSizesByClient] = useState<Record<string, string[]>>({});
  const [sampledByProduct, setSampledByProduct] = useState<Record<string, SizeQuantities>>({});
  // Périmètre de validation : on simule sur TOUTE la demande (sinon le stock reçu serait
  // réparti sur un sous-ensemble et les coupes seraient fausses), mais on ne valide que les
  // fournisseurs / catalogues choisis. Vide = tout.
  const [supplierIdsByProduct, setSupplierIdsByProduct] = useState<Record<string, string[]>>({});
  const [catalogIdByOrder, setCatalogIdByOrder] = useState<Record<string, string | null>>({});
  // Reprise d'une répartition : produits reçus après coup, ajoutables à la répartition.
  // `importedRows` = fichier rejoué (conservé pour pouvoir relancer avec un produit en plus).
  const [addableProducts, setAddableProducts] = useState<AddableProduct[]>([]);
  const [importedRows, setImportedRows] = useState<ImportedRow[] | null>(null);
  const [addedProductIds, setAddedProductIds] = useState<string[]>([]);
  const [addSearch, setAddSearch] = useState(""); // saisie du champ « Ajouter un produit reçu »
  const [validateSuppliers, setValidateSuppliers] = useState<string[]>([]);
  const [validateCatalogs, setValidateCatalogs] = useState<string[]>([]);
  // Périmètre de l'EXPORT EAN — distinct de celui de la validation (mêmes règles que sur
  // une session validée : fournisseurs + boutiques). N'agit que sur le fichier. Vide = tout.
  const [exportSuppliers, setExportSuppliers] = useState<string[]>([]);
  const [exportClients, setExportClients] = useState<string[]>([]);
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
  // Reprise d'une session VALIDÉE : la page de détail dépose ici {seasonId, rows} et
  // renvoie sur cet écran, qui rejoue les lignes (même chemin que l'import de fichier).
  const REOPEN_KEY = "gestlog:allocation:reopen";
  const restoredRef = useRef(false);
  const seasonIdRef = useRef<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  // Session d'origine quand la simulation vient d'une REPRISE : la validation la met à jour
  // au lieu de créer un doublon. Persisté avec la simulation (survit à la navigation).
  const [reopenSourceId, setReopenSourceId] = useState<string | null>(null);

  useEffect(() => {
    if (restoredRef.current || !activeSeason) return;

    // Reprise d'une session validée — PRIORITAIRE sur la restauration normale.
    try {
      const rawReopen = sessionStorage.getItem(REOPEN_KEY);
      if (rawReopen) {
        const h = JSON.parse(rawReopen);
        if (h && Array.isArray(h.rows) && h.rows.length > 0) {
          // Bascule d'abord sur la saison de la session (sinon 0 commande appariée) : on
          // NE marque PAS restoredRef → l'effet se relance sur la nouvelle saison.
          if (h.seasonId && h.seasonId !== activeSeason.id) {
            setActiveSeasonId(h.seasonId);
            return;
          }
          sessionStorage.removeItem(REOPEN_KEY);
          restoredRef.current = true;
          seasonIdRef.current = activeSeason.id;
          const srcId = typeof h.sessionId === "string" ? h.sessionId : null;
          setReopenSourceId(srcId);
          runSimulation(h.rows as ImportedRow[], [], srcId);
          return;
        }
        sessionStorage.removeItem(REOPEN_KEY);
      }
    } catch {
      /* handoff illisible → on ignore et on restaure normalement */
    }

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
      setAvailableByProduct(s.availableByProduct || {});
      setAllocatedElsewhereByProduct(s.allocatedElsewhereByProduct || {});
      setEansByProduct(s.eansByProduct || {});
      setRankingByClient(s.rankingByClient || {});
      setExcludedSizesByClient(s.excludedSizesByClient || {});
      setSampledByProduct(s.sampledByProduct || {});
      setSupplierIdsByProduct(s.supplierIdsByProduct || {});
      setCatalogIdByOrder(s.catalogIdByOrder || {});
      setManualEdits(s.manualEdits || 0);
      setReopenSourceId(s.reopenSourceId ?? null);
      setImportedRows(s.importedRows ?? null);
      setAddedProductIds(s.addedProductIds ?? []);
      setAddableProducts(s.addableProducts ?? []);
      const f = s.filters || {};
      setSelectedCatalog(f.selectedCatalog ?? "ALL");
      setSelectedClients(f.selectedClients ?? []);
      setSelectedSuppliers(f.selectedSuppliers ?? []);
      setOrderType(f.orderType ?? "COMMANDE");
      setProductSearch(f.productSearch ?? "");
      setViewMode(f.viewMode ?? "client");
      setReceptionFilter(f.receptionFilter ?? "all");
      setValidateSuppliers(f.validateSuppliers ?? []);
      setValidateCatalogs(f.validateCatalogs ?? []);
      setExportSuppliers(f.exportSuppliers ?? []);
      setExportClients(f.exportClients ?? []);
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
    setAvailableByProduct({});
    setAllocatedElsewhereByProduct({});
    setEansByProduct({});
    setRankingByClient({});
    setExcludedSizesByClient({});
    setSampledByProduct({});
    setSupplierIdsByProduct({});
    setCatalogIdByOrder({});
    setValidateSuppliers([]);
    setValidateCatalogs([]);
    setExportSuppliers([]);
    setExportClients([]);
    setReopenSourceId(null);
    setImportedRows(null);
    setAddedProductIds([]);
    setAddableProducts([]);
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
          availableByProduct,
          allocatedElsewhereByProduct,
          eansByProduct,
          rankingByClient,
          excludedSizesByClient,
          sampledByProduct,
          supplierIdsByProduct,
          catalogIdByOrder,
          manualEdits,
          reopenSourceId,
          importedRows,
          addedProductIds,
          addableProducts,
          filters: {
            selectedCatalog,
            selectedClients,
            selectedSuppliers,
            orderType,
            productSearch,
            viewMode,
            receptionFilter,
            validateSuppliers,
            validateCatalogs,
            exportSuppliers,
            exportClients,
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
    availableByProduct,
    allocatedElsewhereByProduct,
    eansByProduct,
    rankingByClient,
    excludedSizesByClient,
    sampledByProduct,
    supplierIdsByProduct,
    catalogIdByOrder,
    manualEdits,
    reopenSourceId,
    importedRows,
    addedProductIds,
    addableProducts,
    selectedCatalog,
    selectedClients,
    selectedSuppliers,
    orderType,
    productSearch,
    viewMode,
    receptionFilter,
    validateSuppliers,
    validateCatalogs,
    exportSuppliers,
    exportClients,
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

  // `imported` = lignes d'un fichier EAN à rejouer. Dans ce cas les filtres de l'écran ne
  // sont PAS appliqués : ils restreindraient la demande et écarteraient des lignes du
  // fichier. Le fichier définit la répartition, il doit pouvoir se poser en entier.
  // `sourceSessionId` : session rejouée en reprise — à exclure du stock déjà consommé.
  // Passé EXPLICITEMENT (et non lu depuis `reopenSourceId`) car l'état n'est pas encore
  // à jour quand la reprise déclenche la simulation dans le même rendu.
  const runSimulation = async (
    imported?: ImportedRow[],
    addIds?: string[],
    sourceSessionId?: string | null
  ) => {
    if (!activeSeason) return;
    setSimulating(true);
    setManualEdits(0);
    // Une simulation lancée à la main (pas une reprise) repart sur une nouvelle session.
    if (!imported) {
      setReopenSourceId(null);
      setImportedRows(null);
      setAddedProductIds([]);
      setAddableProducts([]);
    } else {
      // Reprise : on garde le fichier + les produits ajoutés pour pouvoir relancer.
      setImportedRows(imported);
      setAddedProductIds(addIds ?? []);
    }
    try {
      const payload: Record<string, unknown> = {
        seasonId: activeSeason.id,
        orderType,
      };
      if (imported) {
        payload.importedAllocation = imported;
        if (addIds && addIds.length > 0) payload.addProductIds = addIds;
        const src = sourceSessionId ?? reopenSourceId;
        if (src) payload.excludeSessionId = src;
      } else {
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
      setAvailableByProduct(data.availableByProduct || {});
      setAllocatedElsewhereByProduct(data.allocatedElsewhereByProduct || {});
      setEansByProduct(data.eansByProduct || {});
      setSupplierIdsByProduct(data.supplierIdsByProduct || {});
      setAddableProducts(data.addableProducts || []);
      setCatalogIdByOrder(data.catalogIdByOrder || {});
      setRankingByClient(data.rankingByClient || {});
      setExcludedSizesByClient(data.excludedSizesByClient || {});
      setSampledByProduct(data.sampledByProduct || {});
      toast.success(imported ? "Répartition reprise du fichier" : "Simulation terminée", {
        description: imported
          ? `${data.lines?.length || 0} ligne(s) — l'alloué vient du fichier, aucun recalcul`
          : `${data.lines?.length || 0} lignes calculées`,
      });
    } catch (e) {
      toast.error("Erreur lors de la simulation", {
        description: String(e),
      });
    } finally {
      setSimulating(false);
    }
  };

  // Reprise : ajoute un produit reçu (après la répartition) et relance en le répartissant.
  // Relancer recalcule les lignes du fichier → un garde-fou prévient si des ajustements
  // manuels ont été faits depuis la reprise (ils seraient perdus).
  const addReceivedProduct = (productId: string) => {
    if (!importedRows || !productId) return;
    if (
      manualEdits > 0 &&
      !window.confirm(
        "Ajouter ce produit relance la répartition et annulera les ajustements manuels faits depuis la reprise. Continuer ?"
      )
    )
      return;
    setAddSearch("");
    runSimulation(importedRows, [...addedProductIds, productId], reopenSourceId);
  };

  // Libellé lisible d'un produit ajoutable (sert de valeur au champ de recherche/datalist).
  const addableLabel = (p: AddableProduct) =>
    `${p.reference} / ${p.colorLabel || p.color} · ${p.totalReceived} reçu`;

  // Reprise d'une répartition depuis son fichier EAN (celui du bouton « Export EAN »).
  const importAllocationFile = async (file: File) => {
    setReopenSourceId(null); // un fichier importé = nouvelle session, pas une reprise
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error("Fichier vide");
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
      if (raw.length === 0) throw new Error("Aucune ligne dans le fichier");

      // En-têtes repérés PAR NOM, sans accent ni casse (l'ordre des colonnes n'importe pas).
      const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
      const cols = Object.keys(raw[0]);
      const find = (...cands: string[]) =>
        cols.find((c) => cands.some((x) => norm(c) === x)) ||
        cols.find((c) => cands.some((x) => norm(c).includes(x)));
      const cCode = find("code boutique");
      const cRef = find("reference");
      const cColor = find("couleur");
      const cSize = find("taille");
      const cQty = find("quantite");
      const missing = [
        !cCode && "Code boutique",
        !cRef && "Référence",
        !cColor && "Couleur",
        !cSize && "Taille",
        !cQty && "Quantité",
      ].filter(Boolean);
      if (missing.length > 0) throw new Error(`Colonne(s) introuvable(s) : ${missing.join(", ")}`);

      const rows: ImportedRow[] = [];
      for (const r of raw) {
        const qtyRaw = r[cQty!];
        const qty = typeof qtyRaw === "number" ? qtyRaw : parseInt(String(qtyRaw ?? "0"), 10);
        if (!qty || isNaN(qty) || qty <= 0) continue;
        const clientCode = String(r[cCode!] ?? "").trim();
        const reference = String(r[cRef!] ?? "").trim();
        const size = String(r[cSize!] ?? "").trim();
        if (!clientCode || !reference || !size) continue;
        rows.push({ clientCode, reference, color: String(r[cColor!] ?? "").trim(), size, qty });
      }
      if (rows.length === 0) throw new Error("Aucune quantité exploitable dans le fichier");
      await runSimulation(rows);
    } catch (e) {
      toast.error("Import impossible", { description: String(e instanceof Error ? e.message : e) });
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

  // Répartit le SURPLUS reçu (pièces disponibles au-delà de ce qui est déjà alloué) d'un
  // produit entre les boutiques, en DEUX temps :
  //   1) on COMBLE d'abord les boutiques coupées (la plus coupée en relatif d'abord, rang
  //      pour départager), jusqu'à ramener chacune à sa commande ;
  //   2) le reliquat éventuel est réparti AU-DELÀ des commandes, au prorata.
  // Contrainte absolue : jamais une taille que la boutique n'a pas commandée, jamais plus
  // que le reçu de la taille.
  // Répartit le surplus d'un produit. Logique métier (règles + tests) dans
  // src/lib/allocation/surplus.ts — ici on ne fait que brancher l'état de l'écran.
  const distributeSurplus = (productId: string) => {
    // Surplus borné au DISPONIBLE, pas au reçu (cf. stockBase).
    const received = stockBase[productId] || {};
    const productLines = lines.filter((l) => l.productId === productId);
    if (productLines.length === 0) return;

    const res = distributeSurplusRule(
      productLines.map((l) => ({
        key: `${l.clientId}:${l.clientOrderId}:${l.productId}`,
        original: l.original,
        allocated: l.allocated,
        ranking: rankingByClient[l.clientId] ?? 9999,
        excludedSizes: excludedSizesByClient[l.clientId] ?? [],
      })),
      received
    );

    const added = res.filledGaps + res.beyond;
    if (added === 0) {
      toast.info("Aucun surplus répartissable", {
        description: res.leftover
          ? `${res.leftover} pièce(s) disponibles, mais uniquement sur des tailles qu'aucune boutique en écart n'a commandées.`
          : "Aucune pièce disponible au-delà de ce qui est déjà alloué.",
      });
      return;
    }

    setLines((prev) =>
      prev.map((l) => {
        const k = `${l.clientId}:${l.clientOrderId}:${l.productId}`;
        const newAllocated = res.allocByKey.get(k);
        if (!newAllocated) return l;
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
          status:
            newTotal === 0 ? ("ANNULE" as const) : l.status === "ANNULE" ? ("LIVRABLE" as const) : l.status,
        };
      })
    );
    setManualEdits((e) => e + 1);
    const bits: string[] = [];
    if (res.filledGaps > 0) bits.push(`${res.filledGaps} pour combler les écarts`);
    if (res.beyond > 0) bits.push(`${res.beyond} au-delà des commandes (aucun écart restant)`);
    if (res.leftover > 0) bits.push(`${res.leftover} laissée(s) en stock`);
    toast.success(`Surplus réparti : +${added} pièce(s)`, { description: bits.join(" · ") });
  };

  // Lignes réellement validées : filtrées par fournisseur (produit fourni par l'un des
  // fournisseurs choisis) et par catalogue (commande rattachée à l'un des catalogues
  // choisis). Une liste vide = aucun filtre = tout.
  const linesToValidate = useMemo(() => {
    if (validateSuppliers.length === 0 && validateCatalogs.length === 0) return lines;
    return lines.filter((l) => {
      if (validateSuppliers.length > 0) {
        const sups = supplierIdsByProduct[l.productId] || [];
        if (!sups.some((s) => validateSuppliers.includes(s))) return false;
      }
      if (validateCatalogs.length > 0) {
        const cat = catalogIdByOrder[l.clientOrderId] ?? null;
        // Sans catalogue (réassort, ou jumelle TIO introuvable) → exclu dès qu'on filtre.
        if (!cat || !validateCatalogs.includes(cat)) return false;
      }
      return true;
    });
  }, [lines, validateSuppliers, validateCatalogs, supplierIdsByProduct, catalogIdByOrder]);

  const validateAllocation = async () => {
    if (!activeSeason || lines.length === 0) return;
    if (linesToValidate.length === 0) {
      toast.error("Aucune ligne à valider", {
        description: "Le périmètre choisi (fournisseurs / catalogues) ne contient aucune ligne.",
      });
      return;
    }
    setValidating(true);
    try {
      const res = await fetch("/api/allocation/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seasonId: activeSeason.id,
          ...(reopenSourceId ? { sourceSessionId: reopenSourceId } : {}),
          lines: linesToValidate.map((l) => ({
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
      // Validation partielle (périmètre restreint) → on garde les lignes NON validées à
      // l'écran pour pouvoir enchaîner sur un autre fournisseur / catalogue.
      const validated = new Set(linesToValidate.map((l) => `${l.clientOrderId}__${l.productId}`));
      const rest = lines.filter((l) => !validated.has(`${l.clientOrderId}__${l.productId}`));
      toast.success("Répartition validée", {
        description:
          rest.length > 0
            ? `Session créée avec ${data.lineCount} lignes · ${rest.length} ligne(s) restent à valider`
            : `Session créée avec ${data.lineCount} lignes`,
      });
      if (rest.length > 0) {
        setLines(rest);
        setValidateSuppliers([]);
        setValidateCatalogs([]);
      } else {
        setReopenSourceId(null);
        setLines([]);
        setWarnings([]);
        setClientImpacts([]);
        setSummary(null);
        setManualEdits(0);
      }
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
  // Lignes retenues pour l'export EAN (périmètre fournisseur / boutique). Vide = tout.
  // Mêmes règles que sur une session validée : ces filtres n'agissent que sur le FICHIER,
  // jamais sur le calcul — contrairement aux filtres de simulation, qui restreignent la
  // demande et fausseraient les quantités.
  const exportLines = useMemo(() => {
    if (exportSuppliers.length === 0 && exportClients.length === 0) return lines;
    return lines.filter((l) => {
      if (exportClients.length > 0 && !exportClients.includes(l.clientId)) return false;
      if (exportSuppliers.length > 0) {
        const sups = supplierIdsByProduct[l.productId] || [];
        if (!sups.some((x) => exportSuppliers.includes(x))) return false;
      }
      return true;
    });
  }, [lines, exportSuppliers, exportClients, supplierIdsByProduct]);

  // Boutiques présentes dans la simulation (pour le sélecteur d'export).
  const clientsInSim = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of lines) m.set(l.clientId, l.clientName);
    return [...m.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [lines]);

  const exportEanFile = () => {
    const rows: Record<string, string | number>[] = [];
    let missing = 0;
    for (const l of exportLines) {
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
      toast.error("Aucune quantité allouée à exporter", {
        description:
          exportSuppliers.length || exportClients.length
            ? "Le périmètre d'export choisi (fournisseurs / boutiques) ne contient aucune ligne allouée."
            : undefined,
      });
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

  // Reliquat reçu NON alloué, par produit et par taille. Sert de plafond à la saisie
  // manuelle : on peut ajouter du surplus à la main, mais jamais au-delà du reçu.
  // Recalculé à chaque changement des lignes → suit les ajustements manuels.
  // Base du plafond = DISPONIBLE (reçu − échantillons − déjà réparti ailleurs), pas le reçu :
  // sinon on pourrait réattribuer à la main des pièces déjà engagées dans une répartition
  // validée. Repli sur le reçu pour une simulation restaurée d'avant cette donnée.
  const stockBase = useMemo(
    () => (Object.keys(availableByProduct).length > 0 ? availableByProduct : receivedByProduct),
    [availableByProduct, receivedByProduct]
  );

  const remainingByProduct = useMemo(() => {
    const used: Record<string, Record<string, number>> = {};
    for (const l of lines) {
      const u = (used[l.productId] ||= {});
      for (const [s, q] of Object.entries(l.allocated)) u[s] = (u[s] || 0) + q;
    }
    const out: Record<string, Record<string, number>> = {};
    for (const [pid, stock] of Object.entries(stockBase)) {
      const r: Record<string, number> = {};
      for (const [s, n] of Object.entries(stock)) r[s] = Math.max(0, n - (used[pid]?.[s] || 0));
      out[pid] = r;
    }
    return out;
  }, [lines, stockBase]);

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
  // Dans la vue par boutique, les lignes SONT des produits → même tri alphabétique.
  for (const g of clientGroups.values()) {
    g.lines.sort(
      (a, b) =>
        a.productReference.localeCompare(b.productReference, "fr", { sensitivity: "base", numeric: true }) ||
        a.productColor.localeCompare(b.productColor, "fr", { sensitivity: "base", numeric: true })
    );
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
  // Dans la vue par produit, les lignes SONT des boutiques → ordre alphabétique.
  for (const g of productGroups.values()) {
    g.lines.sort((a, b) =>
      a.clientName.localeCompare(b.clientName, "fr", { sensitivity: "base", numeric: true })
    );
  }

  // Filter + sort client groups
  // Boutiques triées par ORDRE ALPHABÉTIQUE — et non plus par impact : on retrouve ainsi
  // une boutique précise là où on l'attend dans la liste (même choix que pour les produits).
  const filteredClientGroups = (
    (resultSearch && viewMode === "client"
      ? Array.from(clientGroups.entries()).filter(([, g]) =>
          g.clientName.toLowerCase().includes(resultSearch.toLowerCase())
        )
      : Array.from(clientGroups.entries())
    ) as [string, { clientName: string; lines: SimulationLine[] }][]
  ).sort((a, b) =>
    a[1].clientName.localeCompare(b[1].clientName, "fr", { sensitivity: "base", numeric: true })
  );

  // Filter + sort product groups
  // Produits triés par ORDRE ALPHABÉTIQUE (référence puis couleur) — et non plus par
  // impact : on retrouve ainsi un produit précis là où on l'attend dans la liste.
  const filteredProductGroups = (
    (resultSearch && viewMode === "product"
      ? Array.from(productGroups.entries()).filter(([, g]) =>
          g.reference.toLowerCase().includes(resultSearch.toLowerCase()) ||
          g.color.toLowerCase().includes(resultSearch.toLowerCase())
        )
      : Array.from(productGroups.entries())
    ) as [string, { reference: string; color: string; lines: SimulationLine[] }][]
  ).sort(
    (a, b) =>
      a[1].reference.localeCompare(b[1].reference, "fr", { sensitivity: "base", numeric: true }) ||
      a[1].color.localeCompare(b[1].color, "fr", { sensitivity: "base", numeric: true })
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
                    {exportLines.length < lines.length
                      ? `Export EAN (${formatNumber(exportLines.length)})`
                      : "Export EAN"}
                  </Button>
                  <Button
                    size="sm"
                    onClick={validateAllocation}
                    disabled={validating}
                    className="gap-2"
                  >
                    <CheckCircle className="h-4 w-4" />
                    {validating
                      ? "Validation..."
                      : linesToValidate.length < lines.length
                        ? `Valider ${formatNumber(linesToValidate.length)} ligne(s)`
                        : "Valider la répartition"}
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
                  <Card key={session.id} className="transition-colors hover:bg-accent/50">
                    <Link
                      href={`/allocation/sessions/${session.id}`}
                      className="block"
                      aria-label={`Voir le détail de la répartition du ${new Date(session.sessionDate).toLocaleDateString("fr-FR")}`}
                    >
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
                          {/* Fournisseur(s) concerné(s) : repère principal pour retrouver
                              une session (une saison en compte vite plusieurs). */}
                          {session.suppliers && session.suppliers.length > 0 && (
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              <Truck className="h-3 w-3 text-muted-foreground" />
                              {session.suppliers.slice(0, 4).map((s) => (
                                <Badge key={s} variant="outline" className="text-[10px] font-normal">
                                  {s}
                                </Badge>
                              ))}
                              {session.suppliers.length > 4 && (
                                <span className="text-[10px] text-muted-foreground">
                                  +{session.suppliers.length - 4}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {session.notes && (
                          <span className="text-xs text-muted-foreground max-w-[200px] truncate">
                            {session.notes}
                          </span>
                        )}
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </CardContent>
                    </Link>
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

            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button
                onClick={() => runSimulation()}
                disabled={simulating}
                className="gap-2"
                size="lg"
              >
                <Play className="h-4 w-4" />
                {simulating ? "Calcul en cours..." : lines.length > 0 ? "Relancer la simulation" : "Lancer la simulation"}
              </Button>
              <input
                ref={importInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importAllocationFile(f);
                  e.target.value = ""; // permet de réimporter le même fichier
                }}
              />
              <Button
                variant="outline"
                size="lg"
                disabled={simulating}
                onClick={() => importInputRef.current?.click()}
                className="gap-2"
                title="Reprendre une répartition depuis son fichier EAN exporté (ex. après un rafraîchissement)"
              >
                <Upload className="h-4 w-4" />
                Importer une répartition
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
                {/* Périmètre de validation : la simulation porte sur toute la demande, mais
                    on ne valide que les fournisseurs / catalogues choisis. */}
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircle className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Périmètre de validation</span>
                      <span className="text-xs text-muted-foreground">
                        — la simulation reste calculée sur toute la demande
                      </span>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                          Fournisseurs à valider ({validateSuppliers.length === 0 ? "tous" : validateSuppliers.length})
                        </label>
                        <Select
                          value="__placeholder__"
                          onValueChange={(v: string | null) => {
                            if (v && v !== "__placeholder__" && !validateSuppliers.includes(v)) {
                              setValidateSuppliers([...validateSuppliers, v]);
                            }
                          }}
                        >
                          <SelectTrigger className="text-sm">
                            <span className="text-sm text-muted-foreground truncate">Ajouter un fournisseur...</span>
                          </SelectTrigger>
                          <SelectContent>
                            {suppliers
                              .filter((s) => !validateSuppliers.includes(s.id))
                              .map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                  {s.name} ({s.code})
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        {validateSuppliers.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {validateSuppliers.map((id) => (
                              <Badge
                                key={id}
                                variant="secondary"
                                className="text-xs cursor-pointer gap-1"
                                onClick={() => setValidateSuppliers(validateSuppliers.filter((x) => x !== id))}
                              >
                                {suppliers.find((s) => s.id === id)?.name || id}
                                <X className="h-3 w-3" />
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                          Catalogues à valider ({validateCatalogs.length === 0 ? "tous" : validateCatalogs.length})
                        </label>
                        <Select
                          value="__placeholder__"
                          onValueChange={(v: string | null) => {
                            if (v && v !== "__placeholder__" && !validateCatalogs.includes(v)) {
                              setValidateCatalogs([...validateCatalogs, v]);
                            }
                          }}
                        >
                          <SelectTrigger className="text-sm">
                            <span className="text-sm text-muted-foreground truncate">Ajouter un catalogue...</span>
                          </SelectTrigger>
                          <SelectContent>
                            {catalogs
                              .filter((c) => !validateCatalogs.includes(c.id))
                              .map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        {validateCatalogs.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {validateCatalogs.map((id) => (
                              <Badge
                                key={id}
                                variant="secondary"
                                className="text-xs cursor-pointer gap-1"
                                onClick={() => setValidateCatalogs(validateCatalogs.filter((x) => x !== id))}
                              >
                                {catalogs.find((c) => c.id === id)?.name || id}
                                <X className="h-3 w-3" />
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {(validateSuppliers.length > 0 || validateCatalogs.length > 0) && (
                      <p className="text-xs text-muted-foreground mt-3">
                        <strong>{formatNumber(linesToValidate.length)}</strong> ligne(s) sur{" "}
                        {formatNumber(lines.length)} seront validées.
                        {validateCatalogs.length > 0 && (
                          <> Les commandes sans catalogue (réassorts) sont exclues.</>
                        )}
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Périmètre de l'export EAN — distinct de celui de la validation. Mêmes
                    règles que sur une session validée : n'agit que sur le fichier. */}
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2 mb-3">
                      <Barcode className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Périmètre de l&apos;export EAN</span>
                      <span className="text-xs text-muted-foreground">
                        — n&apos;affecte que le fichier, jamais le calcul
                      </span>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                          Fournisseurs ({exportSuppliers.length === 0 ? "tous" : exportSuppliers.length})
                        </label>
                        <Select
                          value="__placeholder__"
                          onValueChange={(v: string | null) => {
                            if (v && v !== "__placeholder__" && !exportSuppliers.includes(v)) {
                              setExportSuppliers([...exportSuppliers, v]);
                            }
                          }}
                        >
                          <SelectTrigger className="text-sm">
                            <span className="text-sm text-muted-foreground truncate">Ajouter un fournisseur...</span>
                          </SelectTrigger>
                          <SelectContent>
                            {suppliers
                              .filter((x) => !exportSuppliers.includes(x.id))
                              .map((x) => (
                                <SelectItem key={x.id} value={x.id}>
                                  {x.name} ({x.code})
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        {exportSuppliers.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {exportSuppliers.map((id) => (
                              <Badge
                                key={id}
                                variant="secondary"
                                className="text-xs cursor-pointer gap-1"
                                onClick={() => setExportSuppliers(exportSuppliers.filter((x) => x !== id))}
                              >
                                {suppliers.find((x) => x.id === id)?.name || id}
                                <X className="h-3 w-3" />
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                          Boutiques ({exportClients.length === 0 ? "toutes" : exportClients.length})
                        </label>
                        <Select
                          value="__placeholder__"
                          onValueChange={(v: string | null) => {
                            if (v && v !== "__placeholder__" && !exportClients.includes(v)) {
                              setExportClients([...exportClients, v]);
                            }
                          }}
                        >
                          <SelectTrigger className="text-sm">
                            <span className="text-sm text-muted-foreground truncate">Ajouter une boutique...</span>
                          </SelectTrigger>
                          <SelectContent>
                            {clientsInSim
                              .filter((c) => !exportClients.includes(c.id))
                              .map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        {exportClients.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {exportClients.map((id) => (
                              <Badge
                                key={id}
                                variant="secondary"
                                className="text-xs cursor-pointer gap-1"
                                onClick={() => setExportClients(exportClients.filter((x) => x !== id))}
                              >
                                {clientsInSim.find((c) => c.id === id)?.name || id}
                                <X className="h-3 w-3" />
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {(exportSuppliers.length > 0 || exportClients.length > 0) && (
                      <p className="text-xs text-muted-foreground mt-3">
                        <strong>{formatNumber(exportLines.length)}</strong> ligne(s) sur{" "}
                        {formatNumber(lines.length)} seront exportées.
                      </p>
                    )}
                  </CardContent>
                </Card>

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
                      onClick={() => runSimulation()}
                      disabled={simulating}
                      className="gap-2"
                    >
                      <Play className="h-4 w-4" />
                      {simulating ? "Calcul..." : "Relancer"}
                    </Button>
                  </div>
                </div>

                {/* Reprise : ajouter un produit reçu après coup (ex. ligne ajoutée en corrigeant
                    une réception) pour le répartir dans cette répartition. */}
                {reopenSourceId && addableProducts.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed bg-muted/30 px-3 py-2">
                    <PackagePlus className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Produit reçu depuis cette répartition ? Cherche-le pour le répartir :
                    </span>
                    <div className="relative w-80">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        list="addable-products"
                        value={addSearch}
                        placeholder={`Rechercher parmi ${addableProducts.length} produit${addableProducts.length > 1 ? "s" : ""} reçu${addableProducts.length > 1 ? "s" : ""}…`}
                        className="pl-9 h-9 text-sm"
                        onChange={(e) => {
                          const v = e.target.value;
                          setAddSearch(v);
                          // Choix d'une suggestion → la valeur = un libellé exact → on ajoute.
                          const match = addableProducts.find((p) => addableLabel(p) === v);
                          if (match) addReceivedProduct(match.productId);
                        }}
                      />
                      <datalist id="addable-products">
                        {addableProducts.map((p) => (
                          <option key={p.productId} value={addableLabel(p)} />
                        ))}
                      </datalist>
                    </div>
                    {addedProductIds.length > 0 && (
                      <Badge variant="secondary">
                        {addedProductIds.length} ajouté{addedProductIds.length > 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>
                )}

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
                          remainingByProduct={remainingByProduct}
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
                          remainingByProduct={remainingByProduct}
                          reference={group.reference}
                          color={group.color}
                          lines={group.lines}
                          received={receivedByProduct[productId]}
                          sampled={sampledByProduct[productId]}
                          allocatedElsewhere={allocatedElsewhereByProduct[productId]}
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

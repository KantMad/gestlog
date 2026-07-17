"use client";

import { useEffect, useState, useMemo, use } from "react";
import Link from "next/link";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Search, Users, Package, ArrowDown, CheckCircle, Pencil, Barcode, X } from "lucide-react";
import { cn, sumQuantities, formatNumber, type SizeQuantities } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { toast } from "sonner";
import * as XLSX from "xlsx";

interface SessionLine {
  id: string;
  clientId: string | null;
  clientName: string;
  productId: string;
  clientCode: string;
  productReference: string;
  productColor: string;
  productColorLabel: string;
  sizeScale: string[];
  original: SizeQuantities;
  allocated: SizeQuantities;
  reduced: SizeQuantities;
  reductionReason: string;
  status: string;
  isManualAdjustment: boolean;
}

interface SupplierEntry {
  id: string;
  code: string;
  name: string;
}

interface SessionMeta {
  id: string;
  seasonName: string;
  status: string;
  notes: string | null;
  sessionDate: string;
}

const STATUS_LABEL: Record<string, string> = {
  VALIDATED: "Validé",
  SIMULATION: "Simulation",
  CANCELLED: "Annulé",
  LIVRABLE: "Livrable",
  EN_ATTENTE: "En attente",
  ANNULE: "Annulé",
};

// Détail taille par taille : l'alloué, et la quantité commandée en dessous quand elle
// diffère (même convention que l'écran Répartition — on ne barre rien, c'est illisible).
function SizeDetail({ line }: { line: SessionLine }) {
  const sizes = line.sizeScale.length
    ? line.sizeScale
    : [...new Set([...Object.keys(line.original), ...Object.keys(line.allocated)])];
  const shown = sizes.filter((s) => (line.original[s] || 0) > 0 || (line.allocated[s] || 0) > 0);
  if (shown.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {shown.map((size) => {
        const orig = line.original[size] || 0;
        const alloc = line.allocated[size] || 0;
        return (
          <span key={size} className="inline-flex items-baseline gap-1 text-xs">
            <span className="text-muted-foreground">{size}</span>
            <span
              className={cn(
                "font-medium tabular-nums",
                alloc < orig && "text-red-600",
                alloc > orig && "text-emerald-600"
              )}
            >
              {alloc}
            </span>
            {alloc !== orig && (
              <span className="text-[10px] text-muted-foreground tabular-nums">/{orig}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

export default function AllocationSessionDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const [session, setSession] = useState<SessionMeta | null>(null);
  const [lines, setLines] = useState<SessionLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [eansByProduct, setEansByProduct] = useState<Record<string, Record<string, string>>>({});
  const [supplierIdsByProduct, setSupplierIdsByProduct] = useState<Record<string, string[]>>({});
  const [suppliers, setSuppliers] = useState<SupplierEntry[]>([]);
  // Périmètre de l'EXPORT uniquement : la session est un instantané figé, filtrer ici ne
  // touche donc jamais au calcul de la répartition. Vide = tout.
  const [exportSuppliers, setExportSuppliers] = useState<string[]>([]);
  const [exportClients, setExportClients] = useState<string[]>([]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/allocation/sessions/${sessionId}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Erreur");
        setSession(data.session);
        setLines(data.lines || []);
        setEansByProduct(data.eansByProduct || {});
        setSupplierIdsByProduct(data.supplierIdsByProduct || {});
        setSuppliers(data.suppliers || []);
        setError(null);
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)))
      .finally(() => setLoading(false));
  }, [sessionId]);

  // Insensible à la casse ET aux accents (« cote » trouve « Côté ville »).
  const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const filtered = useMemo(() => {
    const q = norm(search.trim());
    if (!q) return lines;
    return lines.filter(
      (l) =>
        norm(l.clientName).includes(q) ||
        norm(l.productReference).includes(q) ||
        norm(l.productColor).includes(q)
    );
  }, [lines, search]);

  const totals = useMemo(() => {
    const original = lines.reduce((s, l) => s + sumQuantities(l.original), 0);
    const allocated = lines.reduce((s, l) => s + sumQuantities(l.allocated), 0);
    return {
      original,
      allocated,
      clients: new Set(lines.map((l) => l.clientId)).size,
      products: new Set(lines.map((l) => l.productId)).size,
      manual: lines.filter((l) => l.isManualAdjustment).length,
    };
  }, [lines]);

  const delta = totals.allocated - totals.original;

  // Boutiques présentes dans la session (pour le sélecteur d'export).
  const clientsInSession = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of lines) if (l.clientId) m.set(l.clientId, l.clientName);
    return [...m.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [lines]);

  // Lignes retenues pour l'export (périmètre fournisseur / boutique). Vide = tout.
  const exportLines = useMemo(() => {
    return lines.filter((l) => {
      if (exportClients.length > 0 && (!l.clientId || !exportClients.includes(l.clientId))) return false;
      if (exportSuppliers.length > 0) {
        const sups = supplierIdsByProduct[l.productId] || [];
        if (!sups.some((x) => exportSuppliers.includes(x))) return false;
      }
      return true;
    });
  }, [lines, exportClients, exportSuppliers, supplierIdsByProduct]);

  // Fichier EAN / quantité de la session VALIDÉE (mêmes colonnes que l'export de simulation).
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
            ? "Le périmètre choisi ne contient aucune ligne allouée."
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
    const jour = session ? new Date(session.sessionDate).toISOString().slice(0, 10) : "";
    XLSX.writeFile(wb, `repartition_validee_EAN_${session?.seasonName || ""}_${jour}.xlsx`);
    if (missing > 0) {
      toast.warning(`${missing} ligne(s) sans EAN au référentiel (marquées « MANQUANT_… »)`);
    }
  };

  return (
    <div>
      <Topbar title="Répartition" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="Détail de la répartition"
          description={
            session
              ? `${new Date(session.sessionDate).toLocaleDateString("fr-FR", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })} · saison ${session.seasonName}`
              : "Chargement..."
          }
          action={
            <div className="flex items-center gap-2">
              {!loading && !error && lines.length > 0 && (
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
              )}
              <Link href="/allocation">
                <Button variant="outline" size="sm" className="gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  Retour
                </Button>
              </Link>
            </div>
          }
        />

        {loading ? (
          <Card className="border-dashed">
            <CardContent className="flex items-center justify-center py-16">
              <p className="text-sm text-muted-foreground animate-pulse">Chargement...</p>
            </CardContent>
          </Card>
        ) : error ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <p className="text-sm text-muted-foreground">{error}</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Statut</span>
                  </div>
                  <Badge
                    className={cn(
                      "text-xs",
                      session?.status === "VALIDATED" && "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
                      session?.status === "SIMULATION" && "bg-blue-100 text-blue-700 hover:bg-blue-100",
                      session?.status === "CANCELLED" && "bg-zinc-100 text-zinc-500 hover:bg-zinc-100"
                    )}
                  >
                    {STATUS_LABEL[session?.status || ""] || session?.status}
                  </Badge>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 mb-1">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Boutiques</span>
                  </div>
                  <div className="text-2xl font-bold">{totals.clients}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 mb-1">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Produits</span>
                  </div>
                  <div className="text-2xl font-bold">{totals.products}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 mb-1">
                    <ArrowDown className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Commandé</span>
                  </div>
                  <div className="text-2xl font-bold">{formatNumber(totals.original)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Alloué</span>
                  </div>
                  <div className="text-2xl font-bold">{formatNumber(totals.allocated)}</div>
                  {delta !== 0 && (
                    <p className={cn("text-xs mt-0.5", delta < 0 ? "text-red-600" : "text-emerald-600")}>
                      {delta > 0 ? "+" : ""}
                      {formatNumber(delta)} vs commandé
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            {session?.notes && (
              <Card>
                <CardContent className="py-3 px-4">
                  <p className="text-sm text-muted-foreground">{session.notes}</p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-3">
                  <Barcode className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Périmètre de l&apos;export EAN</span>
                  <span className="text-xs text-muted-foreground">
                    — n&apos;affecte que le fichier, jamais la répartition (elle est figée)
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
                        <span className="text-sm text-muted-foreground truncate">
                          Ajouter un fournisseur...
                        </span>
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
                        <span className="text-sm text-muted-foreground truncate">
                          Ajouter une boutique...
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        {clientsInSession
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
                            {clientsInSession.find((c) => c.id === id)?.name || id}
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
                {suppliers.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-3">
                    Aucun fournisseur rattaché : les commandes fournisseur de cette saison n&apos;ont
                    pas été importées, ou ne contiennent pas ces produits.
                  </p>
                )}
              </CardContent>
            </Card>

            <div className="relative max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher une boutique, une référence..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Boutique</TableHead>
                    <TableHead>Produit</TableHead>
                    <TableHead>Couleur</TableHead>
                    <TableHead>Détail par taille (alloué / commandé)</TableHead>
                    <TableHead className="text-right">Commandé</TableHead>
                    <TableHead className="text-right">Alloué</TableHead>
                    <TableHead className="text-right">Écart</TableHead>
                    <TableHead className="text-center">Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-10">
                        {search ? `Aucune ligne ne correspond à « ${search} ».` : "Aucune ligne dans cette session."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((line) => {
                      const orig = sumQuantities(line.original);
                      const alloc = sumQuantities(line.allocated);
                      const d = alloc - orig;
                      return (
                        <TableRow key={line.id}>
                          <TableCell className="font-medium">
                            <span className="inline-flex items-center gap-1.5">
                              {line.clientName}
                              {line.isManualAdjustment && (
                                <Pencil className="h-3 w-3 text-blue-600" aria-label="Ajusté à la main" />
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{line.productReference}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{line.productColor}</TableCell>
                          <TableCell>
                            <SizeDetail line={line} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{orig}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{alloc}</TableCell>
                          <TableCell
                            className={cn(
                              "text-right tabular-nums",
                              d < 0 && "text-red-600",
                              d > 0 && "text-emerald-600"
                            )}
                          >
                            {d === 0 ? "—" : `${d > 0 ? "+" : ""}${d}`}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className="text-xs">
                              {STATUS_LABEL[line.status] || line.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            {search && filtered.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {formatNumber(filtered.length)} ligne(s) sur {formatNumber(lines.length)}.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

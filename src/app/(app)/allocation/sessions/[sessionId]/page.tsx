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
import { ArrowLeft, Search, Users, Package, ArrowDown, CheckCircle, Pencil } from "lucide-react";
import { cn, sumQuantities, formatNumber, type SizeQuantities } from "@/lib/utils";

interface SessionLine {
  id: string;
  clientId: string | null;
  clientName: string;
  productId: string;
  productReference: string;
  productColor: string;
  sizeScale: string[];
  original: SizeQuantities;
  allocated: SizeQuantities;
  reduced: SizeQuantities;
  reductionReason: string;
  status: string;
  isManualAdjustment: boolean;
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

  useEffect(() => {
    setLoading(true);
    fetch(`/api/allocation/sessions/${sessionId}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Erreur");
        setSession(data.session);
        setLines(data.lines || []);
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
            <Link href="/allocation">
              <Button variant="outline" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Retour
              </Button>
            </Link>
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

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSeason } from "@/lib/season-context";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { FlaskConical, Search, Trash2, Save, X } from "lucide-react";
import { toast } from "sonner";
import { cn, formatNumber, type SizeQuantities } from "@/lib/utils";

interface ReceptionEntry {
  id: string;
  receptionNumber: string;
  receptionDate: string;
  orderNumber: string;
  supplierName: string;
  supplierCode: string;
  products: {
    productId: string;
    reference: string;
    color: string;
    colorLabel: string | null;
    received: SizeQuantities;
  }[];
}

interface SampleEntry {
  id: string;
  supplierReceptionId: string;
  size: string;
  quantity: number;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  product: { id: string; reference: string; color: string; colorLabel: string | null };
}

/** Une ligne de la grille : un coloris d'une référence, dans une réception donnée. */
interface GridRow {
  receptionId: string;
  supplierName: string;
  orderNumber: string;
  productId: string;
  reference: string;
  color: string;
  colorLabel: string | null;
  received: SizeQuantities;
}

// Ordre d'affichage des tailles : lettres dans l'ordre naturel, puis numériques croissantes.
const SIZE_ORDER = ["TU", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL", "6XL"];
const sizeRank = (s: string) => {
  const i = SIZE_ORDER.indexOf(s.toUpperCase());
  if (i >= 0) return i;
  const n = parseInt(s, 10);
  return isNaN(n) ? 900 : 1000 + n;
};

const cellKey = (receptionId: string, productId: string, size: string) =>
  `${receptionId}__${productId}__${size}`;

export default function SamplesPage() {
  const { activeSeason } = useSeason();
  const [receptions, setReceptions] = useState<ReceptionEntry[]>([]);
  const [samples, setSamples] = useState<SampleEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  // Grille : référence saisie + quantités en cours d'édition (clé cellule → quantité).
  const [refQuery, setRefQuery] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    if (!activeSeason) {
      setReceptions([]);
      setSamples([]);
      return;
    }
    setLoading(true);
    fetch(`/api/samples?seasonId=${activeSeason.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setReceptions(d?.receptions || []);
        setSamples(d?.samples || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeSeason]);

  useEffect(() => {
    load();
  }, [load]);

  const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  // Quantités DÉJÀ prélevées, par cellule.
  const existing = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of samples) {
      m[cellKey(s.supplierReceptionId, s.product.id, s.size)] = s.quantity;
    }
    return m;
  }, [samples]);

  // Toutes les références reçues cette saison (pour l'aide à la saisie).
  const allRefs = useMemo(() => {
    const set = new Set<string>();
    for (const r of receptions) for (const p of r.products) set.add(p.reference);
    return [...set].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  }, [receptions]);

  // Lignes de la grille pour la référence saisie : TOUTES ses couleurs, toutes réceptions.
  const gridRows = useMemo<GridRow[]>(() => {
    const q = norm(refQuery.trim());
    if (!q) return [];
    const rows: GridRow[] = [];
    for (const r of receptions) {
      for (const p of r.products) {
        if (!norm(p.reference).includes(q)) continue;
        rows.push({
          receptionId: r.id,
          supplierName: r.supplierName,
          orderNumber: r.orderNumber,
          productId: p.productId,
          reference: p.reference,
          color: p.color,
          colorLabel: p.colorLabel,
          received: p.received,
        });
      }
    }
    return rows.sort(
      (a, b) =>
        a.reference.localeCompare(b.reference, "fr", { numeric: true }) ||
        a.color.localeCompare(b.color, "fr", { numeric: true })
    );
  }, [receptions, refQuery]);

  // Colonnes = union des tailles reçues sur les lignes affichées.
  const gridSizes = useMemo(() => {
    const set = new Set<string>();
    for (const row of gridRows) {
      for (const [s, n] of Object.entries(row.received)) if (n > 0) set.add(s);
    }
    return [...set].sort((a, b) => sizeRank(a) - sizeRank(b));
  }, [gridRows]);

  // Valeur affichée d'une cellule : brouillon si touché, sinon prélèvement existant.
  const cellValue = (k: string) => (k in draft ? draft[k] : existing[k] ? String(existing[k]) : "");

  const setCell = (k: string, v: string) =>
    setDraft((d) => ({ ...d, [k]: v.replace(/[^0-9]/g, "") }));

  // Cellules réellement modifiées (on n'envoie que le delta).
  const changed = useMemo(() => {
    const out: { key: string; qty: number }[] = [];
    for (const [k, v] of Object.entries(draft)) {
      const n = v === "" ? 0 : parseInt(v, 10);
      const before = existing[k] || 0;
      if (!isNaN(n) && n !== before) out.push({ key: k, qty: n });
    }
    return out;
  }, [draft, existing]);

  const saveGrid = async () => {
    if (changed.length === 0) return;
    setSaving(true);
    try {
      const items = changed.map(({ key, qty }) => {
        const [supplierReceptionId, productId, size] = key.split("__");
        return { supplierReceptionId, productId, size, quantity: qty };
      });
      const res = await fetch("/api/samples/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Erreur");
      const bits: string[] = [];
      if (d.saved) bits.push(`${d.saved} ligne(s) enregistrée(s)`);
      if (d.deleted) bits.push(`${d.deleted} retirée(s)`);
      toast.success("Prélèvements enregistrés", {
        description: `${bits.join(" · ")} — retirés du disponible à la répartition.`,
      });
      if (d.errors?.length) {
        toast.warning(`${d.errors.length} cellule(s) ignorée(s)`, { description: d.errors[0] });
      }
      setDraft({});
      load();
    } catch (e) {
      toast.error("Enregistrement impossible", {
        description: String(e instanceof Error ? e.message : e),
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/samples?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Prélèvement retiré", {
        description: "Les pièces redeviennent disponibles à la répartition.",
      });
      load();
    } catch {
      toast.error("Suppression impossible");
    }
  };

  const filtered = useMemo(() => {
    const q = norm(search.trim());
    const rows = q
      ? samples.filter(
          (s) =>
            norm(s.product.reference).includes(q) ||
            norm(s.product.color).includes(q) ||
            norm(s.product.colorLabel || "").includes(q)
        )
      : [...samples];
    return rows.sort(
      (a, b) =>
        a.product.reference.localeCompare(b.product.reference, "fr", { numeric: true }) ||
        a.product.color.localeCompare(b.product.color, "fr", { numeric: true }) ||
        sizeRank(a.size) - sizeRank(b.size)
    );
  }, [samples, search]);

  const totalPieces = samples.reduce((s, x) => s + x.quantity, 0);
  const draftPieces = changed.reduce((s, c) => s + c.qty, 0);

  return (
    <div>
      <Topbar title="Échantillons" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="Échantillons (contrôle qualité)"
          description="Pièces mises de côté pour le siège — elles ne sont jamais livrées et sont retirées du disponible à la répartition"
        />

        {!activeSeason ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <p className="text-sm text-muted-foreground">
                Sélectionnez une saison pour gérer les échantillons
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FlaskConical className="h-4 w-4" />
                  Saisie par référence
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Tape une référence : toutes ses couleurs et toutes les tailles reçues
                  s&apos;affichent. Saisis les quantités à prélever, puis enregistre en une fois.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="relative min-w-[260px] flex-1 max-w-sm">
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                      Référence
                    </label>
                    <Search className="absolute left-2.5 top-[34px] h-4 w-4 text-muted-foreground" />
                    <Input
                      list="samples-refs"
                      value={refQuery}
                      onChange={(e) => setRefQuery(e.target.value.toUpperCase())}
                      placeholder="ex : AMPOML_C012"
                      className="pl-9 h-9 text-sm"
                    />
                    <datalist id="samples-refs">
                      {allRefs.map((r) => (
                        <option key={r} value={r} />
                      ))}
                    </datalist>
                  </div>
                  {refQuery && (
                    <Button variant="ghost" size="sm" onClick={() => setRefQuery("")} className="gap-1.5">
                      <X className="h-4 w-4" />
                      Effacer
                    </Button>
                  )}
                  <div className="ml-auto flex items-center gap-3">
                    {changed.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {changed.length} cellule(s) modifiée(s) · {formatNumber(draftPieces)} pièce(s)
                      </span>
                    )}
                    <Button onClick={saveGrid} disabled={changed.length === 0 || saving} className="gap-2">
                      <Save className="h-4 w-4" />
                      {saving ? "Enregistrement..." : "Enregistrer"}
                    </Button>
                  </div>
                </div>

                {!refQuery ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Saisis une référence pour afficher sa grille ({allRefs.length} référence(s)
                    reçue(s) cette saison).
                  </p>
                ) : gridRows.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Aucune référence reçue ne correspond à «&nbsp;{refQuery}&nbsp;».
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[180px]">Référence / couleur</TableHead>
                          <TableHead className="min-w-[140px]">Réception</TableHead>
                          {gridSizes.map((s) => (
                            <TableHead key={s} className="text-center min-w-[68px]">
                              {s}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {gridRows.map((row) => (
                          <TableRow key={`${row.receptionId}__${row.productId}`}>
                            <TableCell>
                              <span className="font-mono text-xs">{row.reference}</span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                {row.color}
                                {row.colorLabel ? ` — ${row.colorLabel}` : ""}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {row.supplierName}
                              <span className="block text-[10px]">cmd {row.orderNumber}</span>
                            </TableCell>
                            {gridSizes.map((s) => {
                              const recv = row.received[s] || 0;
                              const k = cellKey(row.receptionId, row.productId, s);
                              const isChanged = changed.some((c) => c.key === k);
                              if (recv <= 0) {
                                return (
                                  <TableCell key={s} className="text-center text-muted-foreground/30">
                                    —
                                  </TableCell>
                                );
                              }
                              return (
                                <TableCell key={s} className="p-1 text-center">
                                  <input
                                    inputMode="numeric"
                                    value={cellValue(k)}
                                    onChange={(e) => setCell(k, e.target.value)}
                                    placeholder="0"
                                    title={`${recv} reçue(s) en ${s}`}
                                    className={cn(
                                      "h-8 w-14 rounded border bg-transparent text-center text-sm outline-none focus:border-primary",
                                      isChanged && "border-amber-500 bg-amber-50",
                                      (parseInt(cellValue(k) || "0", 10) || 0) > recv &&
                                        "border-destructive text-destructive"
                                    )}
                                  />
                                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                                    /{recv}
                                  </span>
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {gridRows.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Le petit nombre sous chaque case est la quantité <strong>reçue</strong> — tu ne
                    peux pas prélever au-delà. Laisse vide (ou 0) pour ne rien prélever.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FlaskConical className="h-4 w-4" />
                    Pièces mises de côté
                  </CardTitle>
                  <Badge variant="secondary">
                    {formatNumber(totalPieces)} pièce{totalPieces > 1 ? "s" : ""}
                  </Badge>
                </div>
                <div className="relative mt-3 max-w-xs">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Rechercher une référence, une couleur..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 h-9 text-sm"
                  />
                </div>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="py-8 text-center text-sm text-muted-foreground animate-pulse">
                    Chargement...
                  </p>
                ) : filtered.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {search
                      ? `Aucun prélèvement ne correspond à « ${search} ».`
                      : "Aucune pièce mise de côté pour cette saison."}
                  </p>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Référence</TableHead>
                          <TableHead>Couleur</TableHead>
                          <TableHead className="text-center">Taille</TableHead>
                          <TableHead className="text-right">Quantité</TableHead>
                          <TableHead>Prélevé par</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell className="font-mono text-xs">{s.product.reference}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {s.product.color}
                              {s.product.colorLabel ? ` — ${s.product.colorLabel}` : ""}
                            </TableCell>
                            <TableCell className="text-center">{s.size}</TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {s.quantity}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {s.createdBy || "—"}
                            </TableCell>
                            <TableCell>
                              <button
                                type="button"
                                onClick={() => remove(s.id)}
                                title="Retirer ce prélèvement (les pièces redeviennent disponibles)"
                                aria-label="Retirer ce prélèvement"
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

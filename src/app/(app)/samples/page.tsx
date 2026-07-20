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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  FlaskConical,
  Search,
  Trash2,
  Save,
  X,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
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

/** Un prélèvement qui empiète sur une répartition déjà validée. */
interface Conflict {
  productId: string;
  reference: string;
  color: string;
  colorLabel: string | null;
  size: string;
  received: number;
  samples: number;
  allocated: number;
  needed: number;
  allocations: { lineId: string; clientId: string | null; clientName: string; allocated: number }[];
}

/** Répartition déjà validée d'un produit : qui détient quoi. */
interface AllocDetail {
  sessionDate: string | null;
  rows: {
    lineId: string;
    clientName: string;
    allocated: SizeQuantities;
    original: SizeQuantities;
  }[];
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
  // Réception de travail : on prélève sur une LIVRAISON physique → c'est le point de
  // départ naturel. Vide = toutes réceptions (on cherche alors par référence).
  const [recFilter, setRecFilter] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  // Repères d'excédent (par produit/taille, sur toute la saison).
  const [receivedTotal, setReceivedTotal] = useState<Record<string, SizeQuantities>>({});
  const [clientDemand, setClientDemand] = useState<Record<string, SizeQuantities>>({});
  const [supplierOrdered, setSupplierOrdered] = useState<Record<string, SizeQuantities>>({});
  // Conflits avec une répartition déjà validée → l'utilisateur choisit où retirer.
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [removalDraft, setRemovalDraft] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(false);
  // Détail « qui a déjà ces pièces » (déplié à la demande, par produit).
  const [openDetail, setOpenDetail] = useState<string | null>(null);
  const [detailByProduct, setDetailByProduct] = useState<Record<string, AllocDetail>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  // Retraits saisis DIRECTEMENT dans le détail (clé `lineId__taille` → quantité).
  const [pullDraft, setPullDraft] = useState<Record<string, string>>({});
  const [pulling, setPulling] = useState(false);

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
        setReceivedTotal(d?.receivedTotal || {});
        setClientDemand(d?.clientDemand || {});
        setSupplierOrdered(d?.supplierOrdered || {});
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
    // Une réception choisie affiche TOUS ses produits (la référence n'est alors qu'un
    // filtre supplémentaire). Sans réception, il faut une référence pour ne pas afficher
    // toute la saison d'un coup.
    if (!q && !recFilter) return [];
    const rows: GridRow[] = [];
    for (const r of receptions) {
      if (recFilter && r.id !== recFilter) continue;
      for (const p of r.products) {
        if (q && !norm(p.reference).includes(q)) continue;
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
  }, [receptions, refQuery, recFilter]);

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

  // Charge (une fois) la répartition validée d'un produit, pour choisir où prélever.
  const toggleDetail = async (productId: string) => {
    if (openDetail === productId) {
      setOpenDetail(null);
      return;
    }
    setOpenDetail(productId);
    if (detailByProduct[productId] || !activeSeason) return;
    setDetailLoading(productId);
    try {
      const res = await fetch(
        `/api/samples/allocations?seasonId=${activeSeason.id}&productId=${productId}`
      );
      const d = await res.json();
      if (res.ok) {
        setDetailByProduct((m) => ({
          ...m,
          [productId]: { sessionDate: d.session?.sessionDate ?? null, rows: d.rows || [] },
        }));
      }
    } catch {
      /* silencieux : le détail est une aide, pas un bloquant */
    } finally {
      setDetailLoading(null);
    }
  };

  // Retire des pièces à des boutiques précises, depuis le détail de répartition.
  // Indépendant de la grille : on peut vouloir juste corriger une répartition.
  const applyPulls = async (productId: string) => {
    const removals = Object.entries(pullDraft)
      .filter(([k]) => k.startsWith(`${productId}::`))
      .map(([k, v]) => {
        const [, lineId, size] = k.split("::");
        return { lineId, size, quantity: parseInt(v || "0", 10) || 0 };
      })
      .filter((r) => r.quantity > 0);
    if (removals.length === 0) return;
    setPulling(true);
    try {
      const res = await fetch("/api/samples/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [], removals }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Erreur");
      toast.success(`${d.pulled} pièce(s) retirée(s) de la répartition`, {
        description: "Les boutiques concernées ont été mises à jour.",
      });
      // Recharge le détail du produit (les quantités ont changé).
      setPullDraft((m) => {
        const n = { ...m };
        for (const k of Object.keys(n)) if (k.startsWith(`${productId}::`)) delete n[k];
        return n;
      });
      setDetailByProduct((m) => {
        const n = { ...m };
        delete n[productId];
        return n;
      });
      setOpenDetail(null);
      await toggleDetail(productId);
      load();
    } catch (e) {
      toast.error("Retrait impossible", {
        description: String(e instanceof Error ? e.message : e),
      });
    } finally {
      setPulling(false);
    }
  };

  const draftItems = () =>
    changed.map(({ key, qty }) => {
      const [supplierReceptionId, productId, size] = key.split("__");
      return { supplierReceptionId, productId, size, quantity: qty };
    });

  // Étape 1 : le prélèvement empiète-t-il sur une répartition DÉJÀ VALIDÉE ?
  // Si oui, on n'enregistre rien tant que l'utilisateur n'a pas choisi où retirer.
  const checkThenSave = async () => {
    if (changed.length === 0) return;
    setChecking(true);
    try {
      const res = await fetch("/api/samples/impact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: draftItems() }),
      });
      const d = await res.json();
      if (res.ok && d.conflicts?.length > 0) {
        // Pré-remplissage : on propose de retirer chez les boutiques les MIEUX servies
        // d'abord (elles sont les moins pénalisées par un retrait).
        const pre: Record<string, string> = {};
        for (const c of d.conflicts as Conflict[]) {
          let left = c.needed;
          for (const a of c.allocations) {
            if (left <= 0) break;
            const take = Math.min(left, a.allocated);
            if (take > 0) pre[`${c.productId}__${c.size}__${a.lineId}`] = String(take);
            left -= take;
          }
        }
        setRemovalDraft(pre);
        setConflicts(d.conflicts);
        return;
      }
      await saveGrid([]);
    } catch (e) {
      toast.error("Vérification impossible", {
        description: String(e instanceof Error ? e.message : e),
      });
    } finally {
      setChecking(false);
    }
  };

  const saveGrid = async (removals: { lineId: string; size: string; quantity: number }[]) => {
    if (changed.length === 0) return;
    setSaving(true);
    try {
      const items = draftItems();
      const res = await fetch("/api/samples/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, ...(removals.length ? { removals } : {}) }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Erreur");
      const bits: string[] = [];
      if (d.saved) bits.push(`${d.saved} ligne(s) enregistrée(s)`);
      if (d.deleted) bits.push(`${d.deleted} retirée(s)`);
      if (d.pulled) bits.push(`${d.pulled} pièce(s) reprise(s) sur la répartition validée`);
      toast.success("Prélèvements enregistrés", {
        description: `${bits.join(" · ")} — retirés du disponible à la répartition.`,
      });
      if (d.errors?.length) {
        toast.warning(`${d.errors.length} cellule(s) ignorée(s)`, { description: d.errors[0] });
      }
      setDraft({});
      setConflicts(null);
      setRemovalDraft({});
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

  // Confirmation possible seulement si CHAQUE conflit a son compte de pièces réparti.
  const conflictsFullyAssigned = useMemo(() => {
    if (!conflicts) return false;
    return conflicts.every((c) => {
      const assigned = c.allocations.reduce(
        (sum, a) => sum + (parseInt(removalDraft[`${c.productId}__${c.size}__${a.lineId}`] || "0", 10) || 0),
        0
      );
      const overflow = c.allocations.some(
        (a) => (parseInt(removalDraft[`${c.productId}__${c.size}__${a.lineId}`] || "0", 10) || 0) > a.allocated
      );
      return assigned === c.needed && !overflow;
    });
  }, [conflicts, removalDraft]);

  const recLabel = (r: ReceptionEntry) =>
    `${r.supplierName} — cmd ${r.orderNumber} (${new Date(r.receptionDate).toLocaleDateString("fr-FR")})`;

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
                  <div className="min-w-[260px] flex-1 max-w-sm">
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                      Réception
                    </label>
                    <Select
                      value={recFilter || "__all__"}
                      onValueChange={(v: string | null) =>
                        v && setRecFilter(v === "__all__" ? "" : v)
                      }
                    >
                      <SelectTrigger className="w-full text-sm">
                        <span className="truncate text-sm">
                          {recFilter
                            ? recLabel(receptions.find((r) => r.id === recFilter)!)
                            : "Toutes les réceptions"}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">Toutes les réceptions</SelectItem>
                        {receptions.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {recLabel(r)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="relative min-w-[260px] flex-1 max-w-sm">
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                      Référence {recFilter && <span className="font-normal">(facultatif)</span>}
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
                  {(refQuery || recFilter) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setRefQuery("");
                        setRecFilter("");
                      }}
                      className="gap-1.5"
                    >
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
                    <Button
                      onClick={checkThenSave}
                      disabled={changed.length === 0 || saving || checking}
                      className="gap-2"
                    >
                      <Save className="h-4 w-4" />
                      {checking ? "Vérification..." : saving ? "Enregistrement..." : "Enregistrer"}
                    </Button>
                  </div>
                </div>

                {!refQuery && !recFilter ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Choisis une <strong>réception</strong> pour voir tous ses produits, ou tape une{" "}
                    <strong>référence</strong> ({allRefs.length} référence(s) reçue(s) cette saison).
                  </p>
                ) : gridRows.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {refQuery
                      ? `Aucun produit reçu ne correspond à « ${refQuery} »${recFilter ? " dans cette réception" : ""}.`
                      : "Cette réception ne contient aucun produit."}
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
                        {gridRows.flatMap((row) => [
                          <TableRow key={`${row.receptionId}__${row.productId}`}>
                            <TableCell>
                              <button
                                type="button"
                                onClick={() => toggleDetail(row.productId)}
                                className="inline-flex items-center gap-1 text-left hover:underline"
                                title="Voir qui détient déjà ces pièces (répartition validée)"
                              >
                                {openDetail === row.productId ? (
                                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                )}
                                <span className="font-mono text-xs">{row.reference}</span>
                                <span className="text-xs text-muted-foreground">
                                  {row.color}
                                  {row.colorLabel ? ` — ${row.colorLabel}` : ""}
                                </span>
                              </button>
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
                                  {(() => {
                                    // Deux repères pour choisir OÙ prélever :
                                    //  • client = reçu total − commandé boutiques (le vrai libre)
                                    //  • fourn. = reçu total − commandé au fournisseur
                                    const rt = receivedTotal[row.productId]?.[s] || 0;
                                    const cd = clientDemand[row.productId]?.[s] || 0;
                                    const so = supplierOrdered[row.productId]?.[s] || 0;
                                    const gapC = rt - cd;
                                    const gapS = rt - so;
                                    return (
                                      <span
                                        className="mt-0.5 block text-[10px] leading-tight text-muted-foreground"
                                        title={`Reçu ${recv} sur cette réception · Saison : reçu ${rt}, commandé boutiques ${cd} (écart ${gapC >= 0 ? "+" : ""}${gapC}), commandé fournisseur ${so} (écart ${gapS >= 0 ? "+" : ""}${gapS})`}
                                      >
                                        /{recv}
                                        <span
                                          className={cn(
                                            "ml-1 font-medium",
                                            gapC > 0 ? "text-emerald-600" : gapC < 0 ? "text-red-600" : ""
                                          )}
                                        >
                                          {gapC > 0 ? `+${gapC}` : gapC}
                                        </span>
                                        <span className="ml-0.5 opacity-60">/{gapS > 0 ? `+${gapS}` : gapS}</span>
                                      </span>
                                    );
                                  })()}
                                </TableCell>
                              );
                            })}
                          </TableRow>,
                          // Détail « qui détient déjà ces pièces » : permet de choisir où
                          // prélever AVANT de saisir, sans attendre l'alerte de conflit.
                          ...(openDetail === row.productId
                            ? [
                                <TableRow
                                  key={`d_${row.receptionId}__${row.productId}`}
                                  className="bg-muted/30 hover:bg-muted/30"
                                >
                                  <TableCell colSpan={2 + gridSizes.length} className="py-3">
                                    {detailLoading === row.productId ? (
                                      <p className="animate-pulse text-xs text-muted-foreground">
                                        Chargement de la répartition...
                                      </p>
                                    ) : !detailByProduct[row.productId] ||
                                      detailByProduct[row.productId].rows.length === 0 ? (
                                      <p className="text-xs text-muted-foreground">
                                        Aucune répartition validée sur ce produit — tu peux prélever
                                        librement (dans la limite du reçu).
                                      </p>
                                    ) : (
                                      <div className="space-y-2">
                                        <p className="text-xs text-muted-foreground">
                                          Réparti le{" "}
                                          {detailByProduct[row.productId].sessionDate
                                            ? new Date(
                                                detailByProduct[row.productId].sessionDate as string
                                              ).toLocaleDateString("fr-FR")
                                            : "—"}{" "}
                                          entre {detailByProduct[row.productId].rows.length} boutique(s) :
                                        </p>
                                        <div className="overflow-x-auto">
                                          <table className="text-xs">
                                            <thead>
                                              <tr className="text-muted-foreground">
                                                <th className="px-2 py-1 text-left font-medium">Boutique</th>
                                                {gridSizes.map((sz) => (
                                                  <th key={sz} className="px-2 py-1 text-center font-medium">
                                                    {sz}
                                                  </th>
                                                ))}
                                                <th className="px-2 py-1 text-right font-medium">Total</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {detailByProduct[row.productId].rows.map((r) => {
                                                const tot = Object.values(r.allocated).reduce((a, b) => a + b, 0);
                                                return (
                                                  <tr key={r.lineId} className="border-t">
                                                    <td className="px-2 py-1">{r.clientName}</td>
                                                    {gridSizes.map((sz) => {
                                                      const has = r.allocated[sz] || 0;
                                                      const pk = `${row.productId}::${r.lineId}::${sz}`;
                                                      if (has <= 0) {
                                                        return (
                                                          <td key={sz} className="px-2 py-1 text-center">
                                                            <span className="text-muted-foreground/30">—</span>
                                                          </td>
                                                        );
                                                      }
                                                      const asked = parseInt(pullDraft[pk] || "0", 10) || 0;
                                                      return (
                                                        <td key={sz} className="px-1 py-1 text-center">
                                                          <div className="flex flex-col items-center">
                                                            <span className="tabular-nums">{has}</span>
                                                            {/* Saisir ici = retirer ces pièces À CETTE BOUTIQUE. */}
                                                            <input
                                                              inputMode="numeric"
                                                              value={pullDraft[pk] ?? ""}
                                                              onChange={(e) =>
                                                                setPullDraft((m) => ({
                                                                  ...m,
                                                                  [pk]: e.target.value.replace(/[^0-9]/g, ""),
                                                                }))
                                                              }
                                                              placeholder="−0"
                                                              title={`Retirer des pièces à ${r.clientName} en ${sz} (max ${has})`}
                                                              className={cn(
                                                                "mt-0.5 h-6 w-12 rounded border bg-transparent text-center text-[11px] outline-none focus:border-primary",
                                                                asked > 0 && "border-amber-500 bg-amber-50",
                                                                asked > has && "border-destructive text-destructive"
                                                              )}
                                                            />
                                                          </div>
                                                        </td>
                                                      );
                                                    })}
                                                    <td className="px-2 py-1 text-right font-medium tabular-nums">
                                                      {tot}
                                                    </td>
                                                  </tr>
                                                );
                                              })}
                                            </tbody>
                                          </table>
                                        </div>
                                        {(() => {
                                          const pulls = Object.entries(pullDraft).filter(
                                            ([k, v]) =>
                                              k.startsWith(`${row.productId}::`) &&
                                              (parseInt(v || "0", 10) || 0) > 0
                                          );
                                          const nb = pulls.reduce(
                                            (a, [, v]) => a + (parseInt(v || "0", 10) || 0),
                                            0
                                          );
                                          const over = detailByProduct[row.productId].rows.some((r) =>
                                            gridSizes.some(
                                              (sz) =>
                                                (parseInt(
                                                  pullDraft[`${row.productId}::${r.lineId}::${sz}`] || "0",
                                                  10
                                                ) || 0) > (r.allocated[sz] || 0)
                                            )
                                          );
                                          return (
                                            <div className="flex items-center justify-between gap-3 pt-1">
                                              <p className="text-[11px] text-muted-foreground">
                                                Saisis sous une quantité pour <strong>retirer</strong> ces
                                                pièces à cette boutique.
                                              </p>
                                              <div className="flex items-center gap-2">
                                                {nb > 0 && (
                                                  <span className="text-[11px] text-muted-foreground">
                                                    {nb} pièce(s) à retirer
                                                  </span>
                                                )}
                                                <Button
                                                  size="sm"
                                                  variant="outline"
                                                  disabled={nb === 0 || over || pulling}
                                                  onClick={() => applyPulls(row.productId)}
                                                  className="h-7 gap-1.5 text-xs"
                                                >
                                                  <Trash2 className="h-3.5 w-3.5" />
                                                  {pulling ? "Retrait..." : "Retirer de la répartition"}
                                                </Button>
                                              </div>
                                            </div>
                                          );
                                        })()}
                                      </div>
                                    )}
                                  </TableCell>
                                </TableRow>,
                              ]
                            : []),
                        ])}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {gridRows.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Sous chaque case : <strong>/reçu</strong> sur cette réception, puis l&apos;excédent{" "}
                    <span className="font-medium text-emerald-600">vs commandes boutiques</span> et{" "}
                    <span className="opacity-60">vs commande fournisseur</span>. Un excédent{" "}
                    <span className="font-medium text-emerald-600">positif</span> = tu peux prélever
                    sans pénaliser une boutique.
                  </p>
                )}
              </CardContent>
            </Card>

            {conflicts && conflicts.length > 0 && (
              <Card className="border-amber-400">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base text-amber-700">
                    <AlertTriangle className="h-4 w-4" />
                    Ces pièces sont déjà attribuées à des boutiques
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    La répartition validée les a déjà distribuées. Choisis chez quelle(s)
                    boutique(s) les reprendre, puis confirme. Rien n&apos;est enregistré tant que tu
                    n&apos;as pas confirmé.
                  </p>
                </CardHeader>
                <CardContent className="space-y-5">
                  {conflicts.map((c) => {
                    const assigned = c.allocations.reduce(
                      (sum, a) => sum + (parseInt(removalDraft[`${c.productId}__${c.size}__${a.lineId}`] || "0", 10) || 0),
                      0
                    );
                    return (
                      <div key={`${c.productId}__${c.size}`} className="rounded-md border p-3">
                        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-mono">{c.reference}</span>
                          <span className="text-muted-foreground">
                            {c.color}
                            {c.colorLabel ? ` — ${c.colorLabel}` : ""}
                          </span>
                          <Badge variant="outline">taille {c.size}</Badge>
                          <span className="text-xs text-muted-foreground">
                            reçu {c.received} · alloué {c.allocated} · prélèvement {c.samples}
                          </span>
                          <span
                            className={cn(
                              "ml-auto text-xs font-medium",
                              assigned === c.needed ? "text-emerald-600" : "text-amber-700"
                            )}
                          >
                            {assigned}/{c.needed} pièce(s) à reprendre
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {c.allocations.map((a) => {
                            const k = `${c.productId}__${c.size}__${a.lineId}`;
                            return (
                              <div key={a.lineId} className="flex items-center gap-3 text-sm">
                                <span className="flex-1 truncate">{a.clientName}</span>
                                <span className="text-xs text-muted-foreground">
                                  {a.allocated} attribuée(s)
                                </span>
                                <input
                                  inputMode="numeric"
                                  value={removalDraft[k] ?? ""}
                                  onChange={(e) =>
                                    setRemovalDraft((d) => ({
                                      ...d,
                                      [k]: e.target.value.replace(/[^0-9]/g, ""),
                                    }))
                                  }
                                  placeholder="0"
                                  className={cn(
                                    "h-8 w-16 rounded border bg-transparent text-center text-sm outline-none focus:border-primary",
                                    (parseInt(removalDraft[k] || "0", 10) || 0) > a.allocated &&
                                      "border-destructive text-destructive"
                                  )}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setConflicts(null);
                        setRemovalDraft({});
                      }}
                    >
                      Annuler
                    </Button>
                    <Button
                      onClick={() => {
                        const removals = Object.entries(removalDraft)
                          .map(([k, v]) => {
                            const [, size, lineId] = k.split("__");
                            return { lineId, size, quantity: parseInt(v || "0", 10) || 0 };
                          })
                          .filter((r) => r.quantity > 0);
                        saveGrid(removals);
                      }}
                      disabled={saving || !conflictsFullyAssigned}
                      className="gap-2"
                    >
                      <Save className="h-4 w-4" />
                      {saving ? "Enregistrement..." : "Confirmer et enregistrer"}
                    </Button>
                  </div>
                  {!conflictsFullyAssigned && (
                    <p className="text-right text-xs text-amber-700">
                      Répartis toutes les pièces à reprendre pour pouvoir confirmer.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

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

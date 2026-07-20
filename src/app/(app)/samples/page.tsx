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
import { FlaskConical, Search, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { formatNumber, type SizeQuantities } from "@/lib/utils";

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

export default function SamplesPage() {
  const { activeSeason } = useSeason();
  const [receptions, setReceptions] = useState<ReceptionEntry[]>([]);
  const [samples, setSamples] = useState<SampleEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  // Formulaire de prélèvement
  const [recId, setRecId] = useState("");
  const [productId, setProductId] = useState("");
  const [size, setSize] = useState("");
  const [qty, setQty] = useState("1");
  const [notes, setNotes] = useState("");

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

  // Réinitialise les niveaux inférieurs quand on change de niveau supérieur.
  useEffect(() => {
    setProductId("");
    setSize("");
  }, [recId]);
  useEffect(() => {
    setSize("");
  }, [productId]);

  const reception = receptions.find((r) => r.id === recId);
  const product = reception?.products.find((p) => p.productId === productId);
  // Tailles proposées = celles RÉELLEMENT reçues (on ne prélève que du reçu).
  const sizes = product ? Object.entries(product.received).filter(([, n]) => n > 0) : [];
  const receivedForSize = size && product ? product.received[size] || 0 : 0;

  const submit = async () => {
    if (!recId || !productId || !size) return;
    const n = parseInt(qty, 10);
    if (isNaN(n) || n <= 0) {
      toast.error("Quantité invalide");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/samples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierReceptionId: recId,
          productId,
          size,
          quantity: n,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Erreur");
      toast.success(`${n} pièce(s) mise(s) de côté`, {
        description: "Elles sont retirées du disponible à la répartition.",
      });
      setSize("");
      setQty("1");
      setNotes("");
      load();
    } catch (e) {
      toast.error("Prélèvement impossible", { description: String(e instanceof Error ? e.message : e) });
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

  const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
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
        a.product.reference.localeCompare(b.product.reference, "fr", { sensitivity: "base", numeric: true }) ||
        a.product.color.localeCompare(b.product.color, "fr", { sensitivity: "base", numeric: true }) ||
        a.size.localeCompare(b.size, "fr", { numeric: true })
    );
  }, [samples, search]);

  const totalPieces = samples.reduce((s, x) => s + x.quantity, 0);
  const recLabel = (r: ReceptionEntry) =>
    `${r.supplierName} — cmd ${r.orderNumber} (${new Date(r.receptionDate).toLocaleDateString("fr-FR")})`;

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
                  <Plus className="h-4 w-4" />
                  Mettre des pièces de côté
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Choisis la réception, le produit puis la taille. Tu ne peux prélever que des
                  pièces réellement reçues.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="lg:col-span-2">
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                      Réception
                    </label>
                    <Select value={recId || "__none__"} onValueChange={(v: string | null) => v && setRecId(v === "__none__" ? "" : v)}>
                      <SelectTrigger className="text-sm">
                        <span className="truncate text-sm">
                          {reception ? recLabel(reception) : "Choisir une réception..."}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        {receptions.length === 0 ? (
                          <SelectItem value="__none__" disabled>
                            Aucune réception pour cette saison
                          </SelectItem>
                        ) : (
                          receptions.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {recLabel(r)}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                      Produit
                    </label>
                    <Select
                      value={productId || "__none__"}
                      onValueChange={(v: string | null) => v && setProductId(v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger className="text-sm" disabled={!reception}>
                        <span className="truncate text-sm">
                          {product ? `${product.reference} / ${product.color}` : "Choisir..."}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        {(reception?.products || []).map((p) => (
                          <SelectItem key={p.productId} value={p.productId}>
                            {p.reference} / {p.color}
                            {p.colorLabel ? ` — ${p.colorLabel}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                      Taille
                    </label>
                    <Select value={size || "__none__"} onValueChange={(v: string | null) => v && setSize(v === "__none__" ? "" : v)}>
                      <SelectTrigger className="text-sm" disabled={!product}>
                        <span className="truncate text-sm">{size || "Choisir..."}</span>
                      </SelectTrigger>
                      <SelectContent>
                        {sizes.map(([s, n]) => (
                          <SelectItem key={s} value={s}>
                            {s} — {n} reçue{n > 1 ? "s" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                      Quantité {receivedForSize > 0 && `(max ${receivedForSize})`}
                    </label>
                    <Input
                      type="number"
                      min={1}
                      max={receivedForSize || undefined}
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                      className="h-9 text-sm"
                      disabled={!size}
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                      Motif (facultatif)
                    </label>
                    <Input
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="ex : contrôle qualité coutures"
                      className="h-9 text-sm"
                      disabled={!size}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={submit} disabled={!size || saving} className="gap-2 w-full">
                      <FlaskConical className="h-4 w-4" />
                      {saving ? "Enregistrement..." : "Mettre de côté"}
                    </Button>
                  </div>
                </div>
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
                          <TableHead>Motif</TableHead>
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
                              {s.notes || "—"}
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

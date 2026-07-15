"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Plus, Trash2, Save, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface ColorOpt {
  reference: string;
  color: string;
  colorCode: string | null;
  colorLabel: string | null;
  sizeScale: string;
}
interface Detail {
  id: string;
  receptionNumber: string;
  receptionDate: string;
  orderNumber: string;
  supplierName: string;
  supplierCode: string;
  lastEditedBy: string | null;
  lastEditedAt: string | null;
  lines: {
    reference: string;
    color: string;
    colorLabel: string | null;
    sizeScale: string;
    quantities: Record<string, number>;
  }[];
  colorsByReference: Record<string, ColorOpt[]>;
}
interface EditLine {
  key: number;
  reference: string;
  color: string;
  quantities: Record<string, number>;
}

let KEY = 1;

export default function ReceptionEditorPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/import/receptions/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
          return;
        }
        setDetail(d.data);
        setLines(
          d.data.lines.map((l: Detail["lines"][number]) => ({
            key: KEY++,
            reference: l.reference,
            color: l.color,
            quantities: { ...l.quantities },
          }))
        );
      })
      .catch(() => setError("Chargement impossible"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Sizes affichées pour une ligne = grille du produit (réf+couleur) ∪ tailles déjà saisies.
  const sizesFor = (line: EditLine): string[] => {
    const opt = detail?.colorsByReference[line.reference]?.find((c) => c.color === line.color);
    const scale = opt?.sizeScale ? opt.sizeScale.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const extra = Object.keys(line.quantities).filter((s) => !scale.includes(s));
    return [...scale, ...extra];
  };

  const setLine = (key: number, patch: Partial<EditLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const setQty = (key: number, size: string, value: string) => {
    const n = value === "" ? 0 : parseInt(value, 10);
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const q = { ...l.quantities };
        if (!n || isNaN(n)) delete q[size];
        else q[size] = n;
        return { ...l, quantities: q };
      })
    );
  };

  const lineTotal = (l: EditLine) => Object.values(l.quantities).reduce((s, n) => s + (n || 0), 0);

  const addLine = () => {
    const refs = detail ? Object.keys(detail.colorsByReference) : [];
    if (refs.length === 0) return;
    const reference = refs[0];
    const color = detail!.colorsByReference[reference][0]?.color || "";
    setLines((ls) => [...ls, { key: KEY++, reference, color, quantities: {} }]);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        lines: lines
          .map((l) => ({ reference: l.reference, color: l.color, quantities: l.quantities }))
          .filter((l) => Object.values(l.quantities).some((n) => n > 0)),
      };
      const res = await fetch(`/api/import/receptions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Enregistrement impossible");
        return;
      }
      toast.success(`Réception corrigée (${json.data.lineCount} ligne(s))`);
      router.push("/import/receptions");
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setSaving(false);
    }
  };

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <div>
      <Topbar title="Correction réception" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <div className="flex items-center gap-2">
          <Link href="/import/receptions">
            <Button variant="ghost" size="sm" className="gap-1">
              <ArrowLeft className="h-4 w-4" />
              Réceptions
            </Button>
          </Link>
        </div>

        {loading ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground animate-pulse">
              Chargement…
            </CardContent>
          </Card>
        ) : error ? (
          <Card className="border-destructive/30">
            <CardContent className="flex items-center gap-2 py-8 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </CardContent>
          </Card>
        ) : detail ? (
          <>
            <PageHeader
              title={`Réception — commande ${detail.orderNumber}`}
              description={`${detail.supplierName} (${detail.supplierCode}) · ${detail.lines.length} ligne(s) à l'origine`}
            />
            {detail.lastEditedBy && (
              <p className="text-xs text-muted-foreground">
                Dernière correction : {detail.lastEditedBy} · {fmt(detail.lastEditedAt)}
              </p>
            )}

            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2.5 font-medium">Référence</th>
                        <th className="px-3 py-2.5 font-medium">Couleur</th>
                        <th className="px-3 py-2.5 font-medium">Quantités par taille</th>
                        <th className="px-3 py-2.5 text-right font-medium">Total</th>
                        <th className="px-3 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {lines.map((l) => {
                        const colorOpts = detail.colorsByReference[l.reference] || [];
                        return (
                          <tr key={l.key} className="align-top">
                            <td className="px-3 py-2.5 font-mono text-xs">{l.reference}</td>
                            <td className="px-3 py-2.5">
                              <select
                                value={l.color}
                                onChange={(e) => setLine(l.key, { color: e.target.value })}
                                className="rounded-md border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
                              >
                                {colorOpts.map((c) => (
                                  <option key={c.color} value={c.color}>
                                    {c.color}
                                    {c.colorLabel ? ` — ${c.colorLabel}` : ""}
                                  </option>
                                ))}
                                {/* Sécurité : conserver la couleur actuelle si absente des options */}
                                {!colorOpts.some((c) => c.color === l.color) && (
                                  <option value={l.color}>{l.color}</option>
                                )}
                              </select>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex flex-wrap gap-2">
                                {sizesFor(l).map((size) => (
                                  <label key={size} className="flex flex-col items-center">
                                    <span className="text-[10px] uppercase text-muted-foreground">{size}</span>
                                    <Input
                                      type="number"
                                      min={0}
                                      value={l.quantities[size] ?? ""}
                                      onChange={(e) => setQty(l.key, size, e.target.value)}
                                      className="h-8 w-14 px-1.5 text-center tabular-nums"
                                    />
                                  </label>
                                ))}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right font-medium tabular-nums">{lineTotal(l)}</td>
                            <td className="px-3 py-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                                className="text-muted-foreground hover:text-destructive"
                                aria-label="Supprimer la ligne"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {lines.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">
                            Aucune ligne. Ajoutez-en une ou annulez.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    {lines.length > 0 && (
                      <tfoot className="border-t-2 bg-muted/40 font-semibold">
                        <tr>
                          <td className="px-3 py-2.5" colSpan={2}>
                            Total réception ({lines.length} ligne{lines.length > 1 ? "s" : ""})
                          </td>
                          <td className="px-3 py-2.5 text-xs font-normal text-muted-foreground">
                            se met à jour selon les modifications
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {lines.reduce((s, l) => s + lineTotal(l), 0)}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </CardContent>
            </Card>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button variant="outline" size="sm" className="gap-1" onClick={addLine}>
                <Plus className="h-4 w-4" />
                Ajouter une ligne
              </Button>
              <div className="flex items-center gap-2">
                <Link href="/import/receptions">
                  <Button variant="ghost" disabled={saving}>
                    Annuler
                  </Button>
                </Link>
                <Button onClick={save} disabled={saving} className="gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Enregistrer la correction
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Pour <strong>échanger deux couleurs</strong> : sur chaque ligne concernée, changez la
              couleur via le menu déroulant (les quantités restent), puis enregistrez. Seuls les
              produits du référentiel sont acceptés ; deux lignes ne peuvent pas viser le même produit.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

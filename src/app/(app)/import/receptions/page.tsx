"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSeason, formatSeasonLabel } from "@/lib/season-context";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PackageCheck, Pencil, ArrowLeft } from "lucide-react";

interface ReceptionRow {
  id: string;
  receptionNumber: string;
  receptionDate: string;
  createdAt: string;
  lastEditedBy: string | null;
  lastEditedAt: string | null;
  orderNumber: string;
  supplierName: string;
  supplierCode: string;
  lineCount: number;
  totalQty: number;
}

export default function ReceptionsListPage() {
  const { activeSeason } = useSeason();
  const [rows, setRows] = useState<ReceptionRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!activeSeason) {
      setRows([]);
      return;
    }
    setLoading(true);
    fetch(`/api/import/receptions?seasonId=${activeSeason.id}`)
      .then((r) => r.json())
      .then((d) => setRows(d.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeSeason]);

  useEffect(() => {
    load();
  }, [load]);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });

  return (
    <div>
      <Topbar title="Réceptions" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <div className="flex items-center gap-2">
          <Link href="/comparison">
            <Button variant="ghost" size="sm" className="gap-1">
              <ArrowLeft className="h-4 w-4" />
              Comparaison
            </Button>
          </Link>
        </div>
        <PageHeader
          title="Corriger une réception"
          description={
            activeSeason
              ? `Réceptions de la saison ${formatSeasonLabel(activeSeason)} — cliquez sur « Éditer » pour corriger produits/couleurs et quantités.`
              : "Sélectionnez une saison active pour voir ses réceptions."
          }
        />

        {!activeSeason ? (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              Aucune saison active.
            </CardContent>
          </Card>
        ) : loading ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground animate-pulse">
              Chargement…
            </CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              Aucune réception pour cette saison.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Date</th>
                      <th className="px-4 py-2.5 font-medium">Commande</th>
                      <th className="px-4 py-2.5 font-medium">Fournisseur</th>
                      <th className="px-4 py-2.5 text-right font-medium">Lignes</th>
                      <th className="px-4 py-2.5 text-right font-medium">Total pcs</th>
                      <th className="px-4 py-2.5 font-medium">Dernière correction</th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((r) => (
                      <tr key={r.id} className="hover:bg-muted/20">
                        <td className="whitespace-nowrap px-4 py-2.5">{fmt(r.createdAt)}</td>
                        <td className="px-4 py-2.5 font-medium">{r.orderNumber}</td>
                        <td className="px-4 py-2.5">
                          {r.supplierName}{" "}
                          <span className="text-xs text-muted-foreground">({r.supplierCode})</span>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{r.lineCount}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{r.totalQty}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {r.lastEditedBy ? `${r.lastEditedBy} · ${r.lastEditedAt ? fmt(r.lastEditedAt) : ""}` : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Link href={`/import/receptions/${r.id}`}>
                            <Button size="sm" variant="outline" className="h-7 gap-1">
                              <Pencil className="h-3.5 w-3.5" />
                              Éditer
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <PackageCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Corriger une réception ajuste les quantités reçues et donc les écarts commande/réception
          et le stock disponible pour la répartition. Chaque correction est journalisée (qui / quand).
        </p>
      </div>
    </div>
  );
}

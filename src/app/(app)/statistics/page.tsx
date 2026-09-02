"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { useSeason } from "@/lib/season-context";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BarChart3, Search, X } from "lucide-react";
import { cn, formatNumber, formatEuro } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";

interface ChartData {
  clientBreakdown: {
    name: string;
    commandé: number;
    livré: number;
    facturé: number;
    montantFacturé: number;
    restant: number;
  }[];
  invoicedAmount: number;
  clientDeliveries: {
    name: string;
    planifiées: number;
    enPreparation: number;
    expédiées: number;
  }[];
  supplierConformity: {
    name: string;
    commandé: number;
    reçu: number;
    conformité: number;
  }[];
  supplierReceptions: {
    name: string;
    commandé: number;
    reçu: number;
    manquant: number;
  }[];
  deliveryStatus: { name: string; value: number }[];
  invoiceStatus: { name: string; value: number }[];
  deliveryTimeline: { date: string; client: string; pièces: number }[];
  /** Totaux de la saison, sur TOUS les clients (clientBreakdown est tronqué au top 15). */
  totals?: { clients: number; commandé: number; livré: number; facturé: number; soldé: number; restant: number };
  /** Totaux fournisseurs de la saison, pour une conformité pondérée. */
  supplierTotals?: { commandé: number; reçu: number };
}

// Statut facturation : Facturées / Partielles / À facturer
const INVOICE_COLORS: Record<string, string> = {
  "Facturées": "#10B981",
  "Partielles": "#F59E0B",
  "À facturer": "#F43F5E",
};

const COLORS = [
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
  "#06B6D4",
  "#84CC16",
  "#F97316",
  "#6366F1",
];

export default function StatisticsPage() {
  const { activeSeason } = useSeason();
  const [data, setData] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(false);
  const [referenceFilter, setReferenceFilter] = useState("");
  const [appliedFilter, setAppliedFilter] = useState("");

  const loadData = useCallback(
    async (refFilter: string) => {
      if (!activeSeason) {
        setData(null);
        return;
      }
      setLoading(true);
      try {
        const params = new URLSearchParams({ seasonId: activeSeason.id });
        if (refFilter) params.set("reference", refFilter);
        const res = await fetch(`/api/statistics/charts?${params}`);
        if (!res.ok) throw new Error();
        const d = await res.json();
        setData(d);
      } catch {
        toast.error("Impossible de charger les statistiques");
      } finally {
        setLoading(false);
      }
    },
    [activeSeason]
  );

  useEffect(() => {
    loadData(appliedFilter);
  }, [activeSeason, appliedFilter, loadData]);

  const applyFilter = () => {
    setAppliedFilter(referenceFilter.trim());
  };

  const clearFilter = () => {
    setReferenceFilter("");
    setAppliedFilter("");
  };

  const hasData =
    data &&
    (data.clientBreakdown.length > 0 ||
      data.supplierConformity.length > 0 ||
      data.deliveryStatus.some((d) => d.value > 0));

  const clientFulfillment = data?.clientBreakdown.map((c) => ({
    name: c.name,
    "% livré":
      c.commandé > 0 ? Math.round((c.livré / c.commandé) * 100) : 0,
  }));

  // ⚠️ Les tuiles doivent lire les TOTAUX de la saison, pas `clientBreakdown` qui est
  // tronqué au top 15 pour le graphe : sommer le top 15 n'affichait qu'entre 32 % et 53 %
  // des pièces selon la saison, à côté d'un montant facturé calculé, lui, sur tous les
  // clients. (Repli sur le top 15 pour rester compatible avec une réponse ancienne.)
  const totalOrdered =
    data?.totals?.commandé ?? data?.clientBreakdown.reduce((s, c) => s + c.commandé, 0) ?? 0;
  const totalDelivered =
    data?.totals?.livré ?? data?.clientBreakdown.reduce((s, c) => s + c.livré, 0) ?? 0;
  const totalInvoiced =
    data?.totals?.facturé ?? data?.clientBreakdown.reduce((s, c) => s + (c.facturé || 0), 0) ?? 0;
  // Montant facturé par client (HT), trié décroissant, pour le graphe dédié.
  const clientAmounts = (data?.clientBreakdown || [])
    .filter((c) => (c.montantFacturé || 0) > 0)
    .map((c) => ({ name: c.name, montant: c.montantFacturé }))
    .sort((a, b) => b.montant - a.montant);
  // Conformité PONDÉRÉE (total reçu / total commandé) et non moyenne des pourcentages :
  // sinon un fournisseur de 5 pièces pèse autant qu'un fournisseur de 40 000.
  // *AH26 : 35 % en moyenne simple contre 51 % en pondéré.*
  const avgConformity = data?.supplierTotals?.commandé
    ? Math.round((data.supplierTotals.reçu / data.supplierTotals.commandé) * 100)
    : 0;

  return (
    <div>
      <Topbar title="Statistiques" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="Statistiques"
          description="Graphiques et analyses par client, fournisseur et saison"
        />

        {!activeSeason ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <p className="text-sm text-muted-foreground">
                Sélectionnez une saison pour voir les statistiques
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Reference filter */}
            <Card>
              <CardContent>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-muted-foreground">
                      Référence produit
                    </label>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Filtrer par référence..."
                        value={referenceFilter}
                        onChange={(e) => setReferenceFilter(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && applyFilter()}
                        className="pl-9 w-64 h-9"
                      />
                    </div>
                  </div>
                  <Button onClick={applyFilter} className="gap-1 h-9">
                    <Search className="h-4 w-4" />
                    Filtrer
                  </Button>
                  {appliedFilter && (
                    <Button onClick={clearFilter} variant="ghost" className="gap-1 h-9">
                      <X className="h-4 w-4" />
                      Effacer
                    </Button>
                  )}
                </div>
                {appliedFilter && (
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary">
                      Réf. : {appliedFilter}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <p className="text-sm text-muted-foreground animate-pulse">
                  Chargement des statistiques...
                </p>
              </div>
            ) : !hasData ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
                  <BarChart3 className="h-12 w-12 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground text-center">
                    Aucune donnée à afficher.
                    <br />
                    {appliedFilter
                      ? "Aucun résultat pour cette référence."
                      : "Importez des commandes et des réceptions pour voir les statistiques."}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Summary badges */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Card>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {formatNumber(totalOrdered)}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Total commandé
                        {data?.totals ? ` — ${formatNumber(data.totals.clients)} clients` : ""}
                      </p>
                      <div className="mt-2 h-2 rounded-full bg-zinc-100 overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all"
                          style={{
                            width: `${totalOrdered > 0 ? Math.round((totalDelivered / totalOrdered) * 100) : 0}%`,
                          }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatNumber(totalDelivered)} livré (
                        {totalOrdered > 0
                          ? Math.round((totalDelivered / totalOrdered) * 100)
                          : 0}
                        %)
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {formatEuro(data?.invoicedAmount || 0)}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Montant facturé (HT)
                      </p>
                      <div className="mt-2 h-2 rounded-full bg-zinc-100 overflow-hidden">
                        <div
                          className="h-full bg-rose-500 rounded-full transition-all"
                          style={{
                            width: `${totalDelivered > 0 ? Math.min(100, Math.round((totalInvoiced / totalDelivered) * 100)) : 0}%`,
                          }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatNumber(totalInvoiced)} pièces facturées
                        {totalDelivered > 0
                          ? ` (${Math.round((totalInvoiced / totalDelivered) * 100)}% du livré)`
                          : ""}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent>
                      <div
                        className={cn(
                          "text-2xl font-bold",
                          avgConformity >= 90
                            ? "text-emerald-600"
                            : avgConformity >= 70
                              ? "text-amber-600"
                              : "text-red-600"
                        )}
                      >
                        {avgConformity}%
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Conformité fournisseur moyenne
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {data!.clientBreakdown.length}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Clients suivis
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Charts grid */}
                <div className="grid gap-6 lg:grid-cols-2">
                  {/* Client ordered vs delivered */}
                  {data!.clientBreakdown.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">
                          Commandé / Livré / Facturé par client{" "}
                          {data!.totals && data!.totals.clients > data!.clientBreakdown.length && (
                            <span className="text-xs font-normal text-muted-foreground">
                              (top {data!.clientBreakdown.length} sur {data!.totals.clients} —
                              les tuiles ci-dessus portent sur toute la saison)
                            </span>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={320}>
                          <BarChart data={data!.clientBreakdown}>
                            <CartesianGrid
                              strokeDasharray="3 3"
                              stroke="#f0f0f0"
                            />
                            <XAxis
                              dataKey="name"
                              tick={{ fontSize: 11 }}
                              interval={0}
                              angle={-30}
                              textAnchor="end"
                              height={60}
                            />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Legend />
                            <Bar
                              dataKey="commandé"
                              fill="#3B82F6"
                              radius={[4, 4, 0, 0]}
                            />
                            <Bar
                              dataKey="livré"
                              fill="#10B981"
                              radius={[4, 4, 0, 0]}
                            />
                            <Bar
                              dataKey="facturé"
                              fill="#F43F5E"
                              radius={[4, 4, 0, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  )}

                  {/* NEW: Client deliveries breakdown (all statuses) */}
                  {data!.clientDeliveries && data!.clientDeliveries.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">
                          Livraisons globales par client
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={320}>
                          <BarChart data={data!.clientDeliveries}>
                            <CartesianGrid
                              strokeDasharray="3 3"
                              stroke="#f0f0f0"
                            />
                            <XAxis
                              dataKey="name"
                              tick={{ fontSize: 11 }}
                              interval={0}
                              angle={-30}
                              textAnchor="end"
                              height={60}
                            />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Legend />
                            <Bar
                              dataKey="planifiées"
                              stackId="a"
                              fill="#F59E0B"
                              radius={[0, 0, 0, 0]}
                            />
                            <Bar
                              dataKey="enPreparation"
                              stackId="a"
                              fill="#3B82F6"
                              name="en préparation"
                              radius={[0, 0, 0, 0]}
                            />
                            <Bar
                              dataKey="expédiées"
                              stackId="a"
                              fill="#10B981"
                              radius={[4, 4, 0, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  )}

                  {/* Supplier conformity */}
                  {data!.supplierConformity.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">
                          Conformité par fournisseur
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={320}>
                          <BarChart
                            data={data!.supplierConformity}
                            layout="vertical"
                          >
                            <CartesianGrid
                              strokeDasharray="3 3"
                              stroke="#f0f0f0"
                            />
                            <XAxis
                              type="number"
                              tick={{ fontSize: 11 }}
                              domain={[0, 100]}
                              unit="%"
                            />
                            <YAxis
                              dataKey="name"
                              type="category"
                              tick={{ fontSize: 11 }}
                              width={100}
                            />
                            <Tooltip
                              formatter={(value) => [`${value}%`, "Conformité"]}
                            />
                            <Bar dataKey="conformité" radius={[0, 4, 4, 0]}>
                              {data!.supplierConformity.map((entry, index) => (
                                <Cell
                                  key={`cell-${index}`}
                                  fill={
                                    entry.conformité >= 90
                                      ? "#10B981"
                                      : entry.conformité >= 70
                                        ? "#F59E0B"
                                        : "#EF4444"
                                  }
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  )}

                  {/* NEW: Supplier receptions detail */}
                  {data!.supplierReceptions && data!.supplierReceptions.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">
                          Réceptions globales par fournisseur
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={320}>
                          <BarChart data={data!.supplierReceptions}>
                            <CartesianGrid
                              strokeDasharray="3 3"
                              stroke="#f0f0f0"
                            />
                            <XAxis
                              dataKey="name"
                              tick={{ fontSize: 11 }}
                              interval={0}
                              angle={-30}
                              textAnchor="end"
                              height={60}
                            />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Legend />
                            <Bar
                              dataKey="commandé"
                              fill="#3B82F6"
                              radius={[4, 4, 0, 0]}
                            />
                            <Bar
                              dataKey="reçu"
                              fill="#10B981"
                              radius={[4, 4, 0, 0]}
                            />
                            <Bar
                              dataKey="manquant"
                              fill="#EF4444"
                              radius={[4, 4, 0, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  )}

                  {/* Client fulfillment rate */}
                  {clientFulfillment && clientFulfillment.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">
                          Taux de livraison par client
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {clientFulfillment.map((c) => (
                            <div key={c.name}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium">
                                  {c.name}
                                </span>
                                <span
                                  className={cn(
                                    "text-sm font-semibold",
                                    c["% livré"] >= 80
                                      ? "text-emerald-600"
                                      : c["% livré"] >= 50
                                        ? "text-amber-600"
                                        : "text-red-600"
                                  )}
                                >
                                  {c["% livré"]}%
                                </span>
                              </div>
                              <div className="h-2 rounded-full bg-zinc-100 overflow-hidden">
                                <div
                                  className={cn(
                                    "h-full rounded-full transition-all",
                                    c["% livré"] >= 80
                                      ? "bg-emerald-500"
                                      : c["% livré"] >= 50
                                        ? "bg-amber-500"
                                        : "bg-red-500"
                                  )}
                                  style={{ width: `${c["% livré"]}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Delivery status pie */}
                  {data!.deliveryStatus.some((d) => d.value > 0) && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">
                          Statut des livraisons
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="flex items-center justify-center">
                        <ResponsiveContainer width="100%" height={280}>
                          <PieChart>
                            <Pie
                              data={data!.deliveryStatus.filter(
                                (d) => d.value > 0
                              )}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={100}
                              paddingAngle={4}
                              dataKey="value"
                              label={({ name, value }) => `${name}: ${value}`}
                            >
                              {data!.deliveryStatus.map((_, index) => (
                                <Cell
                                  key={`cell-${index}`}
                                  fill={COLORS[index % COLORS.length]}
                                />
                              ))}
                            </Pie>
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  )}

                  {/* Statut de facturation pie */}
                  {data!.invoiceStatus?.some((d) => d.value > 0) && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">
                          Statut de facturation{" "}
                          <span className="text-xs font-normal text-muted-foreground">(facturé vs livré)</span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="flex items-center justify-center">
                        <ResponsiveContainer width="100%" height={280}>
                          <PieChart>
                            <Pie
                              data={data!.invoiceStatus.filter((d) => d.value > 0)}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={100}
                              paddingAngle={4}
                              dataKey="value"
                              label={({ name, value }) => `${name}: ${value}`}
                            >
                              {data!.invoiceStatus.filter((d) => d.value > 0).map((entry, index) => (
                                <Cell
                                  key={`cell-inv-${index}`}
                                  fill={INVOICE_COLORS[entry.name] || "#9CA3AF"}
                                />
                              ))}
                            </Pie>
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  )}

                  {/* Montant facturé par client (HT) */}
                  {clientAmounts.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">
                          Montant facturé par client{" "}
                          <span className="text-xs font-normal text-muted-foreground">(HT)</span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={Math.max(220, clientAmounts.length * 28 + 40)}>
                          <BarChart data={clientAmounts} layout="vertical" margin={{ left: 8, right: 24 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                            <XAxis
                              type="number"
                              tick={{ fontSize: 11 }}
                              tickFormatter={(v) => formatEuro(v)}
                            />
                            <YAxis
                              type="category"
                              dataKey="name"
                              width={120}
                              tick={{ fontSize: 11 }}
                              interval={0}
                            />
                            <Tooltip formatter={(value) => [formatEuro(Number(value)), "Montant HT"]} />
                            <Bar dataKey="montant" fill="#F43F5E" radius={[0, 4, 4, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* Delivery timeline full width */}
                {data!.deliveryTimeline.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Timeline des expéditions
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={data!.deliveryTimeline}>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="#f0f0f0"
                          />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip
                            formatter={(value) => [
                              `${value} pièces`,
                              "Quantité",
                            ]}
                            labelFormatter={(label) => `Date: ${label}`}
                          />
                          <Line
                            type="monotone"
                            dataKey="pièces"
                            stroke="#8B5CF6"
                            strokeWidth={2}
                            dot={{ fill: "#8B5CF6", r: 4 }}
                            activeDot={{ r: 6 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

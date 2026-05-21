"use client";

import { useEffect, useState } from "react";
import { useSeason } from "@/lib/season-context";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3 } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
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
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  LineChart,
  Line,
} from "recharts";

interface ChartData {
  clientBreakdown: {
    name: string;
    commandé: number;
    livré: number;
    restant: number;
  }[];
  supplierConformity: {
    name: string;
    commandé: number;
    reçu: number;
    conformité: number;
  }[];
  deliveryStatus: { name: string; value: number }[];
  deliveryTimeline: { date: string; client: string; pièces: number }[];
}

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

  useEffect(() => {
    if (!activeSeason) {
      setData(null);
      return;
    }
    setLoading(true);
    fetch(`/api/statistics/charts?seasonId=${activeSeason.id}`)
      .then((res) => res.json())
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeSeason]);

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

  const totalOrdered =
    data?.clientBreakdown.reduce((s, c) => s + c.commandé, 0) || 0;
  const totalDelivered =
    data?.clientBreakdown.reduce((s, c) => s + c.livré, 0) || 0;
  const avgConformity =
    data?.supplierConformity.length
      ? Math.round(
          data.supplierConformity.reduce((s, c) => s + c.conformité, 0) /
            data.supplierConformity.length
        )
      : 0;

  return (
    <div>
      <Topbar title="Statistiques" />
      <div className="p-8 space-y-6">
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
        ) : loading ? (
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
                Importez des commandes et des réceptions pour voir les
                statistiques.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Summary badges */}
            <div className="grid gap-4 sm:grid-cols-3">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold">
                    {formatNumber(totalOrdered)}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Total commandé
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
                <CardContent className="pt-6">
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
                <CardContent className="pt-6">
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
                      Commandé vs Livré par client
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
                      {clientFulfillment.map((c, i) => (
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
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
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
      </div>
    </div>
  );
}

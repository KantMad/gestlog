"use client";

import { useEffect, useState } from "react";
import { useSeason, formatSeasonLabel } from "@/lib/season-context";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ShoppingCart,
  Package,
  Truck,
  Users,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";
import { formatNumber, cn } from "@/lib/utils";
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
} from "recharts";

interface DashboardStats {
  totalOrders: number;
  totalPieces: number;
  receptionRate: number;
  deliveryRate: number;
  pendingAllocations: number;
  activeClients: number;
}

interface ChartData {
  clientBreakdown: { name: string; commandé: number; livré: number; restant: number }[];
  supplierConformity: { name: string; commandé: number; reçu: number; conformité: number }[];
  deliveryStatus: { name: string; value: number }[];
  deliveryTimeline: { date: string; client: string; pièces: number }[];
}

const PIE_COLORS = ["#3B82F6", "#F59E0B", "#10B981"];

export default function DashboardPage() {
  const { activeSeason, loading } = useSeason();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [charts, setCharts] = useState<ChartData | null>(null);

  useEffect(() => {
    if (!activeSeason) {
      setStats(null);
      setCharts(null);
      return;
    }
    fetch(`/api/statistics/season?seasonId=${activeSeason.id}`)
      .then((res) => res.json())
      .then((data) => setStats(data.data))
      .catch(() => {});

    fetch(`/api/statistics/charts?seasonId=${activeSeason.id}`)
      .then((res) => res.json())
      .then((data) => setCharts(data))
      .catch(() => {});
  }, [activeSeason]);

  const statCards = [
    {
      title: "Commandes clients",
      value: stats ? formatNumber(stats.totalOrders) : "—",
      icon: ShoppingCart,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      title: "Pièces commandées",
      value: stats ? formatNumber(stats.totalPieces) : "—",
      icon: Package,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
    {
      title: "Taux de réception",
      value: stats ? `${stats.receptionRate}%` : "—",
      icon: TrendingUp,
      color: "text-amber-600",
      bg: "bg-amber-50",
    },
    {
      title: "Taux de livraison",
      value: stats ? `${stats.deliveryRate}%` : "—",
      icon: Truck,
      color: "text-violet-600",
      bg: "bg-violet-50",
    },
    {
      title: "Clients actifs",
      value: stats ? formatNumber(stats.activeClients) : "—",
      icon: Users,
      color: "text-pink-600",
      bg: "bg-pink-50",
    },
    {
      title: "Répartitions en attente",
      value: stats ? formatNumber(stats.pendingAllocations) : "—",
      icon: AlertTriangle,
      color: "text-orange-600",
      bg: "bg-orange-50",
    },
  ];

  const hasChartData = charts && (
    charts.clientBreakdown.length > 0 ||
    charts.supplierConformity.length > 0 ||
    charts.deliveryStatus.some((d) => d.value > 0)
  );

  return (
    <div>
      <Topbar title="Tableau de bord" />
      <div className="p-8 space-y-8">
        <PageHeader
          title="Tableau de bord"
          description={
            activeSeason
              ? `${formatSeasonLabel(activeSeason)} — Vue d'ensemble`
              : "Sélectionnez une saison pour commencer"
          }
        />

        {!activeSeason && !loading && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Package className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                Bienvenue sur GestLog
              </h3>
              <p className="text-sm text-muted-foreground text-center max-w-md">
                Commencez par créer une saison avec le bouton &quot;Nouvelle
                saison&quot; en haut à droite pour démarrer.
              </p>
            </CardContent>
          </Card>
        )}

        {activeSeason && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {statCards.map((stat) => (
                <Card
                  key={stat.title}
                  className="transition-shadow hover:shadow-md"
                >
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {stat.title}
                    </CardTitle>
                    <div className={`rounded-lg p-2 ${stat.bg}`}>
                      <stat.icon className={`h-4 w-4 ${stat.color}`} />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{stat.value}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {hasChartData && (
              <div className="grid gap-6 lg:grid-cols-2">
                {charts!.clientBreakdown.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Répartition par client
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={charts!.clientBreakdown}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
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
                            dataKey="livré"
                            stackId="a"
                            fill="#10B981"
                            radius={[0, 0, 0, 0]}
                          />
                          <Bar
                            dataKey="restant"
                            stackId="a"
                            fill="#E5E7EB"
                            radius={[4, 4, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}

                {charts!.supplierConformity.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Conformité fournisseurs
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={charts!.supplierConformity}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
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
                          <Bar dataKey="commandé" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="reçu" fill="#10B981" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}

                {charts!.deliveryStatus.some((d) => d.value > 0) && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Statut des livraisons
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex items-center justify-center">
                      <ResponsiveContainer width="100%" height={250}>
                        <PieChart>
                          <Pie
                            data={charts!.deliveryStatus.filter(
                              (d) => d.value > 0
                            )}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={90}
                            paddingAngle={4}
                            dataKey="value"
                            label={({ name, value }) => `${name}: ${value}`}
                          >
                            {charts!.deliveryStatus.map((_, index) => (
                              <Cell
                                key={`cell-${index}`}
                                fill={PIE_COLORS[index % PIE_COLORS.length]}
                              />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}

                {charts!.deliveryTimeline.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Timeline livraisons
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={charts!.deliveryTimeline}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip
                            formatter={(value) => [
                              `${value} pièces`,
                              "Quantité",
                            ]}
                          />
                          <Bar dataKey="pièces" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

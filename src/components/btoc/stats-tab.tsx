"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  ShoppingCart,
  Euro,
  Users,
  TrendingUp,
  Package,
  Search,
  X,
  Loader2,
  BarChart3,
} from "lucide-react";
import { formatNumber } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from "recharts";

interface StatsData {
  overview: {
    totalOrders: number;
    totalRevenue: number;
    totalCustomers: number;
    avgOrderValue: number;
    totalItems: number;
  };
  revenueByMonth: { month: string; revenue: number; orders: number }[];
  topProducts: {
    name: string;
    sku: string | null;
    quantity: number;
    revenue: number;
  }[];
  topCategories: { category: string; quantity: number; revenue: number }[];
  ordersByStatus: { status: string; count: number }[];
  topCities: { city: string; orders: number; revenue: number }[];
  revenueByDay: { date: string; revenue: number; orders: number }[];
  sizeDistribution: { size: string; quantity: number }[];
  availableCategories: string[];
  availableParentProducts: { sku: string; name: string; wooId: number }[];
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

const STATUS_LABELS: Record<string, string> = {
  completed: "Terminée",
  processing: "En cours",
  pending: "En attente",
  "on-hold": "En pause",
  cancelled: "Annulée",
  refunded: "Remboursée",
  failed: "Échouée",
  trash: "Supprimée",
};

function formatEuro(n: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

export function BtocStatsTab() {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [category, setCategory] = useState("");
  const [parentProduct, setParentProduct] = useState("");
  const [filtersApplied, setFiltersApplied] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (category) params.set("category", category);
      if (parentProduct) params.set("parentProduct", parentProduct);

      const res = await fetch(`/api/btoc/stats?${params}`);
      if (!res.ok) throw new Error("Erreur API");
      const d = await res.json();
      setData(d);
    } catch (e) {
      console.error("Erreur chargement stats BtoC:", e);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, category, parentProduct]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const applyFilters = () => {
    setFiltersApplied(true);
    loadData();
  };

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setCategory("");
    setParentProduct("");
    setFiltersApplied(false);
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          Chargement des statistiques...
        </span>
      </div>
    );
  }

  if (!data) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
          <BarChart3 className="h-12 w-12 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            Aucune donnée disponible.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 mt-4">
      {/* ─── Filters ─────────────────────────────────── */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Date début
              </label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Date fin
              </label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Catégorie
              </label>
              <Select
                value={category || "all"}
                onValueChange={(v) => setCategory(!v || v === "all" ? "" : v)}
              >
                <SelectTrigger className="w-48 h-9">
                  <span className={`text-sm truncate ${!category ? "text-muted-foreground" : ""}`}>
                    {category || "Toutes"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes</SelectItem>
                  {data.availableCategories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Référence produit
              </label>
              <Select
                value={parentProduct || "all"}
                onValueChange={(v) => setParentProduct(!v || v === "all" ? "" : v)}
              >
                <SelectTrigger className="w-56 h-9">
                  <span className={`text-sm truncate ${!parentProduct ? "text-muted-foreground" : ""}`}>
                    {parentProduct || "Toutes"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes</SelectItem>
                  {data.availableParentProducts.map((p) => (
                    <SelectItem key={p.wooId} value={p.sku}>
                      {p.sku}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={applyFilters} size="sm" className="gap-1">
              <Search className="h-4 w-4" />
              Filtrer
            </Button>
            {filtersApplied && (
              <Button
                onClick={clearFilters}
                variant="ghost"
                size="sm"
                className="gap-1"
              >
                <X className="h-4 w-4" />
                Effacer
              </Button>
            )}
          </div>
          {filtersApplied && (
            <div className="mt-3 flex gap-2 flex-wrap">
              {dateFrom && (
                <Badge variant="secondary">Depuis : {dateFrom}</Badge>
              )}
              {dateTo && (
                <Badge variant="secondary">{"Jusqu'au"} : {dateTo}</Badge>
              )}
              {category && (
                <Badge variant="secondary">Catégorie : {category}</Badge>
              )}
              {parentProduct && (
                <Badge variant="secondary">Réf. : {parentProduct}</Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── KPI Cards ───────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                <ShoppingCart className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {formatNumber(data.overview.totalOrders)}
                </div>
                <p className="text-xs text-muted-foreground">Commandes</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50">
                <Euro className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {formatEuro(data.overview.totalRevenue)}
                </div>
                <p className="text-xs text-muted-foreground">
                  Chiffre d&apos;affaires
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50">
                <Users className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {formatNumber(data.overview.totalCustomers)}
                </div>
                <p className="text-xs text-muted-foreground">Clients</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50">
                <TrendingUp className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {formatEuro(data.overview.avgOrderValue)}
                </div>
                <p className="text-xs text-muted-foreground">Panier moyen</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50">
                <Package className="h-5 w-5 text-rose-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {formatNumber(data.overview.totalItems)}
                </div>
                <p className="text-xs text-muted-foreground">Articles vendus</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Charts ──────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Revenue by month */}
        {data.revenueByMonth.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">CA par mois</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={data.revenueByMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                  />
                  <Tooltip
                    formatter={(value) => [formatEuro(Number(value)), "CA"]}
                  />
                  <Bar
                    dataKey="revenue"
                    name="CA"
                    fill="#3B82F6"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Orders by month (line) */}
        {data.revenueByMonth.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Commandes par mois</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={data.revenueByMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="orders"
                    name="Commandes"
                    stroke="#8B5CF6"
                    strokeWidth={2}
                    dot={{ fill: "#8B5CF6", r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Top products */}
        {data.topProducts.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">
                Top 15 produits par CA
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart
                  data={data.topProducts.map((p) => ({
                    ...p,
                    name:
                      p.name.length > 35
                        ? p.name.slice(0, 32) + "..."
                        : p.name,
                  }))}
                  layout="vertical"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => formatEuro(v)}
                  />
                  <YAxis
                    dataKey="name"
                    type="category"
                    tick={{ fontSize: 10 }}
                    width={200}
                  />
                  <Tooltip
                    formatter={(value, name) => [
                      name === "revenue"
                        ? formatEuro(Number(value))
                        : formatNumber(Number(value)),
                      name === "revenue" ? "CA" : "Quantité",
                    ]}
                  />
                  <Bar
                    dataKey="revenue"
                    name="CA"
                    fill="#10B981"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Orders by status (pie) */}
        {data.ordersByStatus.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Commandes par statut
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-center">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={data.ordersByStatus.map((s) => ({
                      name: STATUS_LABELS[s.status] || s.status,
                      value: s.count,
                    }))}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={95}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {data.ordersByStatus.map((_, index) => (
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

        {/* Top categories */}
        {data.topCategories.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">CA par catégorie</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={data.topCategories.map((c) => ({
                      name: c.category,
                      value: c.revenue,
                    }))}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={95}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name }) => name}
                  >
                    {data.topCategories.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => [formatEuro(Number(value)), "CA"]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Size distribution */}
        {data.sizeDistribution.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Distribution par taille
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.sizeDistribution}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="size" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value) => [
                      formatNumber(Number(value)),
                      "Quantité",
                    ]}
                  />
                  <Bar
                    dataKey="quantity"
                    name="Quantité"
                    fill="#F59E0B"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Top cities */}
        {data.topCities.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Top villes par CA
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={data.topCities.slice(0, 10)}
                  layout="vertical"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => formatEuro(v)}
                  />
                  <YAxis
                    dataKey="city"
                    type="category"
                    tick={{ fontSize: 11 }}
                    width={120}
                  />
                  <Tooltip
                    formatter={(value) => [formatEuro(Number(value)), "CA"]}
                  />
                  <Bar
                    dataKey="revenue"
                    name="CA"
                    fill="#EC4899"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Revenue by day (full width, shown when date range set) */}
      {data.revenueByDay.length > 0 && data.revenueByDay.length <= 365 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">CA par jour</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={data.revenueByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                />
                <Tooltip
                  formatter={(value) => [formatEuro(Number(value)), "CA"]}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  name="CA"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

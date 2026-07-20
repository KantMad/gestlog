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
    netRevenue: number;
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
    colors: { color: string; quantity: number; revenue: number }[];
  }[];
  topProductsByQty: {
    name: string;
    sku: string | null;
    quantity: number;
    revenue: number;
    colors: { color: string; quantity: number; revenue: number }[];
  }[];
  topCategories: { category: string; quantity: number; revenue: number }[];
  topCountries: { country: string; orders: number; revenue: number }[];
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

const COUNTRY_NAMES: Record<string, string> = {
  FR: "France", BE: "Belgique", GB: "Royaume-Uni", DE: "Allemagne", ES: "Espagne",
  IT: "Italie", NL: "Pays-Bas", CH: "Suisse", LU: "Luxembourg", PT: "Portugal",
  DK: "Danemark", SE: "Suède", GR: "Grèce", AT: "Autriche", IE: "Irlande",
  US: "États-Unis", CA: "Canada", MC: "Monaco", FI: "Finlande", NO: "Norvège",
  PL: "Pologne", CZ: "Tchéquie", RE: "Réunion", GP: "Guadeloupe", MQ: "Martinique",
};
function countryLabel(code: string): string {
  if (!code || code === "Inconnu") return "Inconnu";
  return COUNTRY_NAMES[code.toUpperCase()] || code;
}

function formatEuro(n: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

// Bascule CA / Quantité (réutilisé dans le Top 15 produits et le graphe par catégorie).
function MetricToggle({
  metric,
  onChange,
}: {
  metric: "ca" | "qty";
  onChange: (m: "ca" | "qty") => void;
}) {
  const btn = (active: boolean) =>
    `px-2.5 py-1 rounded text-xs font-medium transition-colors ${
      active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
    }`;
  return (
    <div className="inline-flex shrink-0 items-center rounded-md border p-0.5">
      <button type="button" onClick={() => onChange("ca")} className={btn(metric === "ca")}>
        CA
      </button>
      <button type="button" onClick={() => onChange("qty")} className={btn(metric === "qty")}>
        Quantité
      </button>
    </div>
  );
}

// Infobulle du Top 15 produits : total + détail PAR COLORIS (code couleur).
function ProductTooltip({
  active,
  payload,
  metric,
}: {
  active?: boolean;
  payload?: {
    payload: {
      fullName?: string;
      name: string;
      revenue: number;
      quantity: number;
      colors?: { color: string; quantity: number; revenue: number }[];
    };
  }[];
  metric: "ca" | "qty";
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const fmt = (n: number) => (metric === "ca" ? formatEuro(n) : formatNumber(n));
  const colors = [...(p.colors || [])].sort((a, b) =>
    metric === "ca" ? b.revenue - a.revenue : b.quantity - a.quantity
  );
  return (
    <div className="max-w-xs rounded-md border bg-popover p-2.5 text-xs shadow-md">
      <p className="mb-1 font-medium text-foreground">{p.fullName || p.name}</p>
      <p className="mb-1.5 text-muted-foreground">
        Total :{" "}
        <span className="font-semibold text-foreground">
          {fmt(metric === "ca" ? p.revenue : p.quantity)}
        </span>
      </p>
      {colors.length > 0 && (
        <div className="space-y-0.5 border-t pt-1.5">
          <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            Par coloris ({colors.length})
          </p>
          {colors.slice(0, 12).map((c) => (
            <div key={c.color} className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Coloris {c.color}</span>
              <span className="font-mono text-foreground">
                {fmt(metric === "ca" ? c.revenue : c.quantity)}
              </span>
            </div>
          ))}
          {colors.length > 12 && (
            <div className="pt-0.5 text-muted-foreground">
              … et {colors.length - 12} autre{colors.length - 12 > 1 ? "s" : ""} coloris
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function BtocStatsTab() {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  // Bascule d'affichage CA / Quantité pour le Top 15 produits et le graphe par catégorie.
  const [metric, setMetric] = useState<"ca" | "qty">("ca");

  // Filters
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [category, setCategory] = useState("");
  const [parentProduct, setParentProduct] = useState("");
  const [filtersApplied, setFiltersApplied] = useState(false);

  // Répartition des tailles par sous-catégorie BtoB
  const [sizeDist, setSizeDist] = useState<
    { subCategory: string; total: number; sizes: { size: string; qty: number; pct: number }[] }[]
  >([]);
  const [selectedSubCat, setSelectedSubCat] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (category) params.set("category", category);
      if (parentProduct) params.set("parentProduct", parentProduct);

      const [res, sdRes] = await Promise.all([
        fetch(`/api/btoc/stats?${params}`),
        fetch(`/api/btoc/size-distribution?${params}`),
      ]);
      if (!res.ok) throw new Error("Erreur API");
      const d = await res.json();
      setData(d);
      if (sdRes.ok) {
        const sd = await sdRes.json();
        setSizeDist(sd.subCategories || []);
        setSelectedSubCat((prev) => prev || (sd.subCategories?.[0]?.subCategory ?? ""));
      }
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
              <label className="block text-xs font-medium text-muted-foreground">
                Date début
              </label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-40 h-9"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Date fin
              </label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-40 h-9"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
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
              <label className="block text-xs font-medium text-muted-foreground">
                Référence produit
              </label>
              {/* Recherche PARTIELLE sur la référence (SKU) uniquement — pas le libellé/titre.
                  L'API filtre en « sku ILIKE %saisie% » : la suite de caractères peut être
                  au début, au milieu ou à la fin de la référence. Datalist = autocomplétion. */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  list="btoc-parent-skus"
                  placeholder="Réf. contient… (ex. TSM)"
                  value={parentProduct}
                  onChange={(e) => setParentProduct(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  className="pl-9 w-56 h-9"
                />
                <datalist id="btoc-parent-skus">
                  {data.availableParentProducts.map((p) => (
                    <option key={p.wooId} value={p.sku}>
                      {p.name}
                    </option>
                  ))}
                </datalist>
              </div>
            </div>
            <Button onClick={applyFilters} className="gap-1 h-9">
              <Search className="h-4 w-4" />
              Filtrer
            </Button>
            {filtersApplied && (
              <Button
                onClick={clearFilters}
                variant="ghost"
                className="gap-1 h-9"
              >
                <X className="h-4 w-4" />
                Effacer
              </Button>
            )}
          </div>
          {filtersApplied && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
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
                  CA TTC encaissé
                </p>
                {/* Net HT (hors TVA et frais de port) : rapproche la « Ventes nettes » de
                    WooCommerce. Peut différer de quelques euros — la synchro ne transmet pas
                    le sous-total avant remise que WooCommerce utilise pour son calcul. */}
                <p
                  className="mt-0.5 text-xs font-medium text-muted-foreground"
                  title="Chiffre d'affaires hors TVA et hors frais de port (proche des « Ventes nettes » WooCommerce)"
                >
                  {formatEuro(data.overview.netRevenue)} HT
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
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">
                Top 15 produits par {metric === "ca" ? "CA" : "quantité"}
              </CardTitle>
              <MetricToggle metric={metric} onChange={setMetric} />
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart
                  data={(metric === "ca" ? data.topProducts : data.topProductsByQty).map((p) => ({
                    ...p,
                    fullName: p.name,
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
                    tickFormatter={(v) => (metric === "ca" ? formatEuro(v) : formatNumber(v))}
                  />
                  <YAxis
                    dataKey="name"
                    type="category"
                    tick={{ fontSize: 10 }}
                    width={200}
                  />
                  <Tooltip content={<ProductTooltip metric={metric} />} />
                  <Bar
                    dataKey={metric === "ca" ? "revenue" : "quantity"}
                    name={metric === "ca" ? "CA" : "Quantité"}
                    fill={metric === "ca" ? "#10B981" : "#6366F1"}
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
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">
                {metric === "ca" ? "CA" : "Quantité"} par catégorie
              </CardTitle>
              <MetricToggle metric={metric} onChange={setMetric} />
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={[...data.topCategories]
                      .sort((a, b) =>
                        metric === "ca" ? b.revenue - a.revenue : b.quantity - a.quantity
                      )
                      .map((c) => ({
                        name: c.category,
                        value: metric === "ca" ? c.revenue : c.quantity,
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
                    formatter={(value) => [
                      metric === "ca" ? formatEuro(Number(value)) : formatNumber(Number(value)),
                      metric === "ca" ? "CA" : "Quantité",
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Top pays */}
        {data.topCountries.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top pays par CA</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.topCountries.map((c) => {
                  const max = Math.max(...data.topCountries.map((x) => x.revenue), 1);
                  return (
                    <div key={c.country} className="flex items-center gap-3">
                      <span className="w-28 truncate text-sm font-medium">{countryLabel(c.country)}</span>
                      <div className="h-6 flex-1 overflow-hidden rounded bg-muted">
                        <div
                          className="h-full rounded bg-emerald-500"
                          style={{ width: `${(c.revenue / max) * 100}%` }}
                        />
                      </div>
                      <span className="w-32 text-right text-sm tabular-nums">
                        {formatEuro(c.revenue)}{" "}
                        <span className="text-muted-foreground">({formatNumber(c.orders)})</span>
                      </span>
                    </div>
                  );
                })}
              </div>
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

      {/* Répartition des tailles par sous-catégorie BtoB */}
      {sizeDist.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <CardTitle className="text-base">
                Répartition des tailles vendues — par sous-catégorie BtoB
              </CardTitle>
              <Select value={selectedSubCat} onValueChange={(v) => v && setSelectedSubCat(v)}>
                <SelectTrigger className="w-72 h-9">
                  <span className="text-sm truncate">{selectedSubCat || "Choisir une sous-catégorie"}</span>
                </SelectTrigger>
                <SelectContent>
                  {sizeDist.map((s) => (
                    <SelectItem key={s.subCategory} value={s.subCategory}>
                      {s.subCategory} ({formatNumber(s.total)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {(() => {
              const sel = sizeDist.find((s) => s.subCategory === selectedSubCat);
              if (!sel) return <p className="text-sm text-muted-foreground">Aucune donnée.</p>;
              return (
                <div className="space-y-2">
                  <p className="mb-4 text-xs text-muted-foreground">
                    {formatNumber(sel.total)} pièces vendues — pourcentage de chaque taille
                  </p>
                  {sel.sizes.map((x) => (
                    <div key={x.size} className="flex items-center gap-3">
                      <span className="w-12 text-right text-sm font-medium">{x.size}</span>
                      <div className="h-6 flex-1 overflow-hidden rounded bg-muted">
                        <div
                          className="h-full rounded bg-blue-500"
                          style={{ width: `${x.pct}%` }}
                        />
                      </div>
                      <span className="w-28 text-right text-sm tabular-nums">
                        {x.pct}%{" "}
                        <span className="text-muted-foreground">({formatNumber(x.qty)})</span>
                      </span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

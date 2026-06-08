"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  X,
  Loader2,
  Users,
  Download,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { formatNumber } from "@/lib/utils";
import * as XLSX from "xlsx";

interface Customer {
  id: string;
  wooId: number;
  email: string;
  firstName: string;
  lastName: string;
  company: string | null;
  phone: string | null;
  billingCity: string | null;
  billingCountry: string | null;
  totalSpent: number;
  ordersCount: number;
  lastOrderDate: string | null;
  orderedProducts: string[];
}

interface CustomerData {
  customers: Customer[];
  total: number;
  page: number;
  limit: number;
  availableSizes: string[];
  availableCities: string[];
}

interface ExportFields {
  [key: string]: boolean;
}

const FIELD_LABELS: Record<string, string> = {
  email: "Email",
  firstName: "Prénom",
  lastName: "Nom",
  company: "Entreprise",
  phone: "Téléphone",
  billingCity: "Ville facturation",
  billingCountry: "Pays facturation",
  shippingCity: "Ville livraison",
  shippingCountry: "Pays livraison",
  totalSpent: "Total dépensé",
  ordersCount: "Nb commandes",
};

function formatEuro(n: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(n);
}

export function BtocClientsTab() {
  const [data, setData] = useState<CustomerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [productName, setProductName] = useState("");
  const [size, setSize] = useState("");
  const [city, setCity] = useState("");
  const [page, setPage] = useState(1);

  // Export fields config
  const [exportFields, setExportFields] = useState<ExportFields | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", "50");
      if (search) params.set("search", search);
      if (productName) params.set("productName", productName);
      if (size) params.set("size", size);
      if (city) params.set("city", city);

      const res = await fetch(`/api/btoc/customers?${params}`);
      if (!res.ok) throw new Error("Erreur API");
      const d = await res.json();
      setData(d);
    } catch (e) {
      console.error("Erreur chargement clients BtoC:", e);
    } finally {
      setLoading(false);
    }
  }, [page, search, productName, size, city]);

  // Load export fields on mount
  useEffect(() => {
    fetch("/api/btoc/settings")
      .then((r) => r.json())
      .then((d) => setExportFields(d.fields))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const applySearch = () => {
    setPage(1);
    loadData();
  };

  const clearFilters = () => {
    setSearch("");
    setProductName("");
    setSize("");
    setCity("");
    setPage(1);
  };

  const hasFilters = search || productName || size || city;

  // ─── Export XLSX ──────────────────────────────────
  const handleExport = async () => {
    setExporting(true);
    try {
      // Fetch ALL matching customers (no pagination)
      const params = new URLSearchParams();
      params.set("page", "1");
      params.set("limit", "200");
      if (search) params.set("search", search);
      if (productName) params.set("productName", productName);
      if (size) params.set("size", size);
      if (city) params.set("city", city);

      // Paginate to get all results
      let allCustomers: Customer[] = [];
      let currentPage = 1;
      let hasMore = true;

      while (hasMore) {
        params.set("page", String(currentPage));
        const res = await fetch(`/api/btoc/customers?${params}`);
        const d = await res.json();
        allCustomers = [...allCustomers, ...d.customers];
        hasMore = allCustomers.length < d.total;
        currentPage++;
        if (currentPage > 100) break; // Safety limit
      }

      // Determine which fields to export
      const fields = exportFields || Object.fromEntries(
        Object.keys(FIELD_LABELS).map((k) => [k, true])
      );

      // Build export data
      const rows = allCustomers.map((c) => {
        const row: Record<string, string | number> = {};
        if (fields.firstName) row["Prénom"] = c.firstName;
        if (fields.lastName) row["Nom"] = c.lastName;
        if (fields.email) row["Email"] = c.email;
        if (fields.company) row["Entreprise"] = c.company || "";
        if (fields.phone) row["Téléphone"] = c.phone || "";
        if (fields.billingCity) row["Ville"] = c.billingCity || "";
        if (fields.billingCountry) row["Pays"] = c.billingCountry || "";
        if (fields.totalSpent) row["Total dépensé"] = c.totalSpent;
        if (fields.ordersCount) row["Nb commandes"] = c.ordersCount;
        // Always include last order and products
        row["Dernière commande"] = c.lastOrderDate
          ? new Date(c.lastOrderDate).toLocaleDateString("fr-FR")
          : "";
        row["Produits commandés"] = c.orderedProducts.slice(0, 10).join(", ");
        return row;
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Clients BtoC");

      // Auto-size columns
      const maxWidths = Object.keys(rows[0] || {}).map((key) => ({
        wch: Math.max(
          key.length,
          ...rows.map((r) => String(r[key] || "").length)
        ),
      }));
      ws["!cols"] = maxWidths;

      XLSX.writeFile(
        wb,
        `clients-btoc${hasFilters ? "-filtre" : ""}-${new Date().toISOString().slice(0, 10)}.xlsx`
      );
    } catch (e) {
      console.error("Erreur export:", e);
    } finally {
      setExporting(false);
    }
  };

  const totalPages = data ? Math.ceil(data.total / data.limit) : 0;

  return (
    <div className="space-y-6 mt-4">
      {/* ─── Filters ─────────────────────────────────── */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Recherche
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Nom, email, entreprise..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applySearch()}
                  className="pl-10 w-64"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Produit commandé
              </label>
              <Input
                placeholder="Nom du produit..."
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applySearch()}
                className="w-52"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Taille commandée
              </label>
              <select
                value={size}
                onChange={(e) => {
                  setSize(e.target.value);
                  setPage(1);
                }}
                className="flex h-9 w-32 items-center rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Toutes</option>
                {data?.availableSizes.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Ville
              </label>
              <select
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                  setPage(1);
                }}
                className="flex h-9 w-40 items-center rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Toutes</option>
                {data?.availableCities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={applySearch} size="sm" className="gap-1">
              <Search className="h-4 w-4" />
              Rechercher
            </Button>
            {hasFilters && (
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
          {hasFilters && (
            <div className="mt-3 flex gap-2 flex-wrap">
              {search && (
                <Badge variant="secondary">Recherche : {search}</Badge>
              )}
              {productName && (
                <Badge variant="secondary">Produit : {productName}</Badge>
              )}
              {size && <Badge variant="secondary">Taille : {size}</Badge>}
              {city && <Badge variant="secondary">Ville : {city}</Badge>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Header with count and export ────────────── */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {data ? (
            <>
              <span className="font-semibold text-foreground">
                {formatNumber(data.total)}
              </span>{" "}
              client{data.total > 1 ? "s" : ""} trouvé
              {data.total > 1 ? "s" : ""}
            </>
          ) : (
            "Chargement..."
          )}
        </div>
        <Button
          onClick={handleExport}
          disabled={exporting || !data || data.total === 0}
          size="sm"
          variant="outline"
          className="gap-2"
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Exporter XLSX
        </Button>
      </div>

      {/* ─── Client Table ────────────────────────────── */}
      {loading && !data ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">
            Chargement...
          </span>
        </div>
      ) : data && data.customers.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
            <Users className="h-12 w-12 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Aucun client trouvé
              {hasFilters ? " pour ces critères." : "."}
            </p>
          </CardContent>
        </Card>
      ) : data ? (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Client
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Email
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Ville
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Commandes
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Total dépensé
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Dernière commande
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Produits commandés
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.customers.map((customer) => (
                      <tr
                        key={customer.id}
                        className="hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div>
                            <div className="text-sm font-medium">
                              {customer.firstName} {customer.lastName}
                            </div>
                            {customer.company && (
                              <div className="text-xs text-muted-foreground">
                                {customer.company}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {customer.email}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {customer.billingCity || "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-medium">
                          {customer.ordersCount}
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-medium">
                          {formatEuro(customer.totalSpent)}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {customer.lastOrderDate
                            ? new Date(
                                customer.lastOrderDate
                              ).toLocaleDateString("fr-FR")
                            : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {customer.orderedProducts
                              .slice(0, 3)
                              .map((prod, i) => (
                                <Badge
                                  key={i}
                                  variant="secondary"
                                  className="text-xs truncate max-w-[150px]"
                                >
                                  {prod}
                                </Badge>
                              ))}
                            {customer.orderedProducts.length > 3 && (
                              <Badge
                                variant="secondary"
                                className="text-xs"
                              >
                                +{customer.orderedProducts.length - 3}
                              </Badge>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* ─── Pagination ──────────────────────────────── */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {page} sur {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="gap-1"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Précédent
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="gap-1"
                >
                  Suivant
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

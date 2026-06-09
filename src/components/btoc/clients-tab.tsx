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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  const [productRef, setProductRef] = useState("");
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
      if (productRef) params.set("productRef", productRef);
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
  }, [page, search, productRef, size, city]);

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
    setProductRef("");
    setSize("");
    setCity("");
    setPage(1);
  };

  const hasFilters = search || productRef || size || city;

  // ─── Export XLSX ──────────────────────────────────
  const handleExport = async () => {
    setExporting(true);
    try {
      // Fetch ALL matching customers (no pagination)
      const params = new URLSearchParams();
      params.set("page", "1");
      params.set("limit", "200");
      if (search) params.set("search", search);
      if (productRef) params.set("productRef", productRef);
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
              <label className="block text-xs font-medium text-muted-foreground">
                Recherche
              </label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Nom, email, entreprise..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applySearch()}
                  className="pl-9 w-64 h-9"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Référence produit
              </label>
              <Input
                placeholder="Référence..."
                value={productRef}
                onChange={(e) => setProductRef(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applySearch()}
                className="w-52 h-9"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Taille commandée
              </label>
              <Select
                value={size || "all"}
                onValueChange={(v) => {
                  setSize(!v || v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-32 h-9">
                  <span className={`text-sm truncate ${!size ? "text-muted-foreground" : ""}`}>
                    {size || "Toutes"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes</SelectItem>
                  {data?.availableSizes.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Ville
              </label>
              <Select
                value={city || "all"}
                onValueChange={(v) => {
                  setCity(!v || v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-40 h-9">
                  <span className={`text-sm truncate ${!city ? "text-muted-foreground" : ""}`}>
                    {city || "Toutes"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes</SelectItem>
                  {data?.availableCities.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={applySearch} className="gap-1 h-9">
              <Search className="h-4 w-4" />
              Rechercher
            </Button>
            {hasFilters && (
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
          {hasFilters && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {search && (
                <Badge variant="secondary">Recherche : {search}</Badge>
              )}
              {productRef && (
                <Badge variant="secondary">Réf. : {productRef}</Badge>
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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Ville</TableHead>
                      <TableHead className="text-right">Commandes</TableHead>
                      <TableHead className="text-right">Total dépensé</TableHead>
                      <TableHead>Dernière commande</TableHead>
                      <TableHead>Produits commandés</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.customers.map((customer) => (
                      <TableRow key={customer.id}>
                        <TableCell>
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
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {customer.email}
                        </TableCell>
                        <TableCell className="text-sm">
                          {customer.billingCity || "—"}
                        </TableCell>
                        <TableCell className="text-sm text-right font-medium tabular-nums">
                          {customer.ordersCount}
                        </TableCell>
                        <TableCell className="text-sm text-right font-medium tabular-nums">
                          {formatEuro(customer.totalSpent)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {customer.lastOrderDate
                            ? new Date(
                                customer.lastOrderDate
                              ).toLocaleDateString("fr-FR")
                            : "—"}
                        </TableCell>
                        <TableCell>
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
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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

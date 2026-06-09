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
  SelectValue,
} from "@/components/ui/select";
import {
  Download,
  Loader2,
  Package,
  ShoppingCart,
  Users,
  Filter,
} from "lucide-react";
import { formatNumber } from "@/lib/utils";
import * as XLSX from "xlsx";

// ─── Types ──────────────────────────────────────────
interface ExportFields {
  [key: string]: boolean;
}

interface ProductRow {
  name: string;
  sku: string | null;
  type: string;
  category: string | null;
  price: number | null;
  regularPrice: number | null;
  salePrice: number | null;
  stockQuantity: number | null;
  stockStatus: string | null;
}

interface SizeColumn {
  position: number;
  header: string;
}

interface OrderRow {
  productName: string;
  parentRef: string;
  colorNum: string;
  btocColor: string;
  btobColor: string;
  btocCategory: string;
  sizeTypeCode: string;
  totalQuantity: number;
  totalRevenue: number;
  quantities: Record<number, number>; // position → quantity
}

interface CustomerRow {
  firstName: string;
  lastName: string;
  email: string;
  company: string | null;
  phone: string | null;
  billingCity: string | null;
  billingCountry: string | null;
  totalSpent: number;
  ordersCount: number;
  lastOrderDate: string | null;
  orderedProducts: string[];
}

// ─── Field Labels ───────────────────────────────────
const PRODUCT_FIELD_LABELS: Record<string, string> = {
  name: "Nom",
  sku: "SKU",
  type: "Type",
  category: "Catégorie",
  price: "Prix",
  regularPrice: "Prix régulier",
  salePrice: "Prix soldé",
  stockQuantity: "Stock",
  stockStatus: "Statut stock",
};

const ORDER_FIELD_LABELS: Record<string, string> = {
  reference: "Référence produit",
  sku: "SKU",
  colorCode: "Code Couleur",
  colorBtob: "Couleur BtoB",
  color: "Couleur BtoC",
  category: "Catégorie BtoC",
  categoryBtob: "Type produit BtoB",
  totalQuantity: "Quantité totale",
  totalRevenue: "CA total",
  sizes: "Tailles (colonnes)",
};

const CUSTOMER_FIELD_LABELS: Record<string, string> = {
  email: "Email",
  firstName: "Prénom",
  lastName: "Nom",
  company: "Entreprise",
  phone: "Téléphone",
  billingCity: "Ville",
  billingCountry: "Pays",
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

// ─── Main Component ─────────────────────────────────
export function BtocExportTab() {
  // Export fields config
  const [fieldsConfig, setFieldsConfig] = useState<Record<string, ExportFields>>({});

  // Loading states
  const [exportingProducts, setExportingProducts] = useState(false);
  const [exportingOrders, setExportingOrders] = useState(false);
  const [exportingCustomers, setExportingCustomers] = useState(false);

  // Product filters
  const [prodSearch, setProdSearch] = useState("");
  const [prodCategory, setProdCategory] = useState("");
  const [prodCategories, setProdCategories] = useState<string[]>([]);

  // Order filters
  const [orderDateFrom, setOrderDateFrom] = useState("");
  const [orderDateTo, setOrderDateTo] = useState("");
  const [orderProduct, setOrderProduct] = useState("");
  const [orderColor, setOrderColor] = useState("");
  const [orderSize, setOrderSize] = useState("");
  const [orderCustomer, setOrderCustomer] = useState("");
  const [orderColors, setOrderColors] = useState<string[]>([]);
  const [orderSizes, setOrderSizes] = useState<string[]>([]);

  // Customer filters
  const [custSearch, setCustSearch] = useState("");
  const [custProduct, setCustProduct] = useState("");
  const [custSize, setCustSize] = useState("");
  const [custCity, setCustCity] = useState("");
  const [custSizes, setCustSizes] = useState<string[]>([]);
  const [custCities, setCustCities] = useState<string[]>([]);

  // Load export settings + filter options on mount
  useEffect(() => {
    fetch("/api/btoc/settings")
      .then((r) => r.json())
      .then((d) => setFieldsConfig(d.fields || {}))
      .catch(() => {});

    // Load product categories
    fetch("/api/btoc/export/products?search=&category=")
      .then((r) => r.json())
      .then((d) => setProdCategories(d.availableCategories || []))
      .catch(() => {});

    // Load order filter options
    fetch("/api/btoc/export/orders")
      .then((r) => r.json())
      .then((d) => {
        setOrderColors(d.availableColors || []);
        setOrderSizes(d.availableSizes || []);
      })
      .catch(() => {});

    // Load customer filter options
    fetch("/api/btoc/customers?page=1&limit=1")
      .then((r) => r.json())
      .then((d) => {
        setCustSizes(d.availableSizes || []);
        setCustCities(d.availableCities || []);
      })
      .catch(() => {});
  }, []);

  // ─── Export Products ──────────────────────────────
  const handleExportProducts = async () => {
    setExportingProducts(true);
    try {
      const params = new URLSearchParams();
      if (prodSearch) params.set("search", prodSearch);
      if (prodCategory) params.set("category", prodCategory);

      const res = await fetch(`/api/btoc/export/products?${params}`);
      const data = await res.json();
      const products: ProductRow[] = data.products || [];
      const fields = fieldsConfig.products || Object.fromEntries(
        Object.keys(PRODUCT_FIELD_LABELS).map((k) => [k, true])
      );

      const rows = products.map((p) => {
        const row: Record<string, string | number> = {};
        if (fields.name) row["Nom"] = p.name;
        if (fields.sku) row["SKU"] = p.sku || "";
        if (fields.type) row["Type"] = p.type;
        if (fields.category) row["Catégorie"] = p.category || "";
        if (fields.price) row["Prix"] = p.price ?? "";
        if (fields.regularPrice) row["Prix régulier"] = p.regularPrice ?? "";
        if (fields.salePrice) row["Prix soldé"] = p.salePrice ?? "";
        if (fields.stockQuantity) row["Stock"] = p.stockQuantity ?? "";
        if (fields.stockStatus) row["Statut stock"] = p.stockStatus || "";
        return row;
      });

      downloadXLSX(rows, "Produits BtoC", `produits-btoc-${today()}.xlsx`);
    } catch (e) {
      console.error("Erreur export produits:", e);
    } finally {
      setExportingProducts(false);
    }
  };

  // ─── Export Orders (grouped by ref+color, sizes as cols) ──
  const handleExportOrders = async () => {
    setExportingOrders(true);
    try {
      const params = new URLSearchParams();
      if (orderDateFrom) params.set("dateFrom", orderDateFrom);
      if (orderDateTo) params.set("dateTo", orderDateTo);
      if (orderProduct) params.set("productName", orderProduct);
      if (orderColor) params.set("color", orderColor);
      if (orderSize) params.set("size", orderSize);
      if (orderCustomer) params.set("customerName", orderCustomer);

      const res = await fetch(`/api/btoc/export/orders?${params}`);
      const data = await res.json();
      const orderRows: OrderRow[] = data.rows || [];
      const sizeColumns: SizeColumn[] = data.sizeColumns || [];
      const fields = fieldsConfig.orders || Object.fromEntries(
        Object.keys(ORDER_FIELD_LABELS).map((k) => [k, true])
      );

      // Build XLSX rows: fixed columns + size columns by BtoB position
      const rows = orderRows.map((o) => {
        const row: Record<string, string | number> = {};
        // Fixed columns — Référence first
        if (fields.reference) row["Référence"] = o.productName;
        if (fields.sku) row["SKU"] = o.parentRef;
        if (fields.colorCode) row["Code Couleur"] = o.colorNum;
        if (fields.colorBtob) row["Couleur BtoB"] = o.btobColor;
        if (fields.color) row["Couleur BtoC"] = o.btocColor;
        if (fields.category) row["Catégorie BtoC"] = o.btocCategory;
        if (fields.categoryBtob) row["Type BtoB"] = o.sizeTypeCode;
        if (fields.totalQuantity) row["Total Qté"] = o.totalQuantity;
        if (fields.totalRevenue) row["CA Total"] = o.totalRevenue;
        // Size columns AFTER CA Total — grouped by BtoB position ranking
        if (fields.sizes) {
          for (const col of sizeColumns) {
            row[col.header] = o.quantities[col.position] ?? "";
          }
        }
        return row;
      });

      downloadXLSX(rows, "Ventes BtoC", `ventes-btoc-${today()}.xlsx`);
    } catch (e) {
      console.error("Erreur export ventes:", e);
    } finally {
      setExportingOrders(false);
    }
  };

  // ─── Export Customers ─────────────────────────────
  const handleExportCustomers = async () => {
    setExportingCustomers(true);
    try {
      // Paginate to get all matching customers
      const params = new URLSearchParams();
      params.set("limit", "200");
      if (custSearch) params.set("search", custSearch);
      if (custProduct) params.set("productName", custProduct);
      if (custSize) params.set("size", custSize);
      if (custCity) params.set("city", custCity);

      let allCustomers: CustomerRow[] = [];
      let currentPage = 1;
      let hasMore = true;

      while (hasMore) {
        params.set("page", String(currentPage));
        const res = await fetch(`/api/btoc/customers?${params}`);
        const d = await res.json();
        allCustomers = [...allCustomers, ...d.customers];
        hasMore = allCustomers.length < d.total;
        currentPage++;
        if (currentPage > 100) break;
      }

      const fields = fieldsConfig.customers || Object.fromEntries(
        Object.keys(CUSTOMER_FIELD_LABELS).map((k) => [k, true])
      );

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
        row["Dernière commande"] = c.lastOrderDate
          ? new Date(c.lastOrderDate).toLocaleDateString("fr-FR")
          : "";
        return row;
      });

      downloadXLSX(rows, "Clients BtoC", `clients-btoc-${today()}.xlsx`);
    } catch (e) {
      console.error("Erreur export clients:", e);
    } finally {
      setExportingCustomers(false);
    }
  };

  return (
    <div className="space-y-6 mt-4">
      {/* ─── Export Produits ──────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
              <Package className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <CardTitle className="text-base">Export Produits</CardTitle>
              <p className="text-sm text-muted-foreground">
                Exporter le catalogue produits en XLSX
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Recherche
              </label>
              <Input
                placeholder="Nom ou SKU..."
                value={prodSearch}
                onChange={(e) => setProdSearch(e.target.value)}
                className="w-52"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Catégorie
              </label>
              <Select
                value={prodCategory || "all"}
                onValueChange={(v) => setProdCategory(!v || v === "all" ? "" : v)}
              >
                <SelectTrigger className="w-48 h-9">
                  <SelectValue placeholder="Toutes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes</SelectItem>
                  {prodCategories.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleExportProducts}
              disabled={exportingProducts}
              className="gap-2"
            >
              {exportingProducts ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Exporter Produits
            </Button>
          </div>
          {(prodSearch || prodCategory) && (
            <div className="flex gap-2 flex-wrap">
              <Filter className="h-4 w-4 text-muted-foreground mt-0.5" />
              {prodSearch && <Badge variant="secondary">Recherche : {prodSearch}</Badge>}
              {prodCategory && <Badge variant="secondary">Catégorie : {prodCategory}</Badge>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Export Ventes ────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50">
              <ShoppingCart className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <CardTitle className="text-base">Export Ventes</CardTitle>
              <p className="text-sm text-muted-foreground">
                Ventes groupées par référence et couleur, tailles en colonnes
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Date début
              </label>
              <Input
                type="date"
                value={orderDateFrom}
                onChange={(e) => setOrderDateFrom(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Date fin
              </label>
              <Input
                type="date"
                value={orderDateTo}
                onChange={(e) => setOrderDateTo(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Référence produit
              </label>
              <Input
                placeholder="Nom du produit..."
                value={orderProduct}
                onChange={(e) => setOrderProduct(e.target.value)}
                className="w-48"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Couleur
              </label>
              <Select
                value={orderColor || "all"}
                onValueChange={(v) => setOrderColor(!v || v === "all" ? "" : v)}
              >
                <SelectTrigger className="w-36 h-9">
                  <SelectValue placeholder="Toutes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes</SelectItem>
                  {orderColors.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Taille
              </label>
              <Select
                value={orderSize || "all"}
                onValueChange={(v) => setOrderSize(!v || v === "all" ? "" : v)}
              >
                <SelectTrigger className="w-28 h-9">
                  <SelectValue placeholder="Toutes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes</SelectItem>
                  {orderSizes.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Client
              </label>
              <Input
                placeholder="Nom du client..."
                value={orderCustomer}
                onChange={(e) => setOrderCustomer(e.target.value)}
                className="w-44"
              />
            </div>
            <Button
              onClick={handleExportOrders}
              disabled={exportingOrders}
              className="gap-2"
            >
              {exportingOrders ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Exporter Ventes
            </Button>
          </div>
          {(orderDateFrom || orderDateTo || orderProduct || orderColor || orderSize || orderCustomer) && (
            <div className="flex gap-2 flex-wrap">
              <Filter className="h-4 w-4 text-muted-foreground mt-0.5" />
              {orderDateFrom && <Badge variant="secondary">Depuis : {orderDateFrom}</Badge>}
              {orderDateTo && <Badge variant="secondary">{"Jusqu'au"} : {orderDateTo}</Badge>}
              {orderProduct && <Badge variant="secondary">Produit : {orderProduct}</Badge>}
              {orderColor && <Badge variant="secondary">Couleur : {orderColor}</Badge>}
              {orderSize && <Badge variant="secondary">Taille : {orderSize}</Badge>}
              {orderCustomer && <Badge variant="secondary">Client : {orderCustomer}</Badge>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Export Clients ───────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50">
              <Users className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <CardTitle className="text-base">Export Clients</CardTitle>
              <p className="text-sm text-muted-foreground">
                Exporter la liste des clients filtrés en XLSX
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Recherche
              </label>
              <Input
                placeholder="Nom, email, entreprise..."
                value={custSearch}
                onChange={(e) => setCustSearch(e.target.value)}
                className="w-52"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Produit commandé
              </label>
              <Input
                placeholder="Nom du produit..."
                value={custProduct}
                onChange={(e) => setCustProduct(e.target.value)}
                className="w-48"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Taille
              </label>
              <Select
                value={custSize || "all"}
                onValueChange={(v) => setCustSize(!v || v === "all" ? "" : v)}
              >
                <SelectTrigger className="w-28 h-9">
                  <SelectValue placeholder="Toutes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes</SelectItem>
                  {custSizes.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Ville
              </label>
              <Select
                value={custCity || "all"}
                onValueChange={(v) => setCustCity(!v || v === "all" ? "" : v)}
              >
                <SelectTrigger className="w-40 h-9">
                  <SelectValue placeholder="Toutes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes</SelectItem>
                  {custCities.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleExportCustomers}
              disabled={exportingCustomers}
              className="gap-2"
            >
              {exportingCustomers ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Exporter Clients
            </Button>
          </div>
          {(custSearch || custProduct || custSize || custCity) && (
            <div className="flex gap-2 flex-wrap">
              <Filter className="h-4 w-4 text-muted-foreground mt-0.5" />
              {custSearch && <Badge variant="secondary">Recherche : {custSearch}</Badge>}
              {custProduct && <Badge variant="secondary">Produit : {custProduct}</Badge>}
              {custSize && <Badge variant="secondary">Taille : {custSize}</Badge>}
              {custCity && <Badge variant="secondary">Ville : {custCity}</Badge>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function downloadXLSX(
  rows: Record<string, string | number>[],
  sheetName: string,
  fileName: string
) {
  if (rows.length === 0) {
    alert("Aucune donnée à exporter.");
    return;
  }

  const ws = XLSX.utils.json_to_sheet(rows);

  // Auto-size columns
  const colKeys = Object.keys(rows[0]);
  ws["!cols"] = colKeys.map((key) => ({
    wch: Math.min(
      40,
      Math.max(key.length + 2, ...rows.map((r) => String(r[key] ?? "").length))
    ),
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
}

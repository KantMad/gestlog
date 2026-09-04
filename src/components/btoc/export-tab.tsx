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
  Boxes,
  Crown,
  Download,
  Loader2,
  MapPin,
  Package,
  ShoppingCart,
  TrendingUp,
  Users,
} from "lucide-react";
import { formatNumber } from "@/lib/utils";
import * as XLSX from "xlsx";
import { fileStamp } from "@/lib/file-stamp";

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
  btobCategory: string;
  btobSubCategory: string;
  sizeTypeCode: string;
  totalQuantity: number;
  totalRevenue: number;
  quantities: Record<number, number>; // position → quantity
}

interface SalesDetailRow {
  orderNumber: string;
  orderDate: string;
  status: string;
  total: number;
  totalTax: number;
  shippingTotal: number;
  totalRefunded: number;
  currency: string;
  paymentTitle: string;
  paymentMethod: string;
  customerEmail: string;
  billingFirstName: string;
  billingLastName: string;
  billingAddress1: string;
  billingPostcode: string;
  billingCity: string;
  billingCountry: string;
  shippingFirstName: string;
  shippingLastName: string;
  shippingAddress1: string;
  shippingPostcode: string;
  shippingCity: string;
  shippingCountry: string;
  shippingSameAsBilling: boolean;
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
  categoryBtob: "Catégorie BtoB",
  subCategoryBtob: "Sous-catégorie BtoB",
  sizeTypeBtob: "Type produit BtoB",
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
  const [exportingTopClients, setExportingTopClients] = useState(false);
  const [exportingBestSellers, setExportingBestSellers] = useState(false);
  const [exportingSalesDetails, setExportingSalesDetails] = useState(false);
  const [exportingParents, setExportingParents] = useState(false);

  // Export « produits parents » : mode inclure/exclure + préfixes de SKU + statut.
  const [parentMode, setParentMode] = useState<"include" | "exclude">("include");
  const [parentPrefixes, setParentPrefixes] = useState("");
  const [parentStatus, setParentStatus] = useState<"publish" | "draft" | "all">("publish");
  const [parentPreview, setParentPreview] = useState<{ returned: number; total: number } | null>(null);
  const [parentFacets, setParentFacets] = useState<{ prefix: string; count: number }[]>([]);

  // Export « Ventes détaillées » (adresses facturation/livraison + paiement) — plage de dates.
  const [sdDateFrom, setSdDateFrom] = useState("");
  const [sdDateTo, setSdDateTo] = useState("");

  // Top Clients / Best Sellers date filters (live + historique)
  const [tcDateFrom, setTcDateFrom] = useState("");
  const [tcDateTo, setTcDateTo] = useState("");
  const [bsDateFrom, setBsDateFrom] = useState("");
  const [bsDateTo, setBsDateTo] = useState("");

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
  // Statuts de commande (multi-sélection) — partagé par Commandes / Top clients / Best-sellers.
  const [availableStatuses, setAvailableStatuses] = useState<{ status: string; count: number }[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);

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
        const st: { status: string; count: number }[] = d.availableStatuses || [];
        setAvailableStatuses(st);
        // Défaut « ventes » : on exclut annulées / remboursées / échouées.
        setSelectedStatuses(
          st.map((x) => x.status).filter((x) => !["cancelled", "refunded", "failed"].includes(x))
        );
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

  const statusesParam = () => selectedStatuses.join(",");
  const toggleStatus = (st: string) =>
    setSelectedStatuses((cur) => (cur.includes(st) ? cur.filter((x) => x !== st) : [...cur, st]));

  // ─── Export Orders (grouped by ref+color, sizes as cols) ──
  const handleExportOrders = async () => {
    setExportingOrders(true);
    try {
      const params = new URLSearchParams();
      if (orderDateFrom) params.set("dateFrom", orderDateFrom);
      if (orderDateTo) params.set("dateTo", orderDateTo);
      if (orderProduct) params.set("productRef", orderProduct);
      if (orderColor) params.set("color", orderColor);
      if (orderSize) params.set("size", orderSize);
      if (orderCustomer) params.set("customerName", orderCustomer);
      if (statusesParam()) params.set("statuses", statusesParam());

      const res = await fetch(`/api/btoc/export/orders?${params}`);
      const data = await res.json();
      const orderRows: OrderRow[] = data.rows || [];
      const sizeColumns: SizeColumn[] = data.sizeColumns || [];
      const fields = fieldsConfig.orders || Object.fromEntries(
        Object.keys(ORDER_FIELD_LABELS).map((k) => [k, true])
      );

      // Build explicit header order — JS sorts numeric string keys before
      // text keys, so we must force column order via the header array
      const headers: string[] = [];
      if (fields.reference) headers.push("Référence");
      if (fields.sku) headers.push("SKU");
      if (fields.colorCode) headers.push("Code Couleur");
      if (fields.colorBtob) headers.push("Couleur BtoB");
      if (fields.color) headers.push("Couleur BtoC");
      if (fields.category) headers.push("Catégorie BtoC");
      if (fields.categoryBtob) headers.push("Catégorie BtoB");
      if (fields.subCategoryBtob) headers.push("Sous-catégorie BtoB");
      if (fields.sizeTypeBtob) headers.push("Type BtoB");
      if (fields.totalQuantity) headers.push("Total Qté");
      if (fields.totalRevenue) headers.push("CA Total");
      if (fields.sizes) {
        for (const col of sizeColumns) headers.push(col.header);
      }

      // Build XLSX rows: fixed columns + size columns by BtoB position
      const rows = orderRows.map((o) => {
        const row: Record<string, string | number> = {};
        if (fields.reference) row["Référence"] = o.productName;
        if (fields.sku) row["SKU"] = o.parentRef;
        if (fields.colorCode) row["Code Couleur"] = o.colorNum;
        if (fields.colorBtob) row["Couleur BtoB"] = o.btobColor;
        if (fields.color) row["Couleur BtoC"] = o.btocColor;
        if (fields.category) row["Catégorie BtoC"] = o.btocCategory;
        if (fields.categoryBtob) row["Catégorie BtoB"] = o.btobCategory;
        if (fields.subCategoryBtob) row["Sous-catégorie BtoB"] = o.btobSubCategory;
        if (fields.sizeTypeBtob) row["Type BtoB"] = o.sizeTypeCode;
        if (fields.totalQuantity) row["Total Qté"] = o.totalQuantity;
        if (fields.totalRevenue) row["CA Total"] = o.totalRevenue;
        if (fields.sizes) {
          for (const col of sizeColumns) {
            row[col.header] = o.quantities[col.position] ?? 0;
          }
        }
        return row;
      });

      downloadXLSX(rows, "Ventes BtoC", `ventes-btoc-${today()}.xlsx`, headers);
    } catch (e) {
      console.error("Erreur export ventes:", e);
    } finally {
      setExportingOrders(false);
    }
  };

  // ─── Export Produits parents (fichier de ré-import Woo) ──
  const parentParams = useCallback(() => {
    const p = new URLSearchParams();
    p.set("mode", parentMode);
    if (parentPrefixes.trim()) p.set("prefixes", parentPrefixes.trim());
    p.set("status", parentStatus);
    return p;
  }, [parentMode, parentPrefixes, parentStatus]);

  // Aperçu du nombre de parents retenus, rafraîchi à chaque changement de critère.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/btoc/export/parents?${parentParams()}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d.meta) return;
        setParentPreview({ returned: d.meta.returned, total: d.meta.total });
        if (d.meta.availablePrefixes) setParentFacets(d.meta.availablePrefixes);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [parentParams]);

  const handleExportParents = async () => {
    setExportingParents(true);
    try {
      const res = await fetch(`/api/btoc/export/parents?${parentParams()}`);
      const data = await res.json();
      const skus: { sku: string }[] = data.skus || [];
      if (skus.length === 0) {
        alert("Aucun produit parent ne correspond à ces critères.");
        return;
      }
      // En-têtes imposés par le fichier de ré-import : seule la 1re colonne est remplie,
      // les 4 autres restent VIDES (elles seront complétées dans Excel).
      const header = ["SKU", "SKU produits liés", "SKU ventes croisées", "ranking", "slug de catégories"];
      const rows = skus.map((s) => ({
        SKU: s.sku,
        "SKU produits liés": "",
        "SKU ventes croisées": "",
        ranking: "",
        "slug de catégories": "",
      }));
      downloadXLSX(rows, "Produits parents", `produits-parents-btoc-${today()}.xlsx`, header);
    } catch (e) {
      console.error("Erreur export parents:", e);
    } finally {
      setExportingParents(false);
    }
  };

  // ─── Export Ventes détaillées (adresses + paiement, 1 ligne / commande) ──
  const handleExportSalesDetails = async () => {
    setExportingSalesDetails(true);
    try {
      const params = new URLSearchParams();
      if (sdDateFrom) params.set("dateFrom", sdDateFrom);
      if (sdDateTo) params.set("dateTo", sdDateTo);
      if (statusesParam()) params.set("statuses", statusesParam());

      const res = await fetch(`/api/btoc/export/sales-details?${params}`);
      const data = await res.json();
      const orders: SalesDetailRow[] = data.orders || [];

      const headers = [
        "N° commande", "Date", "Statut", "Email", "Paiement", "Code paiement",
        "Facturation - Prénom", "Facturation - Nom", "Facturation - Adresse",
        "Facturation - CP", "Facturation - Ville", "Facturation - Pays",
        "Livraison - Prénom", "Livraison - Nom", "Livraison - Adresse",
        "Livraison - CP", "Livraison - Ville", "Livraison - Pays", "Livraison = facturation",
        "Total TTC", "TVA", "Frais de port", "Remboursé", "Devise",
      ];

      const rows = orders.map((o) => ({
        "N° commande": o.orderNumber,
        "Date": o.orderDate ? o.orderDate.slice(0, 10) : "",
        "Statut": o.status,
        "Email": o.customerEmail,
        "Paiement": o.paymentTitle,
        "Code paiement": o.paymentMethod,
        "Facturation - Prénom": o.billingFirstName,
        "Facturation - Nom": o.billingLastName,
        "Facturation - Adresse": o.billingAddress1,
        "Facturation - CP": o.billingPostcode,
        "Facturation - Ville": o.billingCity,
        "Facturation - Pays": o.billingCountry,
        "Livraison - Prénom": o.shippingFirstName,
        "Livraison - Nom": o.shippingLastName,
        "Livraison - Adresse": o.shippingAddress1,
        "Livraison - CP": o.shippingPostcode,
        "Livraison - Ville": o.shippingCity,
        "Livraison - Pays": o.shippingCountry,
        "Livraison = facturation": o.shippingSameAsBilling ? "Oui" : "Non",
        "Total TTC": o.total,
        "TVA": o.totalTax,
        "Frais de port": o.shippingTotal,
        "Remboursé": o.totalRefunded,
        "Devise": o.currency,
      }));

      downloadXLSX(rows, "Ventes détaillées", `ventes-details-btoc-${today()}.xlsx`, headers);
    } catch (e) {
      console.error("Erreur export ventes détaillées:", e);
    } finally {
      setExportingSalesDetails(false);
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
      if (custProduct) params.set("productRef", custProduct);
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

  // ─── Export Top Clients ───────────────────────────
  // Clients avec > 2 commandes OU panier moyen > 150 €.
  const handleExportTopClients = async () => {
    setExportingTopClients(true);
    try {
      const params = new URLSearchParams();
      if (tcDateFrom) params.set("dateFrom", tcDateFrom);
      if (tcDateTo) params.set("dateTo", tcDateTo);
      if (statusesParam()) params.set("statuses", statusesParam());
      const res = await fetch(`/api/btoc/export/top-clients?${params}`);
      const data = await res.json();
      const customers: {
        email: string;
        phone: string | null;
        lastName: string;
        firstName: string;
        billingPostcode: string | null;
        billingCity: string | null;
        ordersCount: number;
        totalSpent: number;
        avgBasket: number;
      }[] = data.customers || [];

      const rows = customers.map((c) => ({
        Email: c.email,
        Téléphone: c.phone || "",
        Nom: c.lastName,
        Prénom: c.firstName,
        "Code Postal": c.billingPostcode || "",
        Ville: c.billingCity || "",
        "Nb commandes": c.ordersCount,
        "Total dépensé (€)": c.totalSpent,
        "Panier moyen (€)": c.avgBasket,
      }));

      downloadXLSX(rows, "Top Clients", `top-clients-btoc-${today()}.xlsx`, [
        "Email",
        "Téléphone",
        "Nom",
        "Prénom",
        "Code Postal",
        "Ville",
        "Nb commandes",
        "Total dépensé (€)",
        "Panier moyen (€)",
      ]);
    } catch (e) {
      console.error("Erreur export top clients:", e);
    } finally {
      setExportingTopClients(false);
    }
  };

  // ─── Export Best Sellers ──────────────────────────
  // Les 10 références qui se vendent le mieux (quantité + CA).
  const handleExportBestSellers = async () => {
    setExportingBestSellers(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", "10");
      if (bsDateFrom) params.set("dateFrom", bsDateFrom);
      if (bsDateTo) params.set("dateTo", bsDateTo);
      if (statusesParam()) params.set("statuses", statusesParam());
      const res = await fetch(`/api/btoc/export/best-sellers?${params}`);
      const data = await res.json();
      const products: {
        reference: string;
        productName: string;
        quantity: number;
        revenue: number;
      }[] = data.products || [];

      const rows = products.map((p, i) => ({
        Rang: i + 1,
        Référence: p.reference,
        "Nom produit": p.productName,
        "Quantité vendue": p.quantity,
        "CA (€)": p.revenue,
      }));

      downloadXLSX(rows, "Best Sellers", `best-sellers-btoc-${today()}.xlsx`, [
        "Rang",
        "Référence",
        "Nom produit",
        "Quantité vendue",
        "CA (€)",
      ]);
    } catch (e) {
      console.error("Erreur export best sellers:", e);
    } finally {
      setExportingBestSellers(false);
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
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Recherche
              </label>
              <Input
                placeholder="Nom ou SKU..."
                value={prodSearch}
                onChange={(e) => setProdSearch(e.target.value)}
                className="w-52 h-9"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Catégorie
              </label>
              <Select
                value={prodCategory || "all"}
                onValueChange={(v) => setProdCategory(!v || v === "all" ? "" : v)}
              >
                <SelectTrigger className="w-48 h-9">
                  <span className={`text-sm truncate ${!prodCategory ? "text-muted-foreground" : ""}`}>
                    {prodCategory || "Toutes"}
                  </span>
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
              className="gap-2 h-9"
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
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {prodSearch && <Badge variant="secondary">Recherche : {prodSearch}</Badge>}
              {prodCategory && <Badge variant="secondary">Catégorie : {prodCategory}</Badge>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Statuts inclus (partagé Ventes / Top clients / Best-sellers) ─── */}
      {availableStatuses.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">Statuts de commande inclus</CardTitle>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setSelectedStatuses(availableStatuses.map((x) => x.status))}
                >
                  Tout
                </button>
                <span className="text-muted-foreground">·</span>
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() =>
                    setSelectedStatuses(
                      availableStatuses
                        .map((x) => x.status)
                        .filter((x) => !["cancelled", "refunded", "failed"].includes(x))
                    )
                  }
                >
                  Ventes (défaut)
                </button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              S&apos;applique aux exports <strong>Ventes</strong>, <strong>Top Clients</strong> et{" "}
              <strong>Best Sellers</strong>. Les statuts personnalisés WooCommerce (ex.{" "}
              <span className="font-mono">lpc_transit</span>) apparaissent aussi.
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {availableStatuses.map((s) => {
                const on = selectedStatuses.includes(s.status);
                return (
                  <button
                    key={s.status}
                    type="button"
                    onClick={() => toggleStatus(s.status)}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                      on
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-input text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    <span
                      className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border text-[9px] ${
                        on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                      }`}
                    >
                      {on ? "✓" : ""}
                    </span>
                    <span className="font-mono">{s.status}</span>
                    <span className="text-muted-foreground">({s.count})</span>
                  </button>
                );
              })}
            </div>
            {selectedStatuses.length === 0 && (
              <p className="mt-2 text-xs text-destructive">
                Aucun statut sélectionné : les exports seront vides.
              </p>
            )}
          </CardContent>
        </Card>
      )}

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
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Date début
              </label>
              <Input
                type="date"
                value={orderDateFrom}
                onChange={(e) => setOrderDateFrom(e.target.value)}
                className="w-40 h-9"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Date fin
              </label>
              <Input
                type="date"
                value={orderDateTo}
                onChange={(e) => setOrderDateTo(e.target.value)}
                className="w-40 h-9"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Référence produit
              </label>
              <Input
                placeholder="Référence..."
                value={orderProduct}
                onChange={(e) => setOrderProduct(e.target.value)}
                className="w-48 h-9"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Couleur
              </label>
              <Select
                value={orderColor || "all"}
                onValueChange={(v) => setOrderColor(!v || v === "all" ? "" : v)}
              >
                <SelectTrigger className="w-36 h-9">
                  <span className={`text-sm truncate ${!orderColor ? "text-muted-foreground" : ""}`}>
                    {orderColor || "Toutes"}
                  </span>
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
              <label className="block text-xs font-medium text-muted-foreground">
                Taille
              </label>
              <Select
                value={orderSize || "all"}
                onValueChange={(v) => setOrderSize(!v || v === "all" ? "" : v)}
              >
                <SelectTrigger className="w-28 h-9">
                  <span className={`text-sm truncate ${!orderSize ? "text-muted-foreground" : ""}`}>
                    {orderSize || "Toutes"}
                  </span>
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
              <label className="block text-xs font-medium text-muted-foreground">
                Client
              </label>
              <Input
                placeholder="Nom du client..."
                value={orderCustomer}
                onChange={(e) => setOrderCustomer(e.target.value)}
                className="w-44 h-9"
              />
            </div>
            <Button
              onClick={handleExportOrders}
              disabled={exportingOrders}
              className="gap-2 h-9"
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
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {orderDateFrom && <Badge variant="secondary">Depuis : {orderDateFrom}</Badge>}
              {orderDateTo && <Badge variant="secondary">{"Jusqu'au"} : {orderDateTo}</Badge>}
              {orderProduct && <Badge variant="secondary">Réf. : {orderProduct}</Badge>}
              {orderColor && <Badge variant="secondary">Couleur : {orderColor}</Badge>}
              {orderSize && <Badge variant="secondary">Taille : {orderSize}</Badge>}
              {orderCustomer && <Badge variant="secondary">Client : {orderCustomer}</Badge>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Export Produits parents (fichier de ré-import Woo) ───── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50">
              <Boxes className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <CardTitle className="text-base">Export Produits parents</CardTitle>
              <p className="text-sm text-muted-foreground">
                Liste des SKU parents WooCommerce. Seule la colonne <strong>SKU</strong> est
                remplie — les 4 autres colonnes n&apos;ont que leur en-tête, à compléter dans
                Excel.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Références
              </label>
              <div className="inline-flex rounded-lg border bg-muted/50 p-0.5 text-sm">
                {([["include", "Inclure"], ["exclude", "Exclure"]] as ["include" | "exclude", string][]).map(
                  ([val, lbl]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setParentMode(val)}
                      className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                        parentMode === val
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {lbl}
                    </button>
                  )
                )}
              </div>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Préfixes de référence
              </label>
              <Input
                placeholder="ex. RM, PM"
                value={parentPrefixes}
                onChange={(e) => setParentPrefixes(e.target.value)}
                className="h-9 w-56"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">Statut</label>
              <Select
                value={parentStatus}
                onValueChange={(v) => v && setParentStatus(v as "publish" | "draft" | "all")}
              >
                <SelectTrigger className="h-9 w-40">
                  <span className="truncate text-sm">
                    {parentStatus === "publish" ? "Publiés" : parentStatus === "draft" ? "Brouillons" : "Tous"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="publish">Publiés</SelectItem>
                  <SelectItem value="draft">Brouillons</SelectItem>
                  <SelectItem value="all">Tous</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleExportParents} disabled={exportingParents} className="gap-2 h-9">
              {exportingParents ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Exporter Parents
            </Button>
          </div>

          {parentPreview && (
            <p className="mt-3 text-sm">
              <strong>{formatNumber(parentPreview.returned)}</strong> produit(s) parent(s)
              sélectionné(s)
              <span className="text-muted-foreground">
                {" "}sur {formatNumber(parentPreview.total)}
                {parentMode === "exclude" && parentPrefixes.trim()
                  ? " (tous sauf les préfixes saisis)"
                  : ""}
              </span>
            </p>
          )}

          {parentFacets.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Préfixes existants :</span>
              {parentFacets.map((f) => (
                <button
                  key={f.prefix}
                  type="button"
                  title={`${f.count} parent(s)`}
                  onClick={() => {
                    const cur = parentPrefixes.split(",").map((x) => x.trim()).filter(Boolean);
                    const next = cur.includes(f.prefix)
                      ? cur.filter((x) => x !== f.prefix)
                      : [...cur, f.prefix];
                    setParentPrefixes(next.join(", "));
                  }}
                  className={`rounded-md border px-1.5 py-0.5 text-xs transition-colors ${
                    parentPrefixes.split(",").map((x) => x.trim()).includes(f.prefix)
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "bg-background hover:bg-accent"
                  }`}
                >
                  {f.prefix}
                  <span className="ml-1 text-muted-foreground">{f.count}</span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Export Ventes détaillées (adresses + paiement) ───── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50">
              <MapPin className="h-5 w-5 text-sky-600" />
            </div>
            <div>
              <CardTitle className="text-base">Export Ventes détaillées</CardTitle>
              <p className="text-sm text-muted-foreground">
                Une ligne par commande : coordonnées de facturation et de livraison (nom, prénom,
                adresse, ville, pays) + moyen de paiement. Respecte les statuts sélectionnés.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Date début
              </label>
              <Input
                type="date"
                value={sdDateFrom}
                onChange={(e) => setSdDateFrom(e.target.value)}
                className="w-40 h-9"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Date fin
              </label>
              <Input
                type="date"
                value={sdDateTo}
                onChange={(e) => setSdDateTo(e.target.value)}
                className="w-40 h-9"
              />
            </div>
            <Button
              onClick={handleExportSalesDetails}
              disabled={exportingSalesDetails}
              className="gap-2 h-9"
            >
              {exportingSalesDetails ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Exporter Ventes détaillées
            </Button>
          </div>
          {(sdDateFrom || sdDateTo) && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {sdDateFrom && <Badge variant="secondary">Depuis : {sdDateFrom}</Badge>}
              {sdDateTo && <Badge variant="secondary">{"Jusqu'au"} : {sdDateTo}</Badge>}
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
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Recherche
              </label>
              <Input
                placeholder="Nom, email, entreprise..."
                value={custSearch}
                onChange={(e) => setCustSearch(e.target.value)}
                className="w-52 h-9"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Référence produit
              </label>
              <Input
                placeholder="Référence..."
                value={custProduct}
                onChange={(e) => setCustProduct(e.target.value)}
                className="w-48 h-9"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Taille
              </label>
              <Select
                value={custSize || "all"}
                onValueChange={(v) => setCustSize(!v || v === "all" ? "" : v)}
              >
                <SelectTrigger className="w-28 h-9">
                  <span className={`text-sm truncate ${!custSize ? "text-muted-foreground" : ""}`}>
                    {custSize || "Toutes"}
                  </span>
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
              <label className="block text-xs font-medium text-muted-foreground">
                Ville
              </label>
              <Select
                value={custCity || "all"}
                onValueChange={(v) => setCustCity(!v || v === "all" ? "" : v)}
              >
                <SelectTrigger className="w-40 h-9">
                  <span className={`text-sm truncate ${!custCity ? "text-muted-foreground" : ""}`}>
                    {custCity || "Toutes"}
                  </span>
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
              className="gap-2 h-9"
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
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {custSearch && <Badge variant="secondary">Recherche : {custSearch}</Badge>}
              {custProduct && <Badge variant="secondary">Réf. : {custProduct}</Badge>}
              {custSize && <Badge variant="secondary">Taille : {custSize}</Badge>}
              {custCity && <Badge variant="secondary">Ville : {custCity}</Badge>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Export Top Clients ───────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50">
              <Crown className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <CardTitle className="text-base">Export Top Clients</CardTitle>
              <p className="text-sm text-muted-foreground">
                Plus de 2 commandes ou panier moyen &gt; 150 € (live + historique) — Email, Téléphone, Nom, Prénom, Code Postal, Ville, Nb commandes, Total dépensé, Panier moyen
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Date début
              </label>
              <Input
                type="date"
                value={tcDateFrom}
                onChange={(e) => setTcDateFrom(e.target.value)}
                className="w-40 h-9"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Date fin
              </label>
              <Input
                type="date"
                value={tcDateTo}
                onChange={(e) => setTcDateTo(e.target.value)}
                className="w-40 h-9"
              />
            </div>
            <Button
              onClick={handleExportTopClients}
              disabled={exportingTopClients}
              className="gap-2 h-9 ml-auto"
            >
              {exportingTopClients ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Exporter Top Clients
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ─── Export Best Sellers ──────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50">
              <TrendingUp className="h-5 w-5 text-rose-600" />
            </div>
            <div>
              <CardTitle className="text-base">Export Best Sellers</CardTitle>
              <p className="text-sm text-muted-foreground">
                Top 10 des références les plus vendues (quantité et CA) — live + historique
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Date début
              </label>
              <Input
                type="date"
                value={bsDateFrom}
                onChange={(e) => setBsDateFrom(e.target.value)}
                className="w-40 h-9"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">
                Date fin
              </label>
              <Input
                type="date"
                value={bsDateTo}
                onChange={(e) => setBsDateTo(e.target.value)}
                className="w-40 h-9"
              />
            </div>
            <Button
              onClick={handleExportBestSellers}
              disabled={exportingBestSellers}
              className="gap-2 h-9 ml-auto"
            >
              {exportingBestSellers ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Exporter Best Sellers
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────
// Horodatage à la MINUTE : deux exports du même jour ne doivent pas porter le même nom.
const today = fileStamp;

function downloadXLSX(
  rows: Record<string, string | number>[],
  sheetName: string,
  fileName: string,
  header?: string[]
) {
  if (rows.length === 0) {
    alert("Aucune donnée à exporter.");
    return;
  }

  // When header is provided, force exact column order (bypasses JS numeric key sorting)
  const ws = header
    ? XLSX.utils.json_to_sheet(rows, { header })
    : XLSX.utils.json_to_sheet(rows);

  // Auto-size columns
  const colKeys = header || Object.keys(rows[0]);
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

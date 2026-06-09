"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Save, Check, Package, ShoppingCart, Users } from "lucide-react";

interface ExportFields {
  [key: string]: boolean;
}

type ExportType = "products" | "orders" | "customers";

const SECTIONS: {
  type: ExportType;
  title: string;
  description: string;
  icon: typeof Package;
  iconBg: string;
  iconColor: string;
  fields: Record<string, { label: string; description: string }>;
}[] = [
  {
    type: "products",
    title: "Export Produits",
    description: "Champs inclus dans l'export XLSX des produits",
    icon: Package,
    iconBg: "bg-blue-50",
    iconColor: "text-blue-600",
    fields: {
      name: { label: "Nom", description: "Nom du produit" },
      sku: { label: "SKU", description: "Référence produit" },
      type: { label: "Type", description: "simple, variable, variation" },
      category: { label: "Catégorie", description: "Catégorie du produit" },
      price: { label: "Prix", description: "Prix de vente actuel" },
      regularPrice: { label: "Prix régulier", description: "Prix sans réduction" },
      salePrice: { label: "Prix soldé", description: "Prix en promotion" },
      stockQuantity: { label: "Stock", description: "Quantité en stock" },
      stockStatus: { label: "Statut stock", description: "En stock / Rupture" },
    },
  },
  {
    type: "orders",
    title: "Export Ventes",
    description: "Champs inclus dans l'export XLSX des ventes (groupé par référence + couleur)",
    icon: ShoppingCart,
    iconBg: "bg-emerald-50",
    iconColor: "text-emerald-600",
    fields: {
      reference: { label: "Référence", description: "Nom du produit parent" },
      sku: { label: "SKU", description: "Référence produit" },
      colorCode: { label: "Code Couleur", description: "Code couleur numérique BtoB" },
      colorBtob: { label: "Couleur BtoB", description: "Nom couleur BtoB" },
      color: { label: "Couleur BtoC", description: "Slug couleur WooCommerce" },
      category: { label: "Catégorie BtoC", description: "Catégorie WooCommerce" },
      categoryBtob: { label: "Type produit BtoB", description: "Type de taille BtoB (HAU, PAN...)" },
      totalQuantity: { label: "Quantité totale", description: "Total toutes tailles confondues" },
      totalRevenue: { label: "CA total", description: "Chiffre d'affaires total" },
      sizes: { label: "Tailles (colonnes)", description: "Colonnes par position de taille BtoB" },
    },
  },
  {
    type: "customers",
    title: "Export Clients",
    description: "Champs inclus dans l'export XLSX des clients",
    icon: Users,
    iconBg: "bg-purple-50",
    iconColor: "text-purple-600",
    fields: {
      email: { label: "Email", description: "Adresse email du client" },
      firstName: { label: "Prénom", description: "Prénom du client" },
      lastName: { label: "Nom", description: "Nom de famille du client" },
      company: { label: "Entreprise", description: "Nom de l'entreprise" },
      phone: { label: "Téléphone", description: "Numéro de téléphone" },
      billingCity: { label: "Ville facturation", description: "Ville de facturation" },
      billingCountry: { label: "Pays facturation", description: "Pays de facturation" },
      shippingCity: { label: "Ville livraison", description: "Ville de livraison" },
      shippingCountry: { label: "Pays livraison", description: "Pays de livraison" },
      totalSpent: { label: "Total dépensé", description: "Montant total des commandes" },
      ordersCount: { label: "Nb commandes", description: "Nombre de commandes passées" },
    },
  },
];

export function BtocSettingsTab() {
  const [allFields, setAllFields] = useState<Record<ExportType, ExportFields> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<ExportType | null>(null);
  const [savedType, setSavedType] = useState<ExportType | null>(null);

  useEffect(() => {
    fetch("/api/btoc/settings")
      .then((r) => r.json())
      .then((d) => {
        // Handle both old format (flat fields) and new format (fields per type)
        if (d.fields && typeof d.fields === "object") {
          // Check if it's the new format (has products/orders/customers keys)
          if (d.fields.products || d.fields.orders || d.fields.customers) {
            setAllFields({
              products: d.fields.products || getDefaults("products"),
              orders: d.fields.orders || getDefaults("orders"),
              customers: d.fields.customers || getDefaults("customers"),
            });
          } else {
            // Old format — treat as customers only
            setAllFields({
              products: getDefaults("products"),
              orders: getDefaults("orders"),
              customers: d.fields,
            });
          }
        } else {
          setAllFields({
            products: getDefaults("products"),
            orders: getDefaults("orders"),
            customers: getDefaults("customers"),
          });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleToggle = (type: ExportType, key: string) => {
    if (!allFields) return;
    setAllFields({
      ...allFields,
      [type]: { ...allFields[type], [key]: !allFields[type][key] },
    });
    setSavedType(null);
  };

  const handleSelectAll = (type: ExportType) => {
    if (!allFields) return;
    const updated = Object.fromEntries(
      Object.keys(allFields[type]).map((k) => [k, true])
    );
    setAllFields({ ...allFields, [type]: updated });
    setSavedType(null);
  };

  const handleDeselectAll = (type: ExportType) => {
    if (!allFields) return;
    const updated = Object.fromEntries(
      Object.keys(allFields[type]).map((k) => [k, false])
    );
    setAllFields({ ...allFields, [type]: updated });
    setSavedType(null);
  };

  const handleSave = async (type: ExportType) => {
    if (!allFields) return;
    setSaving(type);
    try {
      const res = await fetch("/api/btoc/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, fields: allFields[type] }),
      });
      if (!res.ok) throw new Error("Erreur API");
      setSavedType(type);
      setTimeout(() => setSavedType(null), 3000);
    } catch (e) {
      console.error("Erreur sauvegarde:", e);
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Chargement...</span>
      </div>
    );
  }

  if (!allFields) {
    return (
      <Card className="border-dashed mt-4">
        <CardContent className="flex flex-col items-center justify-center py-16">
          <p className="text-sm text-muted-foreground">
            Erreur lors du chargement des paramètres.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 mt-4">
      {SECTIONS.map((section) => {
        const fields = allFields[section.type];
        const activeCount = Object.values(fields).filter(Boolean).length;
        const totalCount = Object.keys(fields).length;
        const Icon = section.icon;

        return (
          <Card key={section.type}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${section.iconBg}`}>
                    <Icon className={`h-5 w-5 ${section.iconColor}`} />
                  </div>
                  <div>
                    <CardTitle className="text-base">{section.title}</CardTitle>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {section.description} —{" "}
                      <span className="font-medium">
                        {activeCount}/{totalCount} champs actifs
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSelectAll(section.type)}
                    className="text-xs"
                  >
                    Tout cocher
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeselectAll(section.type)}
                    className="text-xs"
                  >
                    Tout décocher
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(section.fields).map(([key, meta]) => (
                  <label
                    key={key}
                    className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={fields[key] ?? false}
                      onChange={() => handleToggle(section.type, key)}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <div>
                      <div className="text-sm font-medium">{meta.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {meta.description}
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              <div className="mt-4 flex items-center gap-3">
                <Button
                  onClick={() => handleSave(section.type)}
                  disabled={saving === section.type}
                  size="sm"
                  className="gap-2"
                >
                  {saving === section.type ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : savedType === section.type ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {savedType === section.type ? "Enregistré !" : "Enregistrer"}
                </Button>
                {savedType === section.type && (
                  <span className="text-sm text-emerald-600">
                    Paramètres sauvegardés.
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────
function getDefaults(type: ExportType): ExportFields {
  const defaults: Record<ExportType, ExportFields> = {
    products: {
      name: true, sku: true, type: true, category: true,
      price: true, regularPrice: true, salePrice: true,
      stockQuantity: true, stockStatus: true,
    },
    orders: {
      reference: true, sku: true, color: true, category: true,
      sizes: true, totalQuantity: true, totalRevenue: true,
    },
    customers: {
      email: true, firstName: true, lastName: true, company: true,
      phone: true, billingCity: true, billingCountry: true,
      shippingCity: true, shippingCountry: true, totalSpent: true, ordersCount: true,
    },
  };
  return defaults[type];
}

"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Save, Check } from "lucide-react";

interface ExportFields {
  [key: string]: boolean;
}

const FIELD_LABELS: Record<string, string> = {
  email: "Email",
  firstName: "Prénom",
  lastName: "Nom",
  company: "Entreprise",
  phone: "Téléphone",
  billingCity: "Ville de facturation",
  billingCountry: "Pays de facturation",
  shippingCity: "Ville de livraison",
  shippingCountry: "Pays de livraison",
  totalSpent: "Total dépensé",
  ordersCount: "Nombre de commandes",
};

const FIELD_DESCRIPTIONS: Record<string, string> = {
  email: "Adresse email du client",
  firstName: "Prénom du client",
  lastName: "Nom de famille du client",
  company: "Nom de l'entreprise (si renseigné)",
  phone: "Numéro de téléphone",
  billingCity: "Ville de l'adresse de facturation",
  billingCountry: "Pays de l'adresse de facturation",
  shippingCity: "Ville de l'adresse de livraison",
  shippingCountry: "Pays de l'adresse de livraison",
  totalSpent: "Montant total des commandes",
  ordersCount: "Nombre total de commandes passées",
};

export function BtocSettingsTab() {
  const [fields, setFields] = useState<ExportFields | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/btoc/settings")
      .then((r) => r.json())
      .then((d) => {
        setFields(d.fields);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleToggle = (key: string) => {
    if (!fields) return;
    setFields({ ...fields, [key]: !fields[key] });
    setSaved(false);
  };

  const handleSelectAll = () => {
    if (!fields) return;
    const allTrue = Object.fromEntries(
      Object.keys(fields).map((k) => [k, true])
    );
    setFields(allTrue);
    setSaved(false);
  };

  const handleDeselectAll = () => {
    if (!fields) return;
    const allFalse = Object.fromEntries(
      Object.keys(fields).map((k) => [k, false])
    );
    setFields(allFalse);
    setSaved(false);
  };

  const handleSave = async () => {
    if (!fields) return;
    setSaving(true);
    try {
      const res = await fetch("/api/btoc/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      if (!res.ok) throw new Error("Erreur API");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      console.error("Erreur sauvegarde:", e);
    } finally {
      setSaving(false);
    }
  };

  const activeCount = fields
    ? Object.values(fields).filter(Boolean).length
    : 0;
  const totalCount = fields ? Object.keys(fields).length : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          Chargement...
        </span>
      </div>
    );
  }

  if (!fields) {
    return (
      <Card className="border-dashed mt-4">
        <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
          <p className="text-sm text-muted-foreground">
            Erreur lors du chargement des paramètres.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 mt-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">
                Champs d&apos;export XLSX
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Sélectionnez les champs à inclure dans les exports Excel de la
                liste clients.{" "}
                <span className="font-medium">
                  {activeCount}/{totalCount} champs actifs.
                </span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSelectAll}
                className="text-xs"
              >
                Tout cocher
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDeselectAll}
                className="text-xs"
              >
                Tout décocher
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(FIELD_LABELS).map(([key, label]) => (
              <label
                key={key}
                className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer hover:bg-muted/30 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={fields[key] ?? false}
                  onChange={() => handleToggle(key)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <div>
                  <div className="text-sm font-medium">{label}</div>
                  {FIELD_DESCRIPTIONS[key] && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {FIELD_DESCRIPTIONS[key]}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>

          <div className="mt-6 flex items-center gap-3">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="gap-2"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : saved ? (
                <Check className="h-4 w-4" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saved ? "Enregistré !" : "Enregistrer"}
            </Button>
            {saved && (
              <span className="text-sm text-emerald-600">
                Paramètres sauvegardés avec succès.
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

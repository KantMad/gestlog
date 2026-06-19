"use client";

import { useState, useCallback } from "react";
import { useSeason, formatSeasonLabel } from "@/lib/season-context";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Dropzone } from "@/components/import/dropzone";
import { ImportPreview } from "@/components/import/import-preview";
import {
  ColumnMapper,
  autoDetectMapping,
  CLIENT_ORDER_PATTERNS,
  SUPPLIER_ORDER_PATTERNS,
  RECEPTION_PATTERNS,
  STOCK_PATTERNS,
} from "@/components/import/column-mapper";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  detectMcsFormat,
  parseMcsStatgen,
  parseMcsPackingList,
  type McsFormat,
} from "@/lib/import/mcs-format";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  ShoppingCart,
  Factory,
  PackageCheck,
  Warehouse,
  Check,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

interface ParsedData {
  headers: string[];
  rows: Record<string, string | number | null>[];
}

const IMPORT_TABS = [
  {
    id: "client-orders",
    label: "Commandes clients",
    icon: ShoppingCart,
    endpoint: "/api/import/client-orders",
    patterns: CLIENT_ORDER_PATTERNS,
    fields: [
      { key: "orderNumber", label: "N° commande", required: true },
      { key: "clientCode", label: "Code client", required: true },
      { key: "clientName", label: "Nom client", required: true },
      { key: "reference", label: "Référence", required: true },
      { key: "color", label: "Couleur", required: true },
      { key: "colorCode", label: "Code couleur" },
      { key: "catalog", label: "Catalogue" },
      { key: "status", label: "Statut commande" },
      { key: "deliveryWindow", label: "Fenêtre de livraison" },
      { key: "category", label: "Catégorie" },
      { key: "sizeTypeCode", label: "Type de taille" },
    ],
  },
  {
    id: "supplier-orders",
    label: "Commandes fournisseurs",
    icon: Factory,
    endpoint: "/api/import/supplier-orders",
    patterns: SUPPLIER_ORDER_PATTERNS,
    fields: [
      { key: "orderNumber", label: "N° commande", required: true },
      { key: "supplierCode", label: "Code fournisseur", required: true },
      { key: "supplierName", label: "Nom fournisseur", required: true },
      { key: "reference", label: "Référence", required: true },
      { key: "color", label: "Couleur", required: true },
    ],
  },
  {
    id: "receptions",
    label: "Réceptions",
    icon: PackageCheck,
    endpoint: "/api/import/receptions",
    patterns: RECEPTION_PATTERNS,
    fields: [
      { key: "supplierOrderNumber", label: "N° commande fournisseur", required: true },
      { key: "reference", label: "Référence", required: true },
      { key: "color", label: "Couleur", required: true },
    ],
  },
  {
    id: "stock",
    label: "Stock",
    icon: Warehouse,
    endpoint: "/api/import/stock",
    patterns: STOCK_PATTERNS,
    fields: [
      { key: "reference", label: "Référence", required: true },
      { key: "color", label: "Couleur", required: true },
    ],
  },
];

function ImportTab({
  tab,
  seasonId,
}: {
  tab: (typeof IMPORT_TABS)[number];
  seasonId: string;
}) {
  const [parsed, setParsed] = useState<ParsedData | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    errors: string[];
  } | null>(null);
  // Format MCS auto-détecté (StatGen / Packing List) → import sans mapping manuel.
  const [mcsFormat, setMcsFormat] = useState<McsFormat | null>(null);
  const [mcsRowCount, setMcsRowCount] = useState(0);
  const [supplierOrderNumber, setSupplierOrderNumber] = useState("");

  // Format MCS attendu pour cet onglet (les autres onglets restent en mapping générique).
  const expectedMcs: McsFormat | null =
    tab.id === "supplier-orders" ? "statgen" : tab.id === "receptions" ? "packing-list" : null;

  const handleFileSelected = useCallback(
    async (selectedFile: File) => {
      setFile(selectedFile);
      setResult(null);
      setMcsFormat(null);
      setMcsRowCount(0);
      try {
        const buffer = await selectedFile.arrayBuffer();

        // Détection prioritaire du format MCS (réception / commande fournisseur).
        const fmt = detectMcsFormat(buffer);
        if (fmt) {
          setMcsFormat(fmt);
          setMcsRowCount(
            fmt === "statgen"
              ? parseMcsStatgen(buffer).length
              : parseMcsPackingList(buffer).length
          );
          setParsed({ headers: [], rows: [] });
          return;
        }

        const workbook = XLSX.read(buffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json<Record<string, string | number | null>>(sheet, {
          defval: null,
        });
        const headers = data.length > 0 ? Object.keys(data[0]) : [];
        setParsed({ headers, rows: data });
        setMapping(autoDetectMapping(headers, tab.patterns));
      } catch {
        toast.error("Impossible de lire le fichier");
      }
    },
    [tab.patterns]
  );

  const useMcs = mcsFormat !== null && mcsFormat === expectedMcs;

  const handleImport = async () => {
    if (!file || !parsed) return;

    if (useMcs) {
      if (mcsFormat === "packing-list" && !supplierOrderNumber.trim()) {
        toast.error("Entrez le n° de commande fournisseur de la réception");
        return;
      }
    } else {
      const requiredFields = tab.fields.filter((f) => f.required);
      const missing = requiredFields.filter((f) => !mapping[f.key]);
      if (missing.length > 0) {
        toast.error(`Colonnes requises manquantes : ${missing.map((f) => f.label).join(", ")}`);
        return;
      }
    }

    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("seasonId", seasonId);
      if (useMcs) {
        if (supplierOrderNumber.trim())
          formData.append("supplierOrderNumber", supplierOrderNumber.trim());
      } else {
        formData.append("mapping", JSON.stringify(mapping));
      }

      const res = await fetch(tab.endpoint, { method: "POST", body: formData });
      const json = await res.json();

      if (!res.ok) {
        toast.error(json.error || "Erreur d'import");
        return;
      }

      setResult(json.data);
      if (json.data.errors.length === 0) {
        toast.success(`${json.data.imported} lignes importées`);
      } else {
        toast.warning(
          `${json.data.imported} lignes importées, ${json.data.errors.length} erreurs`
        );
      }
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setImporting(false);
    }
  };

  const reset = () => {
    setParsed(null);
    setFile(null);
    setMapping({});
    setResult(null);
    setMcsFormat(null);
    setMcsRowCount(0);
    setSupplierOrderNumber("");
  };

  if (result) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-6 text-center space-y-3">
          {result.errors.length === 0 ? (
            <div className="inline-flex items-center justify-center rounded-full bg-emerald-100 p-3">
              <Check className="h-6 w-6 text-emerald-600" />
            </div>
          ) : (
            <div className="inline-flex items-center justify-center rounded-full bg-amber-100 p-3">
              <AlertTriangle className="h-6 w-6 text-amber-600" />
            </div>
          )}
          <div>
            <p className="font-semibold">
              {result.imported} ligne{result.imported > 1 ? "s" : ""} importée{result.imported > 1 ? "s" : ""}
            </p>
            {result.errors.length > 0 && (
              <p className="text-sm text-muted-foreground mt-1">
                {result.errors.length} erreur{result.errors.length > 1 ? "s" : ""}
              </p>
            )}
          </div>
          {result.errors.length > 0 && (
            <div className="mt-3 max-h-32 overflow-auto rounded-md bg-destructive/5 p-3 text-left">
              {result.errors.slice(0, 10).map((err, i) => (
                <p key={i} className="text-xs text-destructive">
                  {err}
                </p>
              ))}
              {result.errors.length > 10 && (
                <p className="text-xs text-muted-foreground mt-1">
                  ... et {result.errors.length - 10} autres
                </p>
              )}
            </div>
          )}
        </div>
        <Button onClick={reset} variant="outline" className="w-full">
          Importer un autre fichier
        </Button>
      </div>
    );
  }

  // Fichier MCS reconnu mais déposé dans le mauvais onglet.
  const mcsMismatch = mcsFormat !== null && mcsFormat !== expectedMcs;

  return (
    <div className="space-y-6">
      <Dropzone onFileSelected={handleFileSelected} />

      {mcsMismatch && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Ce fichier ressemble à un format MCS «{" "}
            {mcsFormat === "statgen" ? "commande fournisseur" : "réception (liste de colisage)"} ».
            Sélectionne l'onglet correspondant pour l'importer.
          </span>
        </div>
      )}

      {parsed && useMcs && (
        <>
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <Check className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Format MCS détecté ({mcsFormat === "statgen" ? "StatGen" : "Packing List"}) —{" "}
              <strong>{mcsRowCount}</strong> ligne{mcsRowCount > 1 ? "s" : ""} prête
              {mcsRowCount > 1 ? "s" : ""}. Pas de mapping de colonnes nécessaire.
            </span>
          </div>

          {mcsFormat === "packing-list" && (
            <div className="space-y-1.5">
              <label htmlFor="supplierOrderNumber" className="text-sm font-medium">
                N° de commande fournisseur
              </label>
              <Input
                id="supplierOrderNumber"
                value={supplierOrderNumber}
                onChange={(e) => setSupplierOrderNumber(e.target.value)}
                placeholder="ex. 100739"
                disabled={importing}
              />
              <p className="text-xs text-muted-foreground">
                La réception sera rattachée à cette commande (importe d'abord la commande
                fournisseur correspondante).
              </p>
            </div>
          )}

          <Button onClick={handleImport} disabled={importing} className="w-full">
            {importing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {importing ? "Import en cours..." : `Importer ${mcsRowCount} lignes`}
          </Button>
        </>
      )}

      {parsed && !useMcs && !mcsMismatch && (
        <>
          <ImportPreview headers={parsed.headers} rows={parsed.rows} />
          <ColumnMapper
            headers={parsed.headers}
            fields={tab.fields}
            mapping={mapping}
            onMappingChange={setMapping}
          />
          <Button
            onClick={handleImport}
            disabled={importing}
            className="w-full"
          >
            {importing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {importing
              ? "Import en cours..."
              : `Importer ${parsed.rows.length} lignes`}
          </Button>
        </>
      )}
    </div>
  );
}

export default function ImportPage() {
  const { activeSeason } = useSeason();

  return (
    <div>
      <Topbar title="Import" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-8">
        <PageHeader
          title="Import de données"
          description="Importez vos fichiers Excel pour alimenter le système"
        />

        {!activeSeason ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <p className="text-sm text-muted-foreground">
                Sélectionnez une saison pour commencer les imports
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                {formatSeasonLabel(activeSeason)}
                <Badge variant="secondary">Active</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="client-orders">
                <TabsList className="w-full justify-start">
                  {IMPORT_TABS.map((tab) => (
                    <TabsTrigger
                      key={tab.id}
                      value={tab.id}
                      className="gap-2"
                    >
                      <tab.icon className="h-4 w-4" />
                      {tab.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {IMPORT_TABS.map((tab) => (
                  <TabsContent key={tab.id} value={tab.id} className="mt-6">
                    <ImportTab tab={tab} seasonId={activeSeason.id} />
                  </TabsContent>
                ))}
              </Tabs>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

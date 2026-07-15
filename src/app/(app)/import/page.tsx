"use client";

import { useState, useCallback, useEffect, type ReactNode } from "react";
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
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  detectMcsFormat,
  parseMcsStatgen,
  parseMcsPackingList,
  parseMcsClientOrders,
  type McsFormat,
} from "@/lib/import/mcs-format";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ShoppingCart,
  Factory,
  PackageCheck,
  Warehouse,
  Check,
  AlertTriangle,
  Loader2,
  Calendar,
  Info,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { cn } from "@/lib/utils";

// Aide par onglet : format attendu, fonctionnement, et comment les liens se font.
const IMPORT_HELP: Record<string, { format: ReactNode; how: ReactNode; links: ReactNode }> = {
  "client-orders": {
    format: (
      <>
        Export TIO <strong>StatGen « commande client »</strong>, reconnu automatiquement (aucun
        mapping à faire). En-tête attendu : <strong>Fiche client</strong>,{" "}
        <strong>Fiche produit fini</strong>, <strong>Coloris produit fini</strong>,{" "}
        <strong>N° commande client</strong>, <strong>Total Q</strong> et{" "}
        <strong>Q. 1 … Q. 16</strong>.
      </>
    ),
    how: (
      <>
        La référence vient de « Fiche produit fini », la <strong>couleur = le code</strong> avant
        le tiret (« 208-Cognac » → 208), et les quantités <strong>Q.N</strong> sont replacées par
        taille via la grille du produit. Chaque ligne est appariée à un{" "}
        <strong>produit du référentiel</strong> (réf + code couleur) ; les produits inconnus
        (ex. <span className="font-mono">ZZZ_LOGO</span>) sont listés en erreurs — c&apos;est normal.
      </>
    ),
    links: (
      <>
        Le <strong>client</strong> est créé/mis à jour automatiquement (via « Fiche client ») et la
        commande est rattachée à la <strong>saison choisie en haut</strong> et à son{" "}
        <strong>n° de commande</strong> (du fichier). ⚠️ Une commande ne peut exister que sur{" "}
        <strong>une seule saison</strong> : si le n° existe déjà dans une autre saison, l&apos;import
        la refuse.
      </>
    ),
  },
  "supplier-orders": {
    format: (
      <>
        Export TIO <strong>StatGen « commande fournisseur »</strong>, reconnu automatiquement.
        En-tête attendu : un <strong>n° de commande</strong> (« N° commande PF fournisseur »), un{" "}
        <strong>fournisseur</strong> (« Fiche fournisseur » ou « Code fournisseur »),{" "}
        <strong>Fiche produit fini</strong>, Coloris produit fini, Total Q et Q. 1 … Q. 16.{" "}
        <strong>L&apos;ordre des colonnes n&apos;a pas d&apos;importance.</strong>
      </>
    ),
    how: (
      <>
        Même principe que les commandes clients : couleur = code avant le tiret, quantités{" "}
        <strong>Q.N</strong> décodées par la grille du produit, appariement au référentiel. Le{" "}
        <strong>fournisseur</strong> est créé automatiquement. Le fichier peut{" "}
        <strong>regrouper plusieurs commandes / fournisseurs</strong> → une commande est créée{" "}
        <strong>par n° de commande</strong>.
      </>
    ),
    links: (
      <>
        Rattachée à la <strong>saison choisie en haut</strong>. Une commande = <strong>une
        saison</strong> (doublon inter-saison refusé). Le <strong>n° de commande et le
        fournisseur sont obligatoires</strong> et lus dans le fichier. C&apos;est la commande à
        laquelle se rattacheront ensuite les <strong>réceptions</strong>.
      </>
    ),
  },
  receptions: {
    format: (
      <>
        <strong>Liste de colisage (Packing List)</strong>, reconnue automatiquement. Il faut une
        colonne <strong>référence</strong> (« FULL MCS PRODUCT REF », « REFERENCE »…), une colonne{" "}
        <strong>couleur</strong> (« COLOR CODE », « COLOR »…) et des <strong>colonnes de tailles</strong>{" "}
        (S, M, L, XL, 2XL… ou 36, 38, 40…). L&apos;<strong>ordre des colonnes n&apos;a pas
        d&apos;importance</strong> et la référence en tiret est convertie en underscore (EPOMC-C001
        → EPOMC_C001).
      </>
    ),
    how: (
      <>
        Les tailles sont repérées <strong>par leur nom</strong> (pas par leur position). Les
        quantités sont <strong>additionnées sur toutes les lignes de colis</strong> (hors lignes
        TOTAL / récapitulatif), puis chaque ligne est appariée à un produit du référentiel (réf +
        code couleur).
      </>
    ),
    links: (
      <>
        Le n° de commande fournisseur est <strong>facultatif</strong> : laissé vide, la réception
        est <strong>rattachée automatiquement</strong> à la commande fournisseur de la même saison
        qui contient ces produits (<strong>importe d&apos;abord la commande fournisseur</strong>).
        Tu peux saisir un n° pour forcer une commande précise.
      </>
    ),
  },
  stock: {
    format: (
      <>
        Fichier Excel <strong>générique</strong> avec <strong>mapping manuel</strong> des colonnes.
        Colonnes requises : <strong>Référence</strong> + <strong>Couleur</strong>, plus des{" "}
        <strong>colonnes de tailles</strong> (ex. S, M, L, XL… ou 36, 38, 40…) contenant les
        quantités.
      </>
    ),
    how: (
      <>
        Tu associes chaque colonne du fichier au champ correspondant (aperçu + mapping affichés
        après dépôt), puis les quantités par taille sont enregistrées comme état de stock.
      </>
    ),
    links: (
      <>
        Rattaché à la <strong>saison choisie en haut</strong>. Produits appariés au référentiel
        par (référence, couleur).
      </>
    ),
  },
};

function ImportHelp({ tabId }: { tabId: string }) {
  const [open, setOpen] = useState(true);
  const h = IMPORT_HELP[tabId];
  if (!h) return null;
  return (
    <div className="rounded-lg border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm font-medium"
      >
        <span className="flex items-center gap-2">
          <Info className="h-4 w-4 text-blue-600" />
          Aide — format attendu &amp; fonctionnement
        </span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-2 border-t px-3 py-3 text-sm text-muted-foreground">
          <p>
            <span className="font-semibold text-foreground">Format : </span>
            {h.format}
          </p>
          <p>
            <span className="font-semibold text-foreground">Fonctionnement : </span>
            {h.how}
          </p>
          <p>
            <span className="font-semibold text-foreground">Liens : </span>
            {h.links}
          </p>
        </div>
      )}
    </div>
  );
}

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
  seasonLabel,
}: {
  tab: (typeof IMPORT_TABS)[number];
  seasonId: string;
  seasonLabel: string;
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
    tab.id === "supplier-orders"
      ? "statgen"
      : tab.id === "receptions"
        ? "packing-list"
        : tab.id === "client-orders"
          ? "client-order"
          : null;

  const handleFileSelected = useCallback(
    async (selectedFile: File) => {
      setFile(selectedFile);
      setResult(null);
      setMcsFormat(null);
      setMcsRowCount(0);
      try {
        const buffer = await selectedFile.arrayBuffer();

        // Détection prioritaire du format MCS (commande fournisseur / client / réception).
        const fmt = detectMcsFormat(buffer);
        if (fmt) {
          setMcsFormat(fmt);
          setMcsRowCount(
            fmt === "statgen"
              ? parseMcsStatgen(buffer).length
              : fmt === "client-order"
                ? parseMcsClientOrders(buffer).length
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
      // N° de commande : facultatif pour la réception (auto-rattachement via les produits),
      // mais requis pour une commande fournisseur SANS colonne « N° commande ».
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
        // Réception : n° de commande facultatif (auto-rattachement sinon).
        if (mcsFormat === "packing-list" && supplierOrderNumber.trim())
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
      <ImportHelp tabId={tab.id} />
      <Dropzone onFileSelected={handleFileSelected} />

      {mcsMismatch && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Ce fichier ressemble à un format MCS «{" "}
            {mcsFormat === "statgen"
              ? "commande fournisseur"
              : mcsFormat === "client-order"
                ? "commande client"
                : "réception (liste de colisage)"}{" "}
            ».
            Sélectionne l'onglet correspondant pour l'importer.
          </span>
        </div>
      )}

      {parsed && useMcs && (
        <>
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <Check className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Format MCS détecté (
              {mcsFormat === "statgen"
                ? "commande fournisseur"
                : mcsFormat === "client-order"
                  ? "commande client"
                  : "Packing List"}
              ) —{" "}
              <strong>{mcsRowCount}</strong> ligne{mcsRowCount > 1 ? "s" : ""} prête
              {mcsRowCount > 1 ? "s" : ""}. Pas de mapping de colonnes nécessaire.
            </span>
          </div>

          {mcsFormat === "packing-list" && (
            <div className="space-y-1.5">
              <label htmlFor="supplierOrderNumber" className="text-sm font-medium">
                N° de commande fournisseur{" "}
                <span className="font-normal text-muted-foreground">(facultatif)</span>
              </label>
              <Input
                id="supplierOrderNumber"
                value={supplierOrderNumber}
                onChange={(e) => setSupplierOrderNumber(e.target.value)}
                placeholder="laisser vide = rattachement automatique"
                disabled={importing}
              />
              <p className="text-xs text-muted-foreground">
                Laissé vide, la réception est <strong>rattachée automatiquement</strong> à la
                commande fournisseur de la saison qui contient ces produits. Renseigne-le pour
                forcer une commande précise.
              </p>
            </div>
          )}

          <Button onClick={handleImport} disabled={importing} className="w-full">
            {importing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {importing
              ? "Import en cours..."
              : `Importer ${mcsRowCount} lignes dans ${seasonLabel}`}
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
              : `Importer ${parsed.rows.length} lignes dans ${seasonLabel}`}
          </Button>
        </>
      )}
    </div>
  );
}

export default function ImportPage() {
  const { seasons, activeSeason } = useSeason();
  // Saison CIBLE de l'import, choisie explicitement (≠ saison active globale).
  // Évite d'importer par erreur dans la saison active courante.
  const [importSeasonId, setImportSeasonId] = useState("");

  useEffect(() => {
    if (!importSeasonId && activeSeason) setImportSeasonId(activeSeason.id);
  }, [activeSeason, importSeasonId]);

  const importSeason = seasons.find((s) => s.id === importSeasonId) || null;

  return (
    <div>
      <Topbar title="Import" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-8">
        <PageHeader
          title="Import de données"
          description="Importez vos fichiers Excel pour alimenter le système"
        />

        {seasons.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <p className="text-sm text-muted-foreground">
                Créez une saison pour commencer les imports
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              {/* Saison CIBLE de l'import (rattachement unique et explicite). */}
              <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3 space-y-1.5">
                <label
                  htmlFor="import-season"
                  className="text-sm font-semibold flex items-center gap-2"
                >
                  <Calendar className="h-4 w-4" />
                  Importer dans la saison
                </label>
                <select
                  id="import-season"
                  value={importSeasonId}
                  onChange={(e) => setImportSeasonId(e.target.value)}
                  className="w-full rounded-lg border-2 border-input bg-background px-3 py-2 text-sm font-medium outline-none transition-colors focus:border-primary"
                >
                  {seasons.map((s) => (
                    <option key={s.id} value={s.id}>
                      {formatSeasonLabel(s)}
                      {activeSeason && s.id === activeSeason.id ? " — active" : ""}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Toutes les données importées (commandes clients, commandes fournisseurs,
                  réceptions…) seront rattachées à <strong>cette seule saison</strong>. Vérifie-la
                  avant d'importer.
                </p>
              </div>
            </CardHeader>
            <CardContent>
              {importSeason && (
                <Tabs defaultValue="client-orders">
                  <TabsList className="w-full justify-start">
                    {IMPORT_TABS.map((tab) => (
                      <TabsTrigger key={tab.id} value={tab.id} className="gap-2">
                        <tab.icon className="h-4 w-4" />
                        {tab.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {IMPORT_TABS.map((tab) => (
                    <TabsContent key={tab.id} value={tab.id} className="mt-6">
                      {/* key sur la saison → changer de saison cible réinitialise le tab
                          (le fichier chargé est vidé, on reconfirme consciemment). */}
                      <ImportTab
                        key={importSeason.id}
                        tab={tab}
                        seasonId={importSeason.id}
                        seasonLabel={formatSeasonLabel(importSeason)}
                      />
                    </TabsContent>
                  ))}
                </Tabs>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

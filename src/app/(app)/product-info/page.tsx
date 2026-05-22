"use client";

import { useState, useCallback, useEffect } from "react";
import { useSeason } from "@/lib/season-context";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Dropzone } from "@/components/import/dropzone";
import { ImportPreview } from "@/components/import/import-preview";
import {
  ColumnMapper,
  autoDetectMapping,
} from "@/components/import/column-mapper";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Ruler,
  Factory,
  Barcode,
  Check,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

interface ParsedData {
  headers: string[];
  rows: Record<string, string | number | null>[];
}

// ─── Size Types Import ───────────────────────────────────────

const SIZE_TYPE_PATTERNS: Record<string, RegExp[]> = {
  code: [/^code$/i, /type.*taille/i, /size.*type/i, /^type$/i],
  label: [/^label$/i, /^libell[eé]$/i, /^nom$/i, /description/i],
};

interface SizeTypeData {
  id: string;
  code: string;
  label: string | null;
  sizes: string[];
}

function SizeTypesTab({ seasonId }: { seasonId: string }) {
  const [parsed, setParsed] = useState<ParsedData | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    errors: string[];
  } | null>(null);
  const [sizeTypes, setSizeTypes] = useState<SizeTypeData[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/product-info/size-types");
      if (res.ok) {
        const json = await res.json();
        setSizeTypes(json.data || []);
      }
    } catch {} finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleFileSelected = useCallback(
    async (selectedFile: File) => {
      setFile(selectedFile);
      setResult(null);
      try {
        const buffer = await selectedFile.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json<
          Record<string, string | number | null>
        >(sheet, { defval: null });
        const headers = data.length > 0 ? Object.keys(data[0]) : [];
        setParsed({ headers, rows: data });
        setMapping(autoDetectMapping(headers, SIZE_TYPE_PATTERNS));
      } catch {
        toast.error("Impossible de lire le fichier");
      }
    },
    []
  );

  const handleImport = async () => {
    if (!file || !parsed) return;
    if (!mapping.code) {
      toast.error("La colonne 'Code' est requise");
      return;
    }
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("seasonId", seasonId);
      formData.append("mapping", JSON.stringify(mapping));
      const res = await fetch("/api/product-info/size-types", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Erreur");
        return;
      }
      setResult(json.data);
      toast.success(`${json.data.imported} types de taille importés`);
      loadData();
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
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-muted/30 p-4">
        <p className="text-sm text-muted-foreground">
          <strong>Format attendu :</strong> Un fichier avec une colonne{" "}
          <code className="bg-muted px-1 rounded">code</code> (type de taille) et
          les colonnes suivantes contiennent les noms des tailles dans l&apos;ordre.
          Ex : code | 1 | 2 | 3 | 4 → A | XS | S | M | L
        </p>
      </div>

      {result ? (
        <ImportResult result={result} onReset={reset} />
      ) : (
        <>
          <Dropzone onFileSelected={handleFileSelected} />
          {parsed && (
            <>
              <ImportPreview headers={parsed.headers} rows={parsed.rows} />
              <ColumnMapper
                headers={parsed.headers}
                fields={[
                  { key: "code", label: "Code type de taille", required: true },
                  { key: "label", label: "Libellé" },
                ]}
                mapping={mapping}
                onMappingChange={setMapping}
              />
              <p className="text-xs text-muted-foreground">
                Les colonnes non mappées seront interprétées comme des tailles
                (dans l&apos;ordre).
              </p>
              <Button onClick={handleImport} disabled={importing} className="w-full">
                {importing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {importing ? "Import en cours..." : `Importer ${parsed.rows.length} lignes`}
              </Button>
            </>
          )}
        </>
      )}

      {/* Existing data */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Types de taille importés
            <Badge variant="secondary" className="ml-2">{sizeTypes.length}</Badge>
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={loadData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {loadingData ? (
            <p className="text-sm text-muted-foreground animate-pulse">Chargement...</p>
          ) : sizeTypes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun type de taille importé</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Libellé</TableHead>
                  <TableHead>Tailles</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sizeTypes.map((st) => (
                  <TableRow key={st.id}>
                    <TableCell className="font-mono font-medium">{st.code}</TableCell>
                    <TableCell>{st.label || "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {st.sizes.map((s, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Supplier Refs Import ────────────────────────────────────

const SUPPLIER_REF_PATTERNS: Record<string, RegExp[]> = {
  supplierCode: [/code.*fourn/i, /fourn.*code/i, /^code$/i, /supplier/i],
  supplierName: [/nom.*fourn/i, /fournisseur/i, /supplier.*name/i, /^nom$/i],
  reference: [/r[eé]f[eé]rence/i, /^ref$/i, /article/i, /product/i],
};

interface SupplierRefData {
  id: string;
  reference: string;
  supplier: { code: string; name: string };
}

function SupplierRefsTab({ seasonId }: { seasonId: string }) {
  const [parsed, setParsed] = useState<ParsedData | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    errors: string[];
  } | null>(null);
  const [refs, setRefs] = useState<SupplierRefData[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [search, setSearch] = useState("");

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/product-info/supplier-refs");
      if (res.ok) {
        const json = await res.json();
        setRefs(json.data || []);
      }
    } catch {} finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleFileSelected = useCallback(
    async (selectedFile: File) => {
      setFile(selectedFile);
      setResult(null);
      try {
        const buffer = await selectedFile.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json<
          Record<string, string | number | null>
        >(sheet, { defval: null });
        const headers = data.length > 0 ? Object.keys(data[0]) : [];
        setParsed({ headers, rows: data });
        setMapping(autoDetectMapping(headers, SUPPLIER_REF_PATTERNS));
      } catch {
        toast.error("Impossible de lire le fichier");
      }
    },
    []
  );

  const handleImport = async () => {
    if (!file || !parsed) return;
    if (!mapping.supplierCode || !mapping.reference) {
      toast.error("Code fournisseur et référence requis");
      return;
    }
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("seasonId", seasonId);
      formData.append("mapping", JSON.stringify(mapping));
      const res = await fetch("/api/product-info/supplier-refs", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Erreur");
        return;
      }
      setResult(json.data);
      toast.success(`${json.data.imported} correspondances importées`);
      loadData();
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
  };

  const filtered = search
    ? refs.filter(
        (r) =>
          r.reference.toLowerCase().includes(search.toLowerCase()) ||
          r.supplier.code.toLowerCase().includes(search.toLowerCase()) ||
          r.supplier.name.toLowerCase().includes(search.toLowerCase())
      )
    : refs;

  return (
    <div className="space-y-6">
      {result ? (
        <ImportResult result={result} onReset={reset} />
      ) : (
        <>
          <Dropzone onFileSelected={handleFileSelected} />
          {parsed && (
            <>
              <ImportPreview headers={parsed.headers} rows={parsed.rows} />
              <ColumnMapper
                headers={parsed.headers}
                fields={[
                  { key: "supplierCode", label: "Code fournisseur", required: true },
                  { key: "supplierName", label: "Nom fournisseur" },
                  { key: "reference", label: "Référence produit", required: true },
                ]}
                mapping={mapping}
                onMappingChange={setMapping}
              />
              <Button onClick={handleImport} disabled={importing} className="w-full">
                {importing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {importing ? "Import en cours..." : `Importer ${parsed.rows.length} lignes`}
              </Button>
            </>
          )}
        </>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Correspondances fournisseur → référence
            <Badge variant="secondary" className="ml-2">{refs.length}</Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 w-48 h-9"
              />
            </div>
            <Button variant="ghost" size="sm" onClick={loadData}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingData ? (
            <p className="text-sm text-muted-foreground animate-pulse">Chargement...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {refs.length === 0
                ? "Aucune correspondance importée"
                : "Aucun résultat"}
            </p>
          ) : (
            <div className="max-h-96 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fournisseur</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Référence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.slice(0, 100).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.supplier.name}</TableCell>
                      <TableCell className="font-mono text-sm">{r.supplier.code}</TableCell>
                      <TableCell className="font-mono font-medium">{r.reference}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filtered.length > 100 && (
                <p className="text-xs text-muted-foreground text-center mt-2">
                  {filtered.length - 100} lignes supplémentaires...
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── EAN Import ──────────────────────────────────────────────

const EAN_PATTERNS: Record<string, RegExp[]> = {
  reference: [/r[eé]f[eé]rence/i, /^ref$/i, /article/i, /product/i],
  color: [/couleur/i, /color/i, /coloris/i],
  size: [/taille/i, /size/i, /^t$/i],
  ean: [/ean/i, /gtin/i, /barcode/i, /code.?barre/i],
};

interface EanData {
  id: string;
  reference: string;
  color: string;
  size: string;
  ean: string;
}

function EansTab({ seasonId }: { seasonId: string }) {
  const [parsed, setParsed] = useState<ParsedData | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    errors: string[];
  } | null>(null);
  const [eans, setEans] = useState<EanData[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingData, setLoadingData] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const loadData = useCallback(async () => {
    setLoadingData(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (search) params.set("search", search);
      const res = await fetch(`/api/product-info/eans?${params}`);
      if (res.ok) {
        const json = await res.json();
        setEans(json.data || []);
        setTotal(json.total || 0);
      }
    } catch {} finally {
      setLoadingData(false);
    }
  }, [page, search]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleFileSelected = useCallback(
    async (selectedFile: File) => {
      setFile(selectedFile);
      setResult(null);
      try {
        const buffer = await selectedFile.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json<
          Record<string, string | number | null>
        >(sheet, { defval: null });
        const headers = data.length > 0 ? Object.keys(data[0]) : [];
        setParsed({ headers, rows: data });
        setMapping(autoDetectMapping(headers, EAN_PATTERNS));
      } catch {
        toast.error("Impossible de lire le fichier");
      }
    },
    []
  );

  const handleImport = async () => {
    if (!file || !parsed) return;
    const missing = ["reference", "color", "size", "ean"].filter(
      (k) => !mapping[k]
    );
    if (missing.length > 0) {
      toast.error(`Colonnes requises manquantes`);
      return;
    }
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("seasonId", seasonId);
      formData.append("mapping", JSON.stringify(mapping));
      const res = await fetch("/api/product-info/eans", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Erreur");
        return;
      }
      setResult(json.data);
      toast.success(`${json.data.imported} EAN importés`);
      loadData();
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
  };

  return (
    <div className="space-y-6">
      {result ? (
        <ImportResult result={result} onReset={reset} />
      ) : (
        <>
          <Dropzone onFileSelected={handleFileSelected} />
          {parsed && (
            <>
              <ImportPreview headers={parsed.headers} rows={parsed.rows} />
              <ColumnMapper
                headers={parsed.headers}
                fields={[
                  { key: "reference", label: "Référence", required: true },
                  { key: "color", label: "Couleur", required: true },
                  { key: "size", label: "Taille", required: true },
                  { key: "ean", label: "EAN / Code-barres", required: true },
                ]}
                mapping={mapping}
                onMappingChange={setMapping}
              />
              <Button onClick={handleImport} disabled={importing} className="w-full">
                {importing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {importing ? "Import en cours..." : `Importer ${parsed.rows.length} lignes`}
              </Button>
            </>
          )}
        </>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Base EAN
            <Badge variant="secondary" className="ml-2">{total}</Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher ref, couleur, EAN..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-9 w-64 h-9"
              />
            </div>
            <Button variant="ghost" size="sm" onClick={loadData}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingData ? (
            <p className="text-sm text-muted-foreground animate-pulse">Chargement...</p>
          ) : eans.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {total === 0 ? "Aucun EAN importé" : "Aucun résultat"}
            </p>
          ) : (
            <>
              <div className="max-h-96 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Référence</TableHead>
                      <TableHead>Couleur</TableHead>
                      <TableHead>Taille</TableHead>
                      <TableHead>EAN</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {eans.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-mono font-medium">
                          {e.reference}
                        </TableCell>
                        <TableCell>{e.color}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {e.size}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {e.ean}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {total > 100 && (
                <div className="flex items-center justify-between mt-3">
                  <p className="text-xs text-muted-foreground">
                    Page {page} / {Math.ceil(total / 100)} ({total} EAN au total)
                  </p>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      Précédent
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setPage((p) => Math.min(Math.ceil(total / 100), p + 1))
                      }
                      disabled={page >= Math.ceil(total / 100)}
                    >
                      Suivant
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Shared result component ─────────────────────────────────

function ImportResult({
  result,
  onReset,
}: {
  result: { imported: number; errors: string[] };
  onReset: () => void;
}) {
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
            {result.imported} ligne{result.imported > 1 ? "s" : ""} importée
            {result.imported > 1 ? "s" : ""}
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
          </div>
        )}
      </div>
      <Button onClick={onReset} variant="outline" className="w-full">
        Importer un autre fichier
      </Button>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────

export default function ProductInfoPage() {
  const { activeSeason } = useSeason();

  return (
    <div>
      <Topbar title="Infos produits" />
      <div className="p-8 space-y-8">
        <PageHeader
          title="Infos produits"
          description="Importez les types de taille, correspondances fournisseurs et EAN pour alimenter la base produits"
        />

        {!activeSeason ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <p className="text-sm text-muted-foreground">
                Sélectionnez une saison pour commencer
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                Saison {activeSeason.name}
                <Badge variant="secondary">Active</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="size-types">
                <TabsList className="w-full justify-start">
                  <TabsTrigger value="size-types" className="gap-2">
                    <Ruler className="h-4 w-4" />
                    Types de taille
                  </TabsTrigger>
                  <TabsTrigger value="supplier-refs" className="gap-2">
                    <Factory className="h-4 w-4" />
                    Fournisseur → Réf
                  </TabsTrigger>
                  <TabsTrigger value="eans" className="gap-2">
                    <Barcode className="h-4 w-4" />
                    EAN
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="size-types" className="mt-6">
                  <SizeTypesTab seasonId={activeSeason.id} />
                </TabsContent>
                <TabsContent value="supplier-refs" className="mt-6">
                  <SupplierRefsTab seasonId={activeSeason.id} />
                </TabsContent>
                <TabsContent value="eans" className="mt-6">
                  <EansTab seasonId={activeSeason.id} />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

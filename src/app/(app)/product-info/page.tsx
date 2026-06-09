"use client";

import { useState, useCallback, useEffect, useRef } from "react";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Ruler,
  Factory,
  Barcode,
  Check,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Pencil,
  Plus,
  X,
  Save,
  GripVertical,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

interface ParsedData {
  headers: string[];
  rows: Record<string, string | number | null>[];
}

// ─── Size Types Tab ─────────────────────────────────────────

const SIZE_TYPE_ROW_PATTERNS: Record<string, RegExp[]> = {
  sizeTypeCode: [/^code$/i, /type.*taille/i, /size.*type/i, /^type$/i],
  sizeName: [/valeur/i, /taille/i, /size.*name/i, /^nom$/i, /^size$/i],
  position: [/num[eé]ro/i, /position/i, /^n°$/i, /^no$/i, /^#$/i, /^num$/i],
  label: [/^label$/i, /^libell[eé]$/i, /description/i],
};

interface SizeTypeMapping {
  id: string;
  position: number;
  sizeName: string;
}

interface SizeTypeData {
  id: string;
  code: string;
  label: string | null;
  mappings: SizeTypeMapping[];
}

// Editable mapping row for inline editing
interface EditableMapping {
  position: number;
  sizeName: string;
  _key: string; // local unique key for React
}

function SizeTypesTab() {
  const [parsed, setParsed] = useState<ParsedData | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [importFormat, setImportFormat] = useState<"rows" | "columns">("rows");
  const [result, setResult] = useState<{
    imported: number;
    errors: string[];
  } | null>(null);
  const [sizeTypes, setSizeTypes] = useState<SizeTypeData[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SizeTypeData | null>(null);
  const [search, setSearch] = useState("");
  const [showImport, setShowImport] = useState(false);

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editMappings, setEditMappings] = useState<EditableMapping[]>([]);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/product-info/size-types");
      if (res.ok) {
        const json = await res.json();
        setSizeTypes(json.data || []);
      }
    } catch {
    } finally {
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
        setMapping(autoDetectMapping(headers, SIZE_TYPE_ROW_PATTERNS));
      } catch {
        toast.error("Impossible de lire le fichier");
      }
    },
    []
  );

  const handleImport = async () => {
    if (!file || !parsed) return;
    if (
      importFormat === "rows" &&
      (!mapping.sizeTypeCode || !mapping.sizeName || !mapping.position)
    ) {
      toast.error("Colonnes Type, Valeur taille et Numéro requis");
      return;
    }
    if (importFormat === "columns" && !mapping.sizeTypeCode) {
      toast.error("La colonne 'Code type' est requise");
      return;
    }
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mapping", JSON.stringify(mapping));
      formData.append("format", importFormat);
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
      toast.success(`${json.data.imported} entrées importées`);
      loadData();
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (id: string, code: string) => {
    setDeleting(id);
    try {
      const res = await fetch(`/api/product-info/size-types?id=${id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Erreur de suppression");
        return;
      }
      toast.success(`Type "${code}" supprimé`);
      loadData();
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setDeleting(null);
    }
  };

  // ─── Inline Editing ─────────────────────────
  const startEditing = (st: SizeTypeData) => {
    setEditingId(st.id);
    setEditLabel(st.label || "");
    setEditMappings(
      st.mappings.map((m, i) => ({
        position: m.position,
        sizeName: m.sizeName,
        _key: `existing-${i}`,
      }))
    );
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditLabel("");
    setEditMappings([]);
  };

  const addMappingRow = () => {
    const maxPos =
      editMappings.length > 0
        ? Math.max(...editMappings.map((m) => m.position))
        : 0;
    setEditMappings([
      ...editMappings,
      { position: maxPos + 1, sizeName: "", _key: `new-${Date.now()}` },
    ]);
  };

  const removeMappingRow = (key: string) => {
    setEditMappings(editMappings.filter((m) => m._key !== key));
  };

  const updateMappingField = (
    key: string,
    field: "position" | "sizeName",
    value: string | number
  ) => {
    setEditMappings(
      editMappings.map((m) =>
        m._key === key ? { ...m, [field]: value } : m
      )
    );
  };

  const saveEditing = async () => {
    if (!editingId) return;
    const validMappings = editMappings.filter(
      (m) => m.sizeName.trim() && m.position > 0
    );
    if (validMappings.length === 0) {
      toast.error("Au moins une taille est requise");
      return;
    }
    // Check for duplicate positions
    const positions = validMappings.map((m) => m.position);
    if (new Set(positions).size !== positions.length) {
      toast.error("Les positions doivent être uniques");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/product-info/size-types", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId,
          label: editLabel || null,
          mappings: validMappings.map((m) => ({
            position: m.position,
            sizeName: m.sizeName.trim(),
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Erreur de sauvegarde");
        return;
      }
      toast.success("Type de taille mis à jour");
      setEditingId(null);
      loadData();
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setParsed(null);
    setFile(null);
    setMapping({});
    setResult(null);
  };

  const rowFields = [
    { key: "sizeTypeCode", label: "Type de taille", required: true },
    { key: "sizeName", label: "Valeur taille", required: true },
    { key: "position", label: "Numéro de taille", required: true },
    { key: "label", label: "Libellé type" },
  ];

  const colFields = [
    { key: "sizeTypeCode", label: "Code type de taille", required: true },
    { key: "label", label: "Libellé" },
  ];

  // Filtered data
  const filtered = search
    ? sizeTypes.filter(
        (st) =>
          st.code.toLowerCase().includes(search.toLowerCase()) ||
          (st.label || "").toLowerCase().includes(search.toLowerCase()) ||
          st.mappings.some((m) =>
            m.sizeName.toLowerCase().includes(search.toLowerCase())
          )
      )
    : sizeTypes;

  return (
    <div className="space-y-6">
      {/* ─── Import toggle ────────────────────────── */}
      <div className="flex items-center justify-between">
        <Button
          variant={showImport ? "default" : "outline"}
          size="sm"
          onClick={() => setShowImport(!showImport)}
          className="gap-2"
        >
          {showImport ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showImport ? "Fermer l'import" : "Importer depuis fichier"}
        </Button>
      </div>

      {/* ─── Import section (collapsible) ─────────── */}
      {showImport && (
        <Card className="border-dashed">
          <CardContent className="pt-6 space-y-4">
            <div className="flex gap-2 items-center">
              <span className="text-sm font-medium">Format :</span>
              <Button
                variant={importFormat === "rows" ? "default" : "outline"}
                size="sm"
                onClick={() => setImportFormat("rows")}
              >
                Ligne par ligne
              </Button>
              <Button
                variant={importFormat === "columns" ? "default" : "outline"}
                size="sm"
                onClick={() => setImportFormat("columns")}
              >
                Colonnes
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {importFormat === "rows" ? (
                <>
                  <strong>Ligne par ligne :</strong> Chaque ligne = 1 mapping. Ex
                  : <code className="bg-muted px-1 rounded">HAU | XS | 1</code>
                </>
              ) : (
                <>
                  <strong>Colonnes :</strong> Chaque ligne = 1 type, les colonnes
                  = positions. Ex :{" "}
                  <code className="bg-muted px-1 rounded">
                    HAU | XS | S | M | L
                  </code>
                </>
              )}
            </p>

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
                      fields={importFormat === "rows" ? rowFields : colFields}
                      mapping={mapping}
                      onMappingChange={setMapping}
                    />
                    {importFormat === "columns" && (
                      <p className="text-xs text-muted-foreground">
                        Les colonnes non mappées seront interprétées comme des
                        tailles (dans l&apos;ordre : position 1, 2, 3...).
                      </p>
                    )}
                    <Button
                      onClick={handleImport}
                      disabled={importing}
                      className="w-full"
                    >
                      {importing && (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      )}
                      {importing
                        ? "Import en cours..."
                        : `Importer ${parsed.rows.length} lignes`}
                    </Button>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─── Delete confirmation ────────────────────── */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer le type de taille ?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  Le type <strong>{deleteTarget.code}</strong>
                  {deleteTarget.label ? ` (${deleteTarget.label})` : ""} et ses{" "}
                  {deleteTarget.mappings.length} taille
                  {deleteTarget.mappings.length > 1 ? "s" : ""} seront
                  définitivement supprimés. Cette action est irréversible.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTarget(null)}>
              Annuler
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) {
                  handleDelete(deleteTarget.id, deleteTarget.code);
                  setDeleteTarget(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Data section ───────────────────────────── */}
      <div className="space-y-4">
        {/* Header with search */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h3 className="text-base font-semibold">Types de taille</h3>
            <Badge variant="secondary">{sizeTypes.length}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher code, libellé, taille..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 w-64 h-9"
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setLoadingData(true); loadData(); }}
              className="h-9 w-9 p-0"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        {loadingData ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">
              Chargement...
            </span>
          </div>
        ) : filtered.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Ruler className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">
                {sizeTypes.length === 0
                  ? "Aucun type de taille importé"
                  : "Aucun résultat pour cette recherche"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((st) => {
              const isEditing = editingId === st.id;

              return (
                <Card
                  key={st.id}
                  className={cn(
                    "transition-all",
                    isEditing && "ring-2 ring-primary shadow-md col-span-full md:col-span-2 xl:col-span-3"
                  )}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100 font-mono text-xs">
                          {st.code}
                        </Badge>
                        {isEditing ? (
                          <Input
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            placeholder="Libellé (optionnel)"
                            className="h-7 w-48 text-sm"
                          />
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {st.label || "—"}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {!isEditing && (
                          <>
                            <span className="text-xs text-muted-foreground mr-2">
                              {st.mappings.length} taille
                              {st.mappings.length > 1 ? "s" : ""}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
                              onClick={() => startEditing(st)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                              disabled={deleting === st.id}
                              onClick={() => setDeleteTarget(st)}
                            >
                              {deleting === st.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </>
                        )}
                        {isEditing && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-xs"
                              onClick={cancelEditing}
                              disabled={saving}
                            >
                              <X className="h-3.5 w-3.5" />
                              Annuler
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 gap-1 text-xs"
                              onClick={saveEditing}
                              disabled={saving}
                            >
                              {saving ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Save className="h-3.5 w-3.5" />
                              )}
                              Enregistrer
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {isEditing ? (
                      /* ─── Edit mode ─── */
                      <div className="space-y-2">
                        <div className="grid grid-cols-[60px_1fr_36px] gap-2 text-xs font-medium text-muted-foreground px-1">
                          <span>Position</span>
                          <span>Taille</span>
                          <span />
                        </div>
                        {editMappings
                          .sort((a, b) => a.position - b.position)
                          .map((m) => (
                            <div
                              key={m._key}
                              className="grid grid-cols-[60px_1fr_36px] gap-2 items-center"
                            >
                              <Input
                                type="number"
                                min={1}
                                value={m.position}
                                onChange={(e) =>
                                  updateMappingField(
                                    m._key,
                                    "position",
                                    parseInt(e.target.value) || 1
                                  )
                                }
                                className="h-8 text-center font-mono text-sm"
                              />
                              <Input
                                value={m.sizeName}
                                onChange={(e) =>
                                  updateMappingField(
                                    m._key,
                                    "sizeName",
                                    e.target.value
                                  )
                                }
                                placeholder="Ex: S, M, 38..."
                                className="h-8 text-sm"
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                                onClick={() => removeMappingRow(m._key)}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full gap-1 text-xs mt-1"
                          onClick={addMappingRow}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Ajouter une taille
                        </Button>
                      </div>
                    ) : (
                      /* ─── Read mode: compact pill layout ─── */
                      <div className="flex flex-wrap gap-1.5">
                        {st.mappings.map((m) => (
                          <div
                            key={m.id}
                            className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1"
                          >
                            <span className="text-[10px] font-mono text-muted-foreground">
                              {m.position}
                            </span>
                            <span className="text-xs font-medium">
                              {m.sizeName}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
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

function SupplierRefsTab() {
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
  const [supplierFilter, setSupplierFilter] = useState("");
  const [showImport, setShowImport] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/product-info/supplier-refs");
      if (res.ok) {
        const json = await res.json();
        setRefs(json.data || []);
      }
    } catch {
    } finally {
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

  // Unique suppliers for dropdown
  const suppliers = Array.from(
    new Map(refs.map((r) => [r.supplier.code, r.supplier])).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

  const filtered = refs.filter((r) => {
    const matchesSearch =
      !search ||
      r.reference.toLowerCase().includes(search.toLowerCase()) ||
      r.supplier.code.toLowerCase().includes(search.toLowerCase()) ||
      r.supplier.name.toLowerCase().includes(search.toLowerCase());
    const matchesSupplier =
      !supplierFilter || r.supplier.code === supplierFilter;
    return matchesSearch && matchesSupplier;
  });

  return (
    <div className="space-y-6">
      {/* Import toggle */}
      <Button
        variant={showImport ? "default" : "outline"}
        size="sm"
        onClick={() => setShowImport(!showImport)}
        className="gap-2"
      >
        {showImport ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        {showImport ? "Fermer l'import" : "Importer depuis fichier"}
      </Button>

      {showImport && (
        <Card className="border-dashed">
          <CardContent className="pt-6 space-y-4">
            {result ? (
              <ImportResult result={result} onReset={reset} />
            ) : (
              <>
                <Dropzone onFileSelected={handleFileSelected} />
                {parsed && (
                  <>
                    <ImportPreview
                      headers={parsed.headers}
                      rows={parsed.rows}
                    />
                    <ColumnMapper
                      headers={parsed.headers}
                      fields={[
                        {
                          key: "supplierCode",
                          label: "Code fournisseur",
                          required: true,
                        },
                        { key: "supplierName", label: "Nom fournisseur" },
                        {
                          key: "reference",
                          label: "Référence produit",
                          required: true,
                        },
                      ]}
                      mapping={mapping}
                      onMappingChange={setMapping}
                    />
                    <Button
                      onClick={handleImport}
                      disabled={importing}
                      className="w-full"
                    >
                      {importing && (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      )}
                      {importing
                        ? "Import en cours..."
                        : `Importer ${parsed.rows.length} lignes`}
                    </Button>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Data section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h3 className="text-base font-semibold">
              Correspondances fournisseur
            </h3>
            <Badge variant="secondary">{refs.length}</Badge>
          </div>
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
            <Select
              value={supplierFilter}
              onValueChange={(v) => setSupplierFilter(v === "all" || !v ? "" : v)}
            >
              <SelectTrigger className="w-48 h-9">
                <SelectValue placeholder="Tous les fournisseurs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les fournisseurs</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadData}
              className="h-9 w-9 p-0"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {loadingData ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">
              Chargement...
            </span>
          </div>
        ) : filtered.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Factory className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">
                {refs.length === 0
                  ? "Aucune correspondance importée"
                  : "Aucun résultat"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="max-h-[500px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fournisseur</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Référence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.slice(0, 200).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm">
                          {r.supplier.name}
                        </TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">
                          {r.supplier.code}
                        </TableCell>
                        <TableCell className="font-mono font-medium text-sm">
                          {r.reference}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {filtered.length > 200 && (
                <div className="border-t px-4 py-2 text-xs text-muted-foreground text-center">
                  {filtered.length - 200} lignes supplémentaires non affichées
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
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
  stock: number;
}

function EansTab() {
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
  const [showImport, setShowImport] = useState(false);

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
    } catch {
    } finally {
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
      toast.error("Colonnes requises manquantes");
      return;
    }
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
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

  const totalPages = Math.ceil(total / 100);

  return (
    <div className="space-y-6">
      {/* Import toggle */}
      <Button
        variant={showImport ? "default" : "outline"}
        size="sm"
        onClick={() => setShowImport(!showImport)}
        className="gap-2"
      >
        {showImport ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        {showImport ? "Fermer l'import" : "Importer depuis fichier"}
      </Button>

      {showImport && (
        <Card className="border-dashed">
          <CardContent className="pt-6 space-y-4">
            {result ? (
              <ImportResult result={result} onReset={reset} />
            ) : (
              <>
                <Dropzone onFileSelected={handleFileSelected} />
                {parsed && (
                  <>
                    <ImportPreview
                      headers={parsed.headers}
                      rows={parsed.rows}
                    />
                    <ColumnMapper
                      headers={parsed.headers}
                      fields={[
                        {
                          key: "reference",
                          label: "Référence",
                          required: true,
                        },
                        { key: "color", label: "Couleur", required: true },
                        { key: "size", label: "Taille", required: true },
                        {
                          key: "ean",
                          label: "EAN / Code-barres",
                          required: true,
                        },
                      ]}
                      mapping={mapping}
                      onMappingChange={setMapping}
                    />
                    <Button
                      onClick={handleImport}
                      disabled={importing}
                      className="w-full"
                    >
                      {importing && (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      )}
                      {importing
                        ? "Import en cours..."
                        : `Importer ${parsed.rows.length} lignes`}
                    </Button>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Data section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h3 className="text-base font-semibold">Base EAN</h3>
            <Badge variant="secondary">{total}</Badge>
          </div>
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
            <Button
              variant="ghost"
              size="sm"
              onClick={loadData}
              className="h-9 w-9 p-0"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {loadingData ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">
              Chargement...
            </span>
          </div>
        ) : eans.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Barcode className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">
                {total === 0 ? "Aucun EAN importé" : "Aucun résultat"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="max-h-[500px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Référence</TableHead>
                      <TableHead>Couleur</TableHead>
                      <TableHead>Taille</TableHead>
                      <TableHead>EAN</TableHead>
                      <TableHead className="text-right">Stock</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {eans.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-mono font-medium text-sm">
                          {e.reference}
                        </TableCell>
                        <TableCell className="text-sm">{e.color}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {e.size}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">
                          {e.ean}
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={cn(
                              "font-medium text-sm tabular-nums",
                              e.stock > 0
                                ? "text-emerald-600"
                                : "text-zinc-400"
                            )}
                          >
                            {e.stock}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t px-4 py-2">
                  <p className="text-xs text-muted-foreground">
                    Page {page} / {totalPages} ({total} EAN)
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
                        setPage((p) => Math.min(totalPages, p + 1))
                      }
                      disabled={page >= totalPages}
                    >
                      Suivant
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
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
            {result.imported} entrée{result.imported > 1 ? "s" : ""} importée
            {result.imported > 1 ? "s" : ""}
          </p>
          {result.errors.length > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              {result.errors.length} erreur
              {result.errors.length > 1 ? "s" : ""}
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

// ─── Main Page ──────────────────────────────────────────────

export default function ProductInfoPage() {
  return (
    <div>
      <Topbar title="Infos produits" />
      <div className="p-8 space-y-6">
        <PageHeader
          title="Infos produits"
          description="Données globales trans-saison : types de taille, correspondances fournisseurs et codes EAN"
        />

        <Tabs defaultValue="size-types">
          <TabsList className="w-full justify-start bg-muted/50 p-1">
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
            <SizeTypesTab />
          </TabsContent>
          <TabsContent value="supplier-refs" className="mt-6">
            <SupplierRefsTab />
          </TabsContent>
          <TabsContent value="eans" className="mt-6">
            <EansTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

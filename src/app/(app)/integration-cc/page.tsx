"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileSpreadsheet, Upload, Download, AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import {
  parseIntegrationSource,
  buildIntegrationDocuments,
  integrationFileName,
  formatImportDate,
  INTEGRATION_HEADERS,
  type IntegrationDocument,
  type IntegrationSourceLine,
} from "@/lib/integration-cc";

// Marque(s) retenues pour le fichier d'intégration.
const BRANDS = ["MCS"];

interface ClientRow {
  code: string;
  name: string;
  deliveryCity: string | null;
}

export default function IntegrationCcPage() {
  const [file, setFile] = useState<File | null>(null);
  const [lines, setLines] = useState<IntegrationSourceLine[]>([]);
  const [docs, setDocs] = useState<IntegrationDocument[]>([]);
  // Date d'import du fichier d'origine (figée au dépôt, pas à la génération) → nom du fichier.
  const [importDate, setImportDate] = useState("");
  // Documents cochés : un export Texas embarque parfois PLUSIEURS n° de document (et donc
  // plusieurs clients) — on laisse choisir ceux à générer. Tous cochés par défaut.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clients, setClients] = useState<Map<string, ClientRow>>(new Map());
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((d) => {
        const m = new Map<string, ClientRow>();
        for (const c of d.data || []) {
          m.set(String(c.code).trim(), {
            code: c.code,
            name: c.name,
            deliveryCity: c.deliveryCity ?? null,
          });
        }
        setClients(m);
      })
      .catch(() => {});
  }, []);

  const cityFor = useCallback(
    (clientCode: string) => clients.get(clientCode.trim())?.deliveryCity || "",
    [clients]
  );

  const reset = () => {
    setFile(null);
    setLines([]);
    setDocs([]);
    setImportDate("");
    setSelected(new Set());
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFile = async (f: File) => {
    setFile(f);
    setImportDate(formatImportDate(new Date()));
    setBusy(true);
    try {
      const buffer = await f.arrayBuffer();
      const parsed = parseIntegrationSource(buffer);
      if (parsed.length === 0) {
        toast.error("Format non reconnu", {
          description:
            "Le fichier doit contenir les colonnes « N° Document » et « Code Produit Fini ».",
        });
        reset();
        return;
      }
      const built = buildIntegrationDocuments(parsed, BRANDS);
      setLines(parsed);
      setDocs(built);
      setSelected(new Set(built.map((d) => d.documentNumber)));
    } catch {
      toast.error("Impossible de lire le fichier");
      reset();
    } finally {
      setBusy(false);
    }
  };

  const sheetFor = (doc: IntegrationDocument) => {
    const ws = XLSX.utils.json_to_sheet(doc.rows, { header: [...INTEGRATION_HEADERS] });
    // Prix affiché à 2 décimales dans Excel (la valeur est déjà arrondie par la lib).
    const priceCol = INTEGRATION_HEADERS.indexOf("prix de revient HT");
    for (let r = 1; r <= doc.rows.length; r++) {
      const cell = ws[XLSX.utils.encode_cell({ c: priceCol, r })];
      if (cell && cell.t === "n") cell.z = "0.00";
    }
    ws["!cols"] = INTEGRATION_HEADERS.map((h) => ({
      wch: Math.min(
        45,
        Math.max(h.length + 2, ...doc.rows.map((r) => String(r[h] ?? "").length))
      ),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Feuil1");
    return wb;
  };

  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = async () => {
    const chosen = docs.filter((d) => selected.has(d.documentNumber));
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      // Un seul document → fichier direct ; plusieurs → zip (un fichier par n° de document).
      if (chosen.length === 1) {
        const doc = chosen[0];
        const out = XLSX.write(sheetFor(doc), { type: "array", bookType: "xlsx" });
        download(
          new Blob([out], { type: "application/octet-stream" }),
          integrationFileName(doc.documentNumber, cityFor(doc.clientCode), importDate)
        );
      } else {
        const zip = new JSZip();
        for (const doc of chosen) {
          const out = XLSX.write(sheetFor(doc), { type: "array", bookType: "xlsx" });
          zip.file(integrationFileName(doc.documentNumber, cityFor(doc.clientCode), importDate), out);
        }
        const blob = await zip.generateAsync({ type: "blob" });
        const city = cityFor(chosen[0].clientCode);
        download(
          blob,
          `Fichiers intégration ${city} ${chosen.map((d) => d.documentNumber).join("-")} ${importDate}.zip`
            .replace(/\s+/g, " ")
            .trim()
        );
      }
      toast.success(`${chosen.length} fichier(s) généré(s)`);
    } catch (e) {
      toast.error("Erreur à la génération", { description: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const excluded = lines.length - docs.reduce((s, d) => s + d.rows.length, 0);
  const chosenDocs = docs.filter((d) => selected.has(d.documentNumber));
  const missingCity = chosenDocs.filter((d) => !cityFor(d.clientCode));
  const toggleDoc = (n: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  return (
    <div>
      <Topbar title="Fichier d'intégration CC" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="Fichier d'intégration CC"
          description="Transforme un export EAN / BL en fichier d'intégration client — un fichier par n° de document"
          action={
            docs.length > 0 ? (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={reset} className="gap-2">
                  <X className="h-4 w-4" />
                  Réinitialiser
                </Button>
                <Button
                  onClick={handleExport}
                  disabled={busy || chosenDocs.length === 0}
                  className="gap-2"
                >
                  <Download className="h-4 w-4" />
                  Générer{" "}
                  {chosenDocs.length > 1 ? `${chosenDocs.length} fichiers (zip)` : "le fichier"}
                </Button>
              </div>
            ) : undefined
          }
        />

        {/* Dépôt du fichier source */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50">
                <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <CardTitle className="text-base">Fichier source (EAN / BL)</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Export Texas contenant « N° Document » et « Code Produit Fini ». Seules les
                  lignes de marque <strong>{BRANDS.join(", ")}</strong> sont reprises.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <label
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors",
                busy ? "opacity-60" : "hover:bg-muted/40"
              )}
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm font-medium">
                {file ? file.name : "Choisir un fichier .xlsx"}
              </span>
              <span className="text-xs text-muted-foreground">
                {busy ? "Lecture en cours…" : "Cliquer pour sélectionner"}
              </span>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </label>
          </CardContent>
        </Card>

        {docs.length > 0 && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold">
                    {chosenDocs.length}
                    {docs.length !== chosenDocs.length && (
                      <span className="text-base font-normal text-muted-foreground">
                        {" "}
                        / {docs.length}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">Documents sélectionnés</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold">
                    {chosenDocs.reduce((s, d) => s + d.rows.length, 0)}
                  </div>
                  <p className="text-sm text-muted-foreground">Lignes retenues</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold">
                    {chosenDocs.reduce((s, d) => s + d.totalQuantity, 0)}
                  </div>
                  <p className="text-sm text-muted-foreground">Pièces</p>
                </CardContent>
              </Card>
            </div>

            {(excluded > 0 || missingCity.length > 0 || docs.length > 1) && (
              <Card className="border-amber-200 bg-amber-50/50">
                <CardContent className="space-y-1 pt-6 text-sm">
                  {docs.length > 1 && (
                    <p className="flex items-start gap-2 text-amber-800">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        Ce fichier contient <strong>{docs.length} numéros de document</strong> (
                        {docs.map((d) => `${d.documentNumber} — ${d.clientName}`).join(" · ")}). Un
                        export Texas empile parfois plusieurs BL : <strong>décochez</strong> ceux
                        que vous ne voulez pas générer.
                      </span>
                    </p>
                  )}
                  {excluded > 0 && (
                    <p className="flex items-start gap-2 text-amber-800">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        <strong>{excluded}</strong> ligne(s) écartée(s) : marque autre que{" "}
                        {BRANDS.join(", ")}.
                      </span>
                    </p>
                  )}
                  {missingCity.length > 0 && (
                    <p className="flex items-start gap-2 text-amber-800">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        Ville de livraison inconnue pour{" "}
                        <strong>{missingCity.map((d) => d.clientCode).join(", ")}</strong> — le nom
                        du fichier sera sans ville. Renseignez-la sur la fiche client (elle est
                        synchronisée depuis TIO).
                      </span>
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Un bloc par document */}
            {docs.map((doc) => {
              const city = cityFor(doc.clientCode);
              return (
                <Card
                  key={doc.documentNumber}
                  className={cn(!selected.has(doc.documentNumber) && "opacity-60")}
                >
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 cursor-pointer"
                          checked={selected.has(doc.documentNumber)}
                          onChange={() => toggleDoc(doc.documentNumber)}
                          aria-label={`Générer le document ${doc.documentNumber}`}
                        />
                        <div>
                          <CardTitle className="text-base">
                            Document {doc.documentNumber}
                            <span className="ml-2 text-sm font-normal text-muted-foreground">
                              {doc.clientName} ({doc.clientCode})
                            </span>
                          </CardTitle>
                          <p className="mt-1 font-mono text-xs text-muted-foreground">
                            {integrationFileName(doc.documentNumber, city, importDate)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {city ? (
                          <Badge variant="outline">{city}</Badge>
                        ) : (
                          <Badge variant="destructive">ville inconnue</Badge>
                        )}
                        <Badge variant="secondary">{doc.rows.length} lignes</Badge>
                        <Badge variant="secondary">{doc.totalQuantity} pcs</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {INTEGRATION_HEADERS.map((h) => (
                              <TableHead key={h} className="whitespace-nowrap">
                                {h}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {doc.rows.slice(0, 8).map((row, i) => (
                            <TableRow key={i}>
                              {INTEGRATION_HEADERS.map((h) => (
                                <TableCell key={h} className="whitespace-nowrap text-sm">
                                  {row[h] === null || row[h] === "" ? (
                                    <span className="text-muted-foreground/40">—</span>
                                  ) : (
                                    String(row[h])
                                  )}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                    {doc.rows.length > 8 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Aperçu des 8 premières lignes sur {doc.rows.length}.
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

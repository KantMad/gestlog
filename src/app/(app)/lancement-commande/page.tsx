"use client";

import { useMemo, useRef, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Rocket, Upload, Download, AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";
import { cn, formatNumber } from "@/lib/utils";
import {
  parseLancementCsv,
  buildLancementSheets,
  countByStatus,
  countPieces,
  keepValidatedOnly,
  NO_SIZE,
  type LancementCsvRow,
} from "@/lib/lancement-commande";
import { buildLancementWorkbook } from "@/lib/lancement-commande-xlsx";
import { fileStamp } from "@/lib/file-stamp";

export default function LancementCommandePage() {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<LancementCsvRow[]>([]);
  const [sizeScales, setSizeScales] = useState<Record<string, string[]>>({});
  const [validatedOnly, setValidatedOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Le filtre de statut se rejoue sur les lignes déjà lues : changer d'avis ne
  // demande pas de recharger le fichier.
  const kept = useMemo(
    () => (validatedOnly ? keepValidatedOnly(rows) : rows),
    [rows, validatedOnly]
  );
  const { sheets, warnings } = useMemo(
    () => buildLancementSheets(kept, sizeScales),
    [kept, sizeScales]
  );
  const statuses = useMemo(() => countByStatus(rows), [rows]);

  const reset = () => {
    setFile(null);
    setRows([]);
    setSizeScales({});
    setValidatedOnly(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFile = async (f: File) => {
    setFile(f);
    setBusy(true);
    try {
      const parsed = parseLancementCsv(await f.text());
      if (parsed.length === 0) {
        toast.error("Format non reconnu", {
          description:
            "Le fichier doit contenir « Référence produit », « Catégorie produit » et les colonnes T0…T11.",
        });
        reset();
        return;
      }

      // Grilles de tailles depuis le référentiel : T0 = 1re taille du produit.
      const references = [...new Set(parsed.map((r) => r.reference))];
      let scales: Record<string, string[]> = {};
      try {
        const res = await fetch("/api/lancement-commande", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ references }),
        });
        const data = await res.json();
        if (res.ok) scales = data.sizeScales || {};
      } catch {
        /* référentiel indisponible → les tailles seront nommées T0, T1… (averti) */
      }

      setSizeScales(scales);
      setRows(parsed);
      toast.success(
        `${parsed.length} lignes lues — ${formatNumber(countPieces(parsed))} pièces`
      );
    } catch (e) {
      toast.error("Impossible de lire le fichier", { description: String(e) });
      reset();
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    if (sheets.length === 0) return;
    setBusy(true);
    try {
      // exceljs (et non la lib xlsx) : seule à écrire couleurs ET formules.
      // Import dynamique → son poids ne pèse pas sur le reste de l'app.
      const ExcelJS = (await import("exceljs")).default;
      const wb = buildLancementWorkbook(ExcelJS, sheets, {
        fileName: file?.name || "—",
        generatedAt: new Date().toLocaleString("fr-FR"),
        filePieces: countPieces(kept),
        sheetPieces: totalPieces,
        unsizedPieces: unsized,
        statusFilter: validatedOnly ? "commandes validées uniquement" : "tous statuts",
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const base = (file?.name || "lancement").replace(/\.[^.]+$/, "");
      // Horodatage à la minute : deux lancements bâtis sur le même CSV ne doivent pas
      // se recouvrir dans le dossier de téléchargement.
      a.download = `Lancement de commande - ${base}_${fileStamp()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Fichier généré");
    } catch (e) {
      toast.error("Erreur à la génération", { description: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const totalPieces = sheets.reduce((s, x) => s + x.total, 0);
  const totalProducts = sheets.reduce(
    (s, x) => s + x.lines.filter((l) => l.kind === "product").length,
    0
  );
  // Pièces sans ventilation par taille, reprises de la colonne dédiée des onglets.
  const unsized = sheets.reduce(
    (s, x) =>
      s + x.lines.filter((l) => l.kind === "product").reduce((n, l) => n + (l.bySize[NO_SIZE] ?? 0), 0),
    0
  );
  const filePieces = countPieces(kept);

  return (
    <div>
      <Topbar title="Lancement de commande" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="Lancement de commande"
          description="Transforme un export « commandes à la couleur » en tableaux de lancement — un onglet par catégorie"
          action={
            sheets.length > 0 ? (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={reset} className="gap-2">
                  <X className="h-4 w-4" />
                  Réinitialiser
                </Button>
                <Button onClick={handleExport} disabled={busy} className="gap-2">
                  <Download className="h-4 w-4" />
                  Générer le fichier Excel
                </Button>
              </div>
            ) : undefined
          }
        />

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50">
                <Rocket className="h-5 w-5 text-indigo-600" />
              </div>
              <div>
                <CardTitle className="text-base">Export « commandes à la couleur »</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Fichier CSV contenant « Référence produit », « Catégorie produit » et les
                  quantités T0…T11. Les tailles sont nommées d&apos;après la grille du produit
                  dans GestLog.
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
                {file ? file.name : "Choisir un fichier .csv"}
              </span>
              <span className="text-xs text-muted-foreground">
                {busy ? "Lecture en cours…" : "Cliquer pour sélectionner"}
              </span>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
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

        {sheets.length > 0 && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardContent>
                  <div className="text-2xl font-bold">{sheets.length}</div>
                  <p className="text-sm text-muted-foreground">Onglets (catégories)</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent>
                  <div className="text-2xl font-bold">{totalProducts}</div>
                  <p className="text-sm text-muted-foreground">Produits</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent>
                  <div className="text-2xl font-bold">{formatNumber(totalPieces)}</div>
                  <p className="text-sm text-muted-foreground">Pièces commandées</p>
                </CardContent>
              </Card>
              <Card className={cn(totalPieces !== filePieces && "border-red-300 bg-red-50/60")}>
                <CardContent>
                  <div className="text-2xl font-bold">{formatNumber(filePieces)}</div>
                  <p className="text-sm text-muted-foreground">
                    Pièces dans le fichier
                    {totalPieces === filePieces ? (
                      <span className="ml-1 text-emerald-600">· total identique</span>
                    ) : (
                      <span className="ml-1 font-medium text-red-700">
                        · écart de {formatNumber(Math.abs(filePieces - totalPieces))}
                      </span>
                    )}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Contrôle : d'où viennent les pièces, et ce qu'on garde. */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Contrôle du fichier</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {statuses.map((s) => (
                    <Badge
                      key={s.status}
                      variant={s.status === "validated" ? "secondary" : "outline"}
                      className="font-normal"
                    >
                      {s.status === "validated"
                        ? "Commandes validées"
                        : s.status === "created"
                          ? "Paniers non validés (created)"
                          : s.status}{" "}
                      · {formatNumber(s.pieces)} pcs
                    </Badge>
                  ))}
                  {unsized > 0 && (
                    <Badge variant="outline" className="font-normal text-amber-700">
                      Sans taille · {formatNumber(unsized)} pcs
                    </Badge>
                  )}
                </div>

                <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">
                      Ne garder que les commandes validées
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Un panier au statut « created » n&apos;est pas figé : il peut encore
                      changer, ou disparaître d&apos;un export à l&apos;autre.
                    </p>
                  </div>
                  <Switch
                    checked={validatedOnly}
                    onCheckedChange={(v) => setValidatedOnly(Boolean(v))}
                  />
                </div>
              </CardContent>
            </Card>

            {warnings.length > 0 && (
              <Card className="border-amber-200 bg-amber-50/50">
                <CardContent className="space-y-1 text-sm">
                  {warnings.map((w, i) => (
                    <p key={i} className="flex items-start gap-2 text-amber-800">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{w}</span>
                    </p>
                  ))}
                </CardContent>
              </Card>
            )}

            {sheets.map((sheet) => (
              <Card key={sheet.category}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">{sheet.category}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{sheet.sizes.join(" · ")}</Badge>
                      <Badge variant="secondary">
                        {sheet.lines.filter((l) => l.kind === "product").length} produits
                      </Badge>
                      <Badge variant="secondary">{formatNumber(sheet.total)} pcs</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Étiquettes de lignes</TableHead>
                          {sheet.sizes.map((s) => (
                            <TableHead key={s} className="text-right whitespace-nowrap">
                              {s}
                            </TableHead>
                          ))}
                          <TableHead className="text-right">Somme de Quantity</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sheet.lines.slice(0, 12).map((line, i) => (
                          <TableRow
                            key={i}
                            className={cn(line.kind !== "color" && "font-semibold bg-muted/40")}
                          >
                            <TableCell
                              className={cn(
                                "whitespace-nowrap",
                                line.kind === "color" && "pl-8 text-muted-foreground"
                              )}
                            >
                              {line.label}
                            </TableCell>
                            {sheet.sizes.map((s) => (
                              <TableCell key={s} className="text-right tabular-nums">
                                {line.bySize[s] ? (
                                  line.bySize[s]
                                ) : (
                                  <span className="text-muted-foreground/40">—</span>
                                )}
                              </TableCell>
                            ))}
                            <TableCell className="text-right font-medium">{line.total}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                  {sheet.lines.length > 12 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Aperçu des 12 premières lignes sur {sheet.lines.length}. Les colonnes
                      site / % réa / réa / total sont dans le fichier Excel.
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

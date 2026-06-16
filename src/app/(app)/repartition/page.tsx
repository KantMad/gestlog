"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Store, Upload, Download, Loader2, FileSpreadsheet, AlertTriangle } from "lucide-react";
import { formatNumber } from "@/lib/utils";

interface ReportRow {
  supplier: string;
  sheetName: string;
  grid: string;
  lines: number;
  dropped: number;
}
interface Result {
  report: ReportRow[];
  totalLines: number;
  totalDropped: number;
  suppliers: number;
  missingRefs: string[];
  fileName: string;
  fileBase64: string;
}

export default function RepartitionPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const generate = async () => {
    if (!file) return;
    setLoading(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/repartition", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Échec de la génération");
      setResult(d);
      toast.success(`${d.suppliers} onglet(s) fournisseur générés`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  };

  const download = () => {
    if (!result) return;
    const bytes = Uint8Array.from(atob(result.fileBase64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <Topbar title="Répartition magasin" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="Répartition magasin"
          description="Importez un export commande client (TIO) — l'outil le réorganise en un classeur avec un onglet par fournisseur, tailles replacées sous les bons libellés."
        />

        <Card>
          <CardContent className="pt-6 space-y-4">
            <div
              className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-10 cursor-pointer hover:bg-muted/40 transition-colors"
              onClick={() => inputRef.current?.click()}
            >
              <FileSpreadsheet className="h-10 w-10 text-muted-foreground/60" />
              <div className="text-center">
                <p className="text-sm font-medium">{file ? file.name : "Choisir un fichier .xlsx"}</p>
                <p className="text-xs text-muted-foreground">Export commande client TIO (mono-onglet)</p>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  setFile(e.target.files?.[0] || null);
                  setResult(null);
                }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={generate} disabled={!file || loading} className="gap-2">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Générer la répartition
              </Button>
              {result && (
                <Button onClick={download} variant="outline" className="gap-2">
                  <Download className="h-4 w-4" />
                  Télécharger ({result.suppliers} onglets)
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {result && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Card><CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50"><Store className="h-5 w-5 text-blue-600" /></div>
                <div><p className="text-2xl font-bold">{formatNumber(result.suppliers)}</p><p className="text-xs text-muted-foreground">Onglets fournisseur</p></div>
              </CardContent></Card>
              <Card><CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50"><FileSpreadsheet className="h-5 w-5 text-emerald-600" /></div>
                <div><p className="text-2xl font-bold">{formatNumber(result.totalLines)}</p><p className="text-xs text-muted-foreground">Lignes réparties</p></div>
              </CardContent></Card>
              <Card className={result.totalDropped > 0 ? "border-amber-200" : ""}><CardContent className="flex items-center gap-3 p-4">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${result.totalDropped > 0 ? "bg-amber-50" : "bg-zinc-100"}`}><AlertTriangle className={`h-5 w-5 ${result.totalDropped > 0 ? "text-amber-600" : "text-zinc-400"}`} /></div>
                <div><p className={`text-2xl font-bold ${result.totalDropped > 0 ? "text-amber-600" : ""}`}>{formatNumber(result.totalDropped)}</p><p className="text-xs text-muted-foreground">Pièces hors grille</p></div>
              </CardContent></Card>
              <Card className={result.missingRefs.length > 0 ? "border-amber-200" : ""}><CardContent className="flex items-center gap-3 p-4">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${result.missingRefs.length > 0 ? "bg-amber-50" : "bg-zinc-100"}`}><AlertTriangle className={`h-5 w-5 ${result.missingRefs.length > 0 ? "text-amber-600" : "text-zinc-400"}`} /></div>
                <div><p className={`text-2xl font-bold ${result.missingRefs.length > 0 ? "text-amber-600" : ""}`}>{formatNumber(result.missingRefs.length)}</p><p className="text-xs text-muted-foreground">Réfs hors catalogue</p></div>
              </CardContent></Card>
            </div>

            {(result.totalDropped > 0 || result.missingRefs.length > 0) && (
              <Card className="border-amber-200 bg-amber-50/40">
                <CardContent className="pt-6 text-sm space-y-1">
                  {result.totalDropped > 0 && (
                    <p>⚠️ {formatNumber(result.totalDropped)} pièce(s) avaient une taille absente de la grille de leur onglet fournisseur (fournisseur multi-familles) — vérifiez les onglets concernés.</p>
                  )}
                  {result.missingRefs.length > 0 && (
                    <p>⚠️ {result.missingRefs.length} référence(s) absentes du catalogue (grille devinée par longueur) : {result.missingRefs.slice(0, 12).join(", ")}{result.missingRefs.length > 12 ? "…" : ""}</p>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Onglets générés</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Onglet (fournisseur)</TableHead>
                      <TableHead>Grille de tailles</TableHead>
                      <TableHead className="text-right">Lignes</TableHead>
                      <TableHead className="text-right">Hors grille</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.report.map((r) => (
                      <TableRow key={r.sheetName}>
                        <TableCell className="font-medium">{r.sheetName}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{r.grid || "—"}</TableCell>
                        <TableCell className="text-right">{formatNumber(r.lines)}</TableCell>
                        <TableCell className="text-right">
                          {r.dropped > 0 ? <Badge className="bg-amber-100 text-amber-700">{formatNumber(r.dropped)}</Badge> : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileSpreadsheet, Download, X, TriangleAlert, Factory } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import { fileStamp } from "@/lib/file-stamp";
import {
  parseEanOrdersCsv,
  splitEanBySupplier,
  SANS_FOURNISSEUR,
  type EanOrderRow,
  type EanSplit,
} from "@/lib/export-ean-suppliers";

// Export « commandes EAN » éclaté par fournisseur.
//
// Le fichier est lu ICI (c'est un CSV, la lecture est immédiate) ; seule la correspondance
// référence → fournisseur est demandée au serveur, qui seul connaît la base. Envoyer les
// 3 Mo du fichier pour n'en tirer qu'une liste de références serait du gaspillage.

export function EanSuppliersCard() {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<EanOrderRow[] | null>(null);
  const [suppliers, setSuppliers] = useState<Record<string, string>>({});
  const [conflicts, setConflicts] = useState<{ reference: string; suppliers: string[] }[]>([]);
  const [withPrices, setWithPrices] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFile(null);
    setRows(null);
    setSuppliers({});
    setConflicts([]);
    setWithPrices(false);
  };

  const choisir = useCallback(async (f: File) => {
    setBusy(true);
    try {
      const lues = parseEanOrdersCsv(await f.text());
      if (lues.length === 0) {
        toast.error("Format non reconnu", {
          description:
            "Le fichier doit contenir « Référence produit », « EAN » et « Quantité » — c'est l'export « commandes EAN ».",
        });
        reset();
        return;
      }
      const references = [...new Set(lues.map((r) => r.reference))];
      const res = await fetch("/api/export/supplier-by-reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ references }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Impossible de retrouver les fournisseurs");
        reset();
        return;
      }
      setFile(f);
      setRows(lues);
      setSuppliers(json.data.suppliers || {});
      setConflicts(json.data.conflicts || []);
      toast.success(`${formatNumber(lues.length)} lignes lues`);
    } catch (e) {
      toast.error("Impossible de lire le fichier", { description: String(e) });
      reset();
    } finally {
      setBusy(false);
    }
  }, []);

  const apercu: EanSplit | null = rows ? splitEanBySupplier(rows, suppliers, { withPrices }) : null;

  const exporter = () => {
    if (!apercu || !file) return;
    const wb = XLSX.utils.book_new();
    // Fournisseur / n° cmd / boutique / catalogue / réf / libellé / cat / sous-cat /
    // code coul. / couleur / type taille / taille / SKU / EAN / qté [/ prix]
    const WIDTHS = [16, 18, 26, 26, 16, 34, 16, 18, 11, 16, 11, 8, 26, 15, 9, 12];
    for (const s of apercu.sheets) {
      const ws = XLSX.utils.aoa_to_sheet([s.header, ...s.rows]);
      ws["!cols"] = s.header.map((_, i) => ({ wch: WIDTHS[i] ?? 12 }));
      ws["!freeze"] = { xSplit: 0, ySplit: 1 };
      // ⚠️ `!autofilter` sur l'en-tête : un onglet de plusieurs milliers de lignes se lit
      // en filtrant, pas en défilant.
      ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: s.rows.length, c: s.header.length - 1 } }) };
      XLSX.utils.book_append_sheet(wb, ws, s.sheetName);
    }
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        { Critère: "Fichier source", Valeur: file.name },
        { Critère: "Lignes", Valeur: apercu.lines },
        { Critère: "Pièces", Valeur: apercu.pieces },
        { Critère: "Fournisseurs", Valeur: apercu.supplierCount },
        { Critère: "Références sans fournisseur", Valeur: apercu.unknownReferences.length },
        { Critère: "Prix inclus", Valeur: withPrices ? "Oui" : "Non" },
        {
          Critère: "Données personnelles",
          Valeur: "Écartées (client, responsable commercial, adresses de facturation)",
        },
        {
          Critère: "Origine du fournisseur",
          Valeur: "Correspondances importées, à défaut commandes fournisseurs",
        },
      ]),
      "Critères"
    );
    XLSX.writeFile(wb, `commandes-par-fournisseur_${fileStamp()}.xlsx`);
    toast.success(`${apercu.supplierCount} onglet(s) fournisseur — ${formatNumber(apercu.pieces)} pièces`);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50">
            <Factory className="h-5 w-5 text-teal-600" />
          </div>
          <div>
            <CardTitle className="text-base">Commandes par fournisseur</CardTitle>
            <p className="text-sm text-muted-foreground">
              Dépose l&apos;export « commandes EAN » : un onglet par fournisseur, une ligne par
              taille avec son EAN. Le fournisseur vient de la base.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!apercu ? (
          <label
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors",
              busy ? "opacity-60" : "hover:bg-muted/40"
            )}
          >
            <FileSpreadsheet className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm font-medium">{file ? file.name : "Choisir un fichier .csv"}</span>
            <span className="text-xs text-muted-foreground">
              {busy ? "Lecture et recherche des fournisseurs…" : "Export « commandes EAN » de TIO"}
            </span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) choisir(f);
              }}
            />
          </label>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Chiffre valeur={apercu.supplierCount} legende="fournisseurs" />
              <Chiffre valeur={apercu.lines} legende="lignes" />
              <Chiffre valeur={apercu.pieces} legende="pièces" />
              <Chiffre valeur={apercu.unknownReferences.length} legende="réfs sans fournisseur" />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {apercu.sheets.map((s) => (
                <Badge
                  key={s.supplier}
                  variant={s.supplier === SANS_FOURNISSEUR ? "outline" : "secondary"}
                  className={cn("font-normal", s.supplier === SANS_FOURNISSEUR && "text-amber-700")}
                >
                  {s.supplier} · {formatNumber(s.pieces)} pcs · {s.references} réf.
                </Badge>
              ))}
            </div>

            {apercu.unknownReferences.length > 0 && (
              <Alerte>
                <strong>
                  {apercu.unknownReferences.length} référence(s) sans fournisseur connu
                </strong>{" "}
                : {apercu.unknownReferences.slice(0, 8).join(", ")}
                {apercu.unknownReferences.length > 8 && "…"}. Elles vont dans l&apos;onglet
                « {SANS_FOURNISSEUR} », jamais écartées. Pour les rattacher : Infos produits →
                Fournisseur → Réf.
              </Alerte>
            )}

            {conflicts.length > 0 && (
              <Alerte>
                <strong>{conflicts.length} référence(s) chez plusieurs fournisseurs</strong> :{" "}
                {conflicts.slice(0, 5).map((c) => `${c.reference} (${c.suppliers.join(" + ")})`).join(" · ")}
                . Un seul onglet les reçoit — les recopier doublerait les quantités.
              </Alerte>
            )}

            {/* ⚠️ Le prix à la variation est celui payé par la BOUTIQUE : hors du classeur
                par défaut, un fournisseur n'a pas à le connaître. */}
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm hover:bg-muted/40">
              <input
                type="checkbox"
                checked={withPrices}
                onChange={(e) => setWithPrices(e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                <span className="font-medium">Inclure le prix à la variation</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Décoché : le prix reste hors du classeur. C&apos;est le prix payé par la
                  boutique — un fournisseur n&apos;a pas à le connaître.
                </span>
              </span>
            </label>

            <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              Les colonnes <strong>nominatives</strong> du fichier — nom, prénom, genre et
              e-mail du client, ceux du responsable commercial, adresses de facturation — ne
              sont <strong>pas</strong> reprises. Le classeur garde la boutique, le produit, la
              taille, le SKU, l&apos;EAN et la quantité.
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={exporter} className="gap-2">
                <Download className="h-4 w-4" />
                Générer le fichier Excel
              </Button>
              <Button variant="ghost" size="sm" onClick={reset} className="gap-2">
                <X className="h-4 w-4" />
                Changer de fichier
              </Button>
            </div>
          </>
        )}
        {busy && apercu && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </CardContent>
    </Card>
  );
}

function Chiffre({ valeur, legende }: { valeur: number; legende: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xl font-bold tabular-nums">{formatNumber(valeur)}</div>
      <p className="text-xs text-muted-foreground">{legende}</p>
    </div>
  );
}

function Alerte({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

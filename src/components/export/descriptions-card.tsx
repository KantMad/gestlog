"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, FileSpreadsheet, Download, X, TriangleAlert, FileText } from "lucide-react";
import { cn, formatNumber, formatEuro } from "@/lib/utils";
import { fileStamp } from "@/lib/file-stamp";
import {
  parseTioCsv,
  enrichTioCsv,
  COLONNE_DESCRIPTION,
  COLONNE_MONTANT,
  type TioCsv,
} from "@/lib/export-tio-descriptions";

// Enrichissement d'un export TIO avec le descriptif produit.
//
// Le fichier ne quitte PAS le navigateur : seules les références distinctes (79 sur
// l'export du 28/09/2026, contre 6 763 lignes) partent au serveur. Ce fichier porte des
// données nominatives — nom, e-mail et adresse des clients : les faire voyager pour n'en
// tirer qu'une colonne de descriptifs n'aurait aucune raison d'être.

export function DescriptionsCard() {
  const [file, setFile] = useState<File | null>(null);
  const [csv, setCsv] = useState<TioCsv | null>(null);
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFile(null);
    setCsv(null);
    setDescriptions({});
  };

  const choisir = useCallback(async (f: File) => {
    setBusy(true);
    try {
      const lu = parseTioCsv(await f.text());
      if (lu.rows.length === 0) {
        toast.error("Fichier vide ou illisible", {
          description: "Attendu : un export TIO au format CSV, avec sa ligne d'en-tête.",
        });
        reset();
        return;
      }
      if (lu.refIndex < 0) {
        toast.error("Colonne « Référence produit » introuvable", {
          description: "Sans référence produit, impossible d'aller chercher le descriptif.",
        });
        reset();
        return;
      }
      const references = [
        ...new Set(lu.rows.map((r) => String(r[lu.refIndex] ?? "").trim()).filter(Boolean)),
      ];
      const res = await fetch("/api/export/description-by-reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ references }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Impossible de retrouver les descriptifs");
        reset();
        return;
      }
      setFile(f);
      setCsv(lu);
      setDescriptions(json.data.descriptions || {});
      toast.success(`${formatNumber(lu.rows.length)} lignes lues · ${references.length} références`);
    } catch (e) {
      toast.error("Impossible de lire le fichier", { description: String(e) });
      reset();
    } finally {
      setBusy(false);
    }
  }, []);

  const apercu = csv ? enrichTioCsv(csv, { descriptionByReference: descriptions }) : null;

  const exporter = () => {
    if (!apercu || !file) return;
    const ws = XLSX.utils.aoa_to_sheet([apercu.header, ...apercu.rows]);
    ws["!cols"] = apercu.header.map((h: string, i: number) => ({
      wch: i === apercu.descriptionAt ? 60 : Math.min(Math.max(h.length + 2, 12), 30),
    }));
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: apercu.rows.length, c: apercu.header.length - 1 },
      }),
    };
    // La colonne Montant est NUMÉRIQUE (cf. lib) : on lui pose un format monétaire pour
    // qu'Excel l'additionne et l'affiche en euros plutôt qu'en « 20.8 ».
    if (apercu.amountAt >= 0) {
      for (let r = 1; r <= apercu.rows.length; r++) {
        const adr = XLSX.utils.encode_cell({ r, c: apercu.amountAt });
        if (ws[adr]) ws[adr].z = '#,##0.00\\ "€"';
      }
    }
    // ⚠️ Pas de retour à la ligne automatique : `xlsx` (build communautaire) n'ÉCRIT PAS
    // les styles de cellule — un `ws[adr].s = { alignment: … }` serait du code mort. Le
    // descriptif (jusqu'à 1 095 caractères, sur plusieurs lignes) est donc simplement posé
    // dans une colonne large ; Excel l'affiche entier dès qu'on coche « Renvoyer à la ligne ».
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Commandes");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        { Critère: "Fichier source", Valeur: file.name },
        { Critère: "Lignes", Valeur: apercu.rows.length },
        { Critère: "Références distinctes", Valeur: apercu.references.length },
        { Critère: "Lignes avec descriptif", Valeur: apercu.withDescription },
        { Critère: "Références sans descriptif", Valeur: apercu.unknownReferences.length },
        { Critère: "Pièces", Valeur: apercu.pieces },
        { Critère: "Montant total", Valeur: apercu.total },
        { Critère: "Calcul du montant", Valeur: "Prix à la variation × Quantité (brut, hors réduction)" },
        { Critère: "Lignes sans prix", Valeur: apercu.linesWithoutPrice },
        { Critère: "Lignes avec réduction", Valeur: apercu.linesWithDiscount },
        { Critère: "Colonnes ajoutées", Valeur: [COLONNE_DESCRIPTION, COLONNE_MONTANT].join(" + ") },
        { Critère: "Source du descriptif", Valeur: "Référentiel GestLog (synchro TIO)" },
      ]),
      "Critères"
    );
    XLSX.writeFile(wb, `commandes-avec-descriptions_${fileStamp()}.xlsx`, { compression: true });
    toast.success(
      `${formatNumber(apercu.withDescription)} lignes enrichies · ${formatEuro(apercu.total)}`
    );
  };

  const manquantes = apercu?.unknownReferences ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50">
            <FileText className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <CardTitle className="text-base">Commandes clients + descriptif et montant</CardTitle>
            <p className="text-sm text-muted-foreground">
              Dépose un export TIO : tu le récupères <strong>à l&apos;identique</strong>, avec le{" "}
              <em>{COLONNE_DESCRIPTION}</em> et le <em>{COLONNE_MONTANT}</em> de chaque ligne
              (prix à la variation × quantité) en plus.
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
              {busy ? "Lecture et recherche des descriptifs…" : "Export TIO (commandes EAN, commandes à la couleur…)"}
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
              <Chiffre valeur={apercu.rows.length} legende="lignes" />
              <Chiffre valeur={apercu.pieces} legende="pièces" />
              <Chiffre valeur={apercu.withDescription} legende="lignes avec descriptif" />
              <Chiffre valeur={manquantes.length} legende="réfs sans descriptif" />
            </div>

            {apercu.amountAt >= 0 && (
              <div className="rounded-lg border bg-emerald-50 p-3">
                <div className="text-2xl font-bold tabular-nums text-emerald-900">
                  {formatEuro(apercu.total)}
                </div>
                <p className="text-xs text-emerald-800">
                  montant total — somme de la colonne <strong>{COLONNE_MONTANT}</strong> (prix à
                  la variation × quantité) sur {formatNumber(apercu.references.length)} références
                </p>
              </div>
            )}

            <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              Le fichier est rendu <strong>tel quel</strong> — ses colonnes d&apos;origine, dans
              leur ordre. <strong>{COLONNE_DESCRIPTION}</strong> s&apos;insère après{" "}
              <em>{apercu.descriptionAt > 0 ? apercu.header[apercu.descriptionAt - 1] : "la dernière colonne"}</em>
              {apercu.amountAt >= 0 && (
                <>
                  , et <strong>{COLONNE_MONTANT}</strong> après{" "}
                  <em>{apercu.header[apercu.amountAt - 1]}</em>
                </>
              )}
              .
            </div>

            {manquantes.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <strong>{manquantes.length} référence(s) sans descriptif</strong> :{" "}
                  {manquantes.slice(0, 8).join(", ")}
                  {manquantes.length > 8 && "…"}. Leur cellule reste <strong>vide</strong> — la
                  ligne n&apos;est jamais retirée. Le descriptif vient de TIO : s&apos;il y est
                  renseigné, il arrivera à la prochaine synchro produits (5 h 05).
                </span>
              </div>
            )}

            {apercu.amountAt < 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <strong>Pas de colonne {COLONNE_MONTANT}</strong> : ce fichier ne porte pas à la
                  fois « Prix à la variation » et « Quantité ». Une colonne de zéros aurait l&apos;air
                  d&apos;un chiffre d&apos;affaires nul — elle n&apos;est donc pas ajoutée.
                </span>
              </div>
            )}

            {apercu.linesWithoutPrice > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <strong>{formatNumber(apercu.linesWithoutPrice)} ligne(s) sans prix</strong> alors
                  qu&apos;elles portent une quantité : leur montant vaut <strong>0</strong>, et le
                  total ci-dessus est donc <strong>sous-estimé</strong>.
                </span>
              </div>
            )}

            {apercu.linesWithDiscount > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <strong>{formatNumber(apercu.linesWithDiscount)} ligne(s) avec une réduction</strong>{" "}
                  à la variation. Le montant est le <strong>brut</strong> (prix × quantité) : il ne
                  la déduit pas.
                </span>
              </div>
            )}

            {apercu.withDescription > 0 && (
              <div className="rounded-lg border p-3">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Aperçu</p>
                <p className="line-clamp-4 whitespace-pre-line text-sm">
                  {apercu.rows.find((r) => r[apercu.descriptionAt])?.[apercu.descriptionAt]}
                </p>
              </div>
            )}

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

"use client";

import { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, Grid3x3, Loader2, Plus, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { fileStamp } from "@/lib/file-stamp";
import {
  parseColorOrdersCsv, parseLancementWorkbook, filterRows, buildCrossTable, crossTableToAoa,
  findOverlap, mergeSources,
  type ColorOrderRow, type SheetGrids, type SubtotalMismatch,
} from "@/lib/recoupement";

/** Un fichier chargé dans la carte. Le tableau est le CUMUL de tous. */
interface LoadedFile {
  id: string;
  name: string;
  /** Format reconnu + colonne de quantité retenue. */
  source: string;
  rows: ColorOrderRow[];
  mismatches: SubtotalMismatch[];
}

/** Sélecteur multiple compact (catégories / sous-catégories). */
function Chips({
  label, options, selected, onToggle, onClear,
}: {
  label: string;
  options: { value: string; count: number }[];
  selected: string[];
  onToggle: (v: string) => void;
  onClear: () => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            tout décocher
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onToggle(o.value)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                on ? "border-teal-500 bg-teal-500 text-white" : "hover:bg-accent"
              )}
            >
              {o.value}
              <span className={cn("ml-1 font-normal", on ? "text-white/70" : "text-muted-foreground")}>
                {o.count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function RecoupementCard() {
  // Plusieurs fichiers cumulables : le tableau est construit sur leurs lignes réunies.
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [subCategories, setSubCategories] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [reading, setReading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const readFile = async (file: File) => {
    setReading(true);
    try {
      // Deux formats acceptés, reconnus à l'extension : l'export CSV « commandes à la
      // couleur » et le classeur « Lancement de commande » (un onglet par catégorie).
      const isCsv = /\.csv$/i.test(file.name);
      let parsed: ColorOrderRow[] = [];
      let issues: SubtotalMismatch[] = [];
      let label = "";

      if (isCsv) {
        parsed = parseColorOrdersCsv(await file.text());
        label = "Export commandes à la couleur (CSV)";
      } else {
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const sheets: SheetGrids = {};
        for (const name of wb.SheetNames) {
          sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], {
            header: 1,
            raw: true,
            defval: null,
          });
        }
        const res = parseLancementWorkbook(sheets);
        parsed = res.rows;
        issues = res.mismatches;
        // On DIT quelle colonne a été lue : « commandé » et « total » ne donnent pas du
        // tout les mêmes volumes, et le fichier porte les deux.
        label = `Lancement de commande — ${wb.SheetNames.length} onglet(s) · colonne « ${res.quantityColumn} »`;
      }

      if (parsed.length === 0) {
        toast.error(
          isCsv
            ? "Aucune ligne exploitable — le CSV doit contenir « Référence produit », « Code couleur » et « Quantité à la couleur »."
            : "Aucune ligne exploitable — chaque onglet doit porter une colonne « Somme de Quantity » et des lignes produit puis coloris."
        );
        return;
      }

      setFiles((prev) => [
        ...prev,
        {
          id: `${file.name}-${Date.now()}`,
          name: file.name,
          source: label,
          rows: parsed,
          mismatches: issues,
        },
      ]);
      // Les filtres portent sur le cumul : un fichier ajouté peut apporter des catégories
      // que la sélection en cours exclurait sans qu'on s'en rende compte.
      setCategories([]);
      setSubCategories([]);
      setSearch("");
      toast.success(
        `${file.name} — ${parsed.length} ligne(s), ${parsed.reduce((s, r) => s + r.quantity, 0)} pièces`
      );
    } catch {
      toast.error("Impossible de lire le fichier");
    } finally {
      setReading(false);
    }
  };

  const rows = useMemo(() => mergeSources(files), [files]);
  const mismatches = useMemo(() => files.flatMap((f) => f.mismatches), [files]);
  // Références présentes dans plusieurs fichiers : le cumul les additionnerait.
  const overlap = useMemo(() => findOverlap(files), [files]);

  // Facettes : proposées d'après le CONTENU du fichier, avec le nombre de pièces —
  // c'est ce volume qui aide à choisir, pas le nombre de lignes.
  const catOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.category) m.set(r.category, (m.get(r.category) ?? 0) + r.quantity);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
  }, [rows]);

  // Les sous-catégories suivent les catégories cochées : sinon on propose des options
  // qui ne peuvent rien donner.
  const subOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of filterRows(rows, { categories })) {
      if (r.subCategory) m.set(r.subCategory, (m.get(r.subCategory) ?? 0) + r.quantity);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
  }, [rows, categories]);

  const table = useMemo(
    () => buildCrossTable(filterRows(rows, { categories, subCategories, search })),
    [rows, categories, subCategories, search]
  );

  const toggle = (list: string[], set: (v: string[]) => void) => (v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const scope = [
    // Le fichier exporté doit dire d'OÙ il vient : un cumul de deux sources ne se relit
    // pas si on ne sait plus lesquelles.
    files.length > 1
      ? `Cumul de ${files.length} fichiers : ${files.map((f) => f.name).join(" + ")}`
      : files[0]
        ? `Source : ${files[0].name}`
        : null,
    categories.length > 0 ? `Catégories : ${categories.join(", ")}` : null,
    subCategories.length > 0 ? `Sous-catégories : ${subCategories.join(", ")}` : null,
    search.trim() ? `Recherche : ${search.trim()}` : null,
  ].filter(Boolean).join(" · ");

  const exportExcel = () => {
    if (table.rows.length === 0) return;
    const aoa = crossTableToAoa(table, {
      title: "Recoupement modèles couleurs",
      subtitle: scope || "Toutes catégories",
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Réf + description | MARQUES | une par couleur | Total Modèle | Commentaires
    ws["!cols"] = [
      { wch: 52 },
      { wch: 10 },
      ...table.columns.map(() => ({ wch: 15 })),
      { wch: 14 },
      { wch: 40 },
    ];
    // Volet figé sous l'en-tête (ligne 4) et après la marque : le tableau est large.
    ws["!freeze"] = { xSplit: 2, ySplit: 4 };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Recoupement");
    XLSX.writeFile(wb, `recoupement-modele-couleurs_${fileStamp()}.xlsx`);
    toast.success(`${table.rows.length} modèle(s) × ${table.columns.length} couleur(s)`);
  };

  const removeFile = (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id));

  const reset = () => {
    setFiles([]);
    setCategories([]);
    setSubCategories([]);
    setSearch("");
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Grid3x3 className="h-4 w-4 text-teal-600" />
          Recoupement modèle × couleurs
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Dépose l&apos;export <strong>commandes à la couleur</strong> (CSV) ou un classeur{" "}
          <strong>Lancement de commande</strong> (xlsx, un onglet par catégorie) : GestLog le
          transforme en <strong>tableau croisé</strong> — une ligne par modèle, une colonne
          par couleur, avec le total par modèle et par couleur. Filtrable par catégorie ou
          par produit. Tu peux en déposer <strong>plusieurs</strong> : le tableau est alors
          leur <strong>cumul</strong>.
        </p>

        {files.length === 0 ? (
          <label
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 transition-colors hover:bg-muted/40",
              reading && "pointer-events-none opacity-60"
            )}
          >
            {reading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <Upload className="h-5 w-5 text-muted-foreground" />
            )}
            <span className="text-sm font-medium">Choisir un fichier</span>
            <span className="text-xs text-muted-foreground">
              CSV « commandes à la couleur » ou xlsx « Lancement de commande »
            </span>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) readFile(f);
              }}
            />
          </label>
        ) : (
          <>
            <div className="space-y-1.5">
              {files.map((f) => (
                <div
                  key={f.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border bg-muted/40 px-3 py-2 text-sm"
                >
                  <span className="font-medium">{f.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {f.source} · {f.rows.length} lignes ·{" "}
                    {f.rows.reduce((s, r) => s + r.quantity, 0)} pièces
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(f.id)}
                    className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    aria-label={`Retirer ${f.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                    Retirer
                  </button>
                </div>
              ))}

              <div className="flex flex-wrap items-center gap-3">
                <label
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent",
                    reading && "pointer-events-none opacity-60"
                  )}
                >
                  {reading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  Ajouter un fichier
                  <input
                    type="file"
                    accept=".csv,text/csv,.xlsx,.xls"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) readFile(f);
                      // Permet de redéposer le MÊME fichier après l'avoir retiré.
                      e.target.value = "";
                    }}
                  />
                </label>
                {files.length > 1 && (
                  <span className="text-xs text-muted-foreground">
                    Cumul de {files.length} fichiers ·{" "}
                    {rows.reduce((s, r) => s + r.quantity, 0)} pièces
                  </span>
                )}
                <button
                  type="button"
                  onClick={reset}
                  className="ml-auto text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  Tout effacer
                </button>
              </div>
            </div>

            {/* ⚠️ Le cumul ADDITIONNE : deux fichiers décrivant la même commande
                doubleraient tout. On ne bloque pas (cumuler deux lots est légitime) mais
                on le dit — c'est le seul moyen de distinguer un cumul voulu d'un doublon. */}
            {overlap.references.length > 0 && (
              <div className="space-y-1 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-900">
                <p className="font-medium">
                  {overlap.references.length} référence(s) présente(s) dans plusieurs
                  fichiers — leurs quantités sont ADDITIONNÉES
                </p>
                <p>
                  Cela représente <strong>{overlap.pieces}</strong> pièces. Si les deux
                  fichiers décrivent la <strong>même commande</strong>, le tableau la compte
                  deux fois : retire l&apos;un des deux.
                </p>
                <p className="font-mono">
                  {overlap.references.slice(0, 8).join(", ")}
                  {overlap.references.length > 8 ? ` … +${overlap.references.length - 8}` : ""}
                </p>
              </div>
            )}

            {/* ⚠️ Le fichier peut se contredire lui-même : on le DIT, on ne rattrape rien
                en silence. Les coloris sont conservés tels quels. */}
            {mismatches.length > 0 && (
              <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-medium">
                  {mismatches.length} produit(s) dont le sous-total ne correspond pas à ses
                  coloris
                </p>
                {mismatches.slice(0, 5).map((m) => (
                  <p key={`${m.category}-${m.reference}`}>
                    <span className="font-mono">{m.reference}</span> {m.productName} —
                    sous-total <strong>{m.subtotal}</strong>, somme des coloris{" "}
                    <strong>{m.colorsTotal}</strong> (écart {m.colorsTotal - m.subtotal})
                  </p>
                ))}
                {mismatches.length > 5 && <p>… et {mismatches.length - 5} autre(s).</p>}
                <p className="pt-0.5">
                  Écart constaté sur les quantités <strong>commandées</strong> — le tableau,
                  lui, reprend la colonne <strong>total</strong> du fichier. À vérifier dans
                  le fichier d&apos;origine.
                </p>
              </div>
            )}

            <Chips
              label="Catégories"
              options={catOptions}
              selected={categories}
              onToggle={(v) => {
                toggle(categories, setCategories)(v);
                setSubCategories([]);
              }}
              onClear={() => {
                setCategories([]);
                setSubCategories([]);
              }}
            />
            <Chips
              label="Sous-catégories"
              options={subOptions}
              selected={subCategories}
              onToggle={toggle(subCategories, setSubCategories)}
              onClear={() => setSubCategories([])}
            />

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Produit <span className="font-normal">(référence ou désignation)</span>
              </label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ex. SMPTCH, chino, bermuda…"
                className="h-9"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t pt-3">
              <span className="text-sm">
                <strong>{table.rows.length}</strong> modèle{table.rows.length > 1 ? "s" : ""} ×{" "}
                <strong>{table.columns.length}</strong> couleur
                {table.columns.length > 1 ? "s" : ""}
                <span className="text-muted-foreground"> · {table.grandTotal} pièces</span>
              </span>
              <Button
                onClick={exportExcel}
                disabled={table.rows.length === 0}
                className="ml-auto h-9 gap-2"
              >
                <Download className="h-4 w-4" />
                Exporter le tableau
              </Button>
            </div>

            {table.rows.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  Aperçu — {Math.min(8, table.rows.length)} premiers modèles,{" "}
                  {Math.min(6, table.columns.length)} premières couleurs
                </p>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Modèle</th>
                        {table.columns.slice(0, 6).map((c) => (
                          <th key={c.code} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                            {c.label}
                          </th>
                        ))}
                        <th className="px-3 py-2 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.slice(0, 8).map((r) => (
                        <tr key={r.reference} className="border-t">
                          <td className="px-3 py-1.5">{r.label}</td>
                          {table.columns.slice(0, 6).map((c) => (
                            <td key={c.code} className="px-3 py-1.5 text-right">
                              {r.cells[c.code] ?? ""}
                            </td>
                          ))}
                          <td className="px-3 py-1.5 text-right font-medium">{r.total}</td>
                        </tr>
                      ))}
                      <tr className="border-t bg-muted/30 font-medium">
                        <td className="px-3 py-1.5">Total Couleurs</td>
                        {table.columns.slice(0, 6).map((c) => (
                          <td key={c.code} className="px-3 py-1.5 text-right">
                            {c.total}
                          </td>
                        ))}
                        <td className="px-3 py-1.5 text-right">{table.grandTotal}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  L&apos;aperçu est tronqué ; le fichier exporté contient{" "}
                  <strong>toutes</strong> les lignes et toutes les colonnes.
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

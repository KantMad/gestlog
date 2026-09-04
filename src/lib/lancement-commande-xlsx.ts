import type ExcelJS from "exceljs";
import { safeSheetName, type LancementSheet } from "./lancement-commande";

// ─── Génération du classeur « lancement de commande » ────────────────────────
// Reproduit la mise en forme du modèle fourni par le service achat :
//
//   A  | commandé (n tailles) + Somme | site (n) + Somme | % réa (n) | réa (n) + Somme | total (n) + Somme
//   bleu ─────────────────────────────  jaune ──────────  bleu ────────────────────────  orange ──── vert
//
// Formules (identiques au modèle) :
//   % réa   = quantité de la taille / total commandé de la ligne
//   réa     = ARRONDI.SUP((total × 10 %) × % réa ; 0,5)
//   total   = commandé + site + réa          (par taille)
//   Sommes  = SOMME() sur les tailles de la ligne
//
// Seules les lignes COULEUR portent des formules : c'est à ce niveau que le service
// achat travaille. Les lignes catégorie/produit sont des totaux en gras.
//
// La lib `exceljs` est passée en paramètre (et non importée) pour que l'écran puisse
// la charger dynamiquement — elle est lourde et n'a pas à peser sur le reste de l'app.

export const LC_COLORS = {
  bleu: "FF4472C4", // accent1 — en-têtes commandé / % réa / réa
  orange: "FFFFC000", // accent4 — colonnes « total »
  jaune: "FFFFFF00", // colonnes « site » (saisie manuelle)
  vert: "FF92D050", // « total Somme de Quantity »
  cyan: "FF00B0F0", // cellules « % réa »
} as const;

/** Position des blocs de colonnes pour `n` tailles (1-indexé, comme Excel). */
export function lancementLayout(n: number) {
  const qty = 2; // B
  const qtyTotal = qty + n;
  const site = qtyTotal + 1;
  const siteTotal = site + n;
  const pct = siteTotal + 1;
  const rea = pct + n;
  const reaTotal = rea + n;
  const total = reaTotal + 1;
  const totalTotal = total + n;
  return { qty, qtyTotal, site, siteTotal, pct, rea, reaTotal, total, totalTotal };
}

/** En-têtes de colonnes, dans l'ordre exact du modèle. */
export function lancementHeader(sizes: string[]): string[] {
  const h = ["Étiquettes de lignes"];
  sizes.forEach((s) => h.push(s));
  h.push("Somme de Quantity");
  sizes.forEach((s) => h.push(`site ${s}`));
  h.push("site Somme de Quantity");
  sizes.forEach((s) => h.push(`% réa ${s}`));
  sizes.forEach((s) => h.push(`rea ${s}`));
  h.push("rea Somme de Quantity");
  sizes.forEach((s) => h.push(`total ${s}`));
  h.push("total Somme de Quantity");
  return h;
}

/** Lettre(s) de colonne Excel : 1 → A, 27 → AA. */
export function colLetter(index: number): string {
  let n = index;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * Traçabilité du classeur : d'où viennent les chiffres.
 *
 * ⚠️ Deux exports TIO pris à quelques heures d'intervalle ne donnent PAS le même
 * lancement (un panier non validé peut disparaître). Sans cette feuille, un classeur
 * ouvert la semaine suivante ne dit plus sur quel extrait il a été bâti.
 */
export interface LancementSource {
  /** Nom du fichier CSV chargé. */
  fileName: string;
  /** Date et heure de génération, déjà mise en forme. */
  generatedAt: string;
  /** Pièces du fichier (quantité à la couleur). */
  filePieces: number;
  /** Pièces reprises dans les onglets. */
  sheetPieces: number;
  /** Dont pièces sans ventilation par taille. */
  unsizedPieces: number;
  /** Filtre de statut appliqué, en clair. */
  statusFilter: string;
}

export function buildLancementWorkbook(
  ExcelJSLib: typeof ExcelJS,
  sheets: LancementSheet[],
  source?: LancementSource
): ExcelJS.Workbook {
  const wb = new ExcelJSLib.Workbook();
  wb.creator = "GestLog";
  const taken = new Set<string>();

  for (const sheet of sheets) {
    const ws = wb.addWorksheet(safeSheetName(sheet.category, taken));
    const n = sheet.sizes.length;
    const L = lancementLayout(n);

    const fill = (row: number, col: number, argb: string) => {
      ws.getCell(row, col).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    };

    ws.addRow(lancementHeader(sheet.sizes));
    ws.getRow(1).font = { bold: true };
    for (let c = 1; c <= L.qtyTotal; c++) fill(1, c, LC_COLORS.bleu);
    for (let c = L.site; c <= L.siteTotal; c++) fill(1, c, LC_COLORS.jaune);
    for (let c = L.pct; c <= L.reaTotal; c++) fill(1, c, LC_COLORS.bleu);
    for (let c = L.total; c < L.totalTotal; c++) fill(1, c, LC_COLORS.orange);
    fill(1, L.totalTotal, LC_COLORS.vert);

    for (const line of sheet.lines) {
      const r = ws.rowCount + 1;
      ws.getCell(r, 1).value = line.label;
      sheet.sizes.forEach((s, i) => {
        ws.getCell(r, L.qty + i).value = line.bySize[s] ?? 0;
      });
      ws.getCell(r, L.qtyTotal).value = line.total;

      if (line.kind !== "color") {
        ws.getRow(r).font = { bold: true };
        for (let c = L.site; c <= L.siteTotal; c++) fill(r, c, LC_COLORS.jaune);
        continue;
      }

      const qtyTotAbs = `$${colLetter(L.qtyTotal)}${r}`;
      for (let i = 0; i < n; i++) {
        fill(r, L.site + i, LC_COLORS.jaune); // site : vide, saisie manuelle

        const pct = ws.getCell(r, L.pct + i);
        pct.value = { formula: `${colLetter(L.qty + i)}${r}/${qtyTotAbs}` };
        pct.numFmt = "0%";
        fill(r, L.pct + i, LC_COLORS.cyan);

        ws.getCell(r, L.rea + i).value = {
          formula: `ROUNDUP((${qtyTotAbs}*0.1)*${colLetter(L.pct + i)}${r},0.5)`,
        };

        ws.getCell(r, L.total + i).value = {
          formula: `SUM(${colLetter(L.qty + i)}${r}+${colLetter(L.site + i)}${r}+${colLetter(L.rea + i)}${r})`,
        };
        fill(r, L.total + i, LC_COLORS.orange);
      }
      fill(r, L.siteTotal, LC_COLORS.jaune);
      ws.getCell(r, L.reaTotal).value = {
        formula: `SUM(${colLetter(L.rea)}${r}:${colLetter(L.reaTotal - 1)}${r})`,
      };
      ws.getCell(r, L.totalTotal).value = {
        formula: `SUM(${colLetter(L.total)}${r}:${colLetter(L.totalTotal - 1)}${r})`,
      };
    }

    ws.getColumn(1).width = 52;
    for (let c = 2; c <= L.totalTotal; c++) ws.getColumn(c).width = 11;
    ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  }

  // Feuille de traçabilité, en dernier. Elle ne porte pas les colonnes de quantité :
  // la relecture du classeur (écran Recoupement) l'ignore donc d'elle-même.
  if (source) {
    const ws = wb.addWorksheet(safeSheetName("Source", taken));
    const lines: [string, string | number][] = [
      ["Fichier source", source.fileName],
      ["Généré le", source.generatedAt],
      ["Commandes retenues", source.statusFilter],
      ["Pièces du fichier", source.filePieces],
      ["Pièces dans le lancement", source.sheetPieces],
      ["dont sans ventilation par taille", source.unsizedPieces],
    ];
    for (const [label, value] of lines) {
      const row = ws.addRow([label, value]);
      row.getCell(1).font = { bold: true };
    }
    ws.getColumn(1).width = 34;
    ws.getColumn(2).width = 60;
  }

  return wb;
}

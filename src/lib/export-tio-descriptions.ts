// Enrichissement d'un export TIO avec le DESCRIPTIF produit.
//
// Le fichier déposé (export « commandes EAN », export « commandes à la couleur »…) est
// rendu TEL QUEL — toutes ses colonnes, dans leur ordre, sans rien retirer — avec UNE
// colonne de plus : « Description produit », prise dans le référentiel GestLog
// (`Product.description`, alimenté depuis TIO `lng_product.description_fr`).
//
// 🔴 POURQUOI NE PAS SE FIER À L'ORDRE DES COLONNES. Le même export TIO porte la colonne
// « Référence produit » DEUX FOIS (positions 19 et 25 sur l'export du 28/09/2026), et
// l'ordre change d'un export à l'autre. Tout est donc repéré PAR NOM, et la première
// occurrence l'emporte.
//
// ⚠️ Le descriptif TIO contient du HTML léger : `<br />`, `<strong>`, parfois des listes.
// *Mesuré : 2 650 des 3 235 descriptifs en contiennent.* Recopié brut dans une cellule,
// il donnerait « Pull lambswool<br />Jauge 7<br /> ». On l'aplatit donc à la lecture,
// en préservant les sauts de ligne — la base, elle, garde la source intacte.

import { splitCsvLine } from "@/lib/export-ean-suppliers";

export const COLONNE_DESCRIPTION = "Description produit";

const norm = (s: string) =>
  String(s ?? "").replace(/^﻿/, "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const ENTITES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", ccedil: "ç",
  ocirc: "ô", ugrave: "ù", icirc: "î", euro: "€", deg: "°",
};

/** Aplatit le HTML léger des descriptifs TIO en texte lisible dans une cellule Excel. */
export function flattenDescription(html: string): string {
  if (!html) return "";
  return String(html)
    .replace(/\r\n?/g, "\n")
    // 🔴 TIO écrit « <br />\n » : la balise ET un vrai saut de ligne. Traités séparément,
    // CHAQUE ligne du descriptif se retrouvait suivie d'une ligne vide. On absorbe donc le
    // saut qui suit la balise — deux <br /> d'affilée gardent leur ligne vide voulue.
    .replace(/<\s*br\s*\/?\s*>[ \t]*\n?/gi, "\n")
    .replace(/<\s*\/\s*(p|div|tr|h[1-6])\s*>[ \t]*\n?/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-z]+);/gi, (m, e) => ENTITES[String(e).toLowerCase()] ?? m)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface TioCsv {
  header: string[];
  rows: string[][];
  /** Index de la colonne de référence produit (première occurrence), -1 si absente. */
  refIndex: number;
  /** Index de la colonne « Nom produit », -1 si absente. */
  nameIndex: number;
}

/** Lit un export TIO en CONSERVANT toutes ses colonnes. */
export function parseTioCsv(text: string): TioCsv {
  const lines = String(text ?? "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { header: [], rows: [], refIndex: -1, nameIndex: -1 };
  const sep = [";", ",", "\t"]
    .map((s) => ({ s, n: splitCsvLine(lines[0], s).length }))
    .sort((a, b) => b.n - a.n)[0].s;
  const header = splitCsvLine(lines[0], sep).map((h) => String(h).replace(/^﻿/, "").trim());
  const cherche = (...noms: string[]) => {
    const cibles = noms.map(norm);
    for (let i = 0; i < header.length; i++) if (cibles.includes(norm(header[i]))) return i;
    return -1;
  };
  const refIndex = cherche("Référence produit", "Reference produit", "Référence", "Reference");
  const nameIndex = cherche("Nom produit", "Désignation", "Designation", "Libellé produit");
  const rows = lines.slice(1).map((l) => {
    const cells = splitCsvLine(l, sep);
    // ⚠️ On complète à la largeur de l'en-tête : une ligne plus courte décalerait
    // l'insertion de la description d'une colonne.
    while (cells.length < header.length) cells.push("");
    return cells;
  });
  return { header, rows, refIndex, nameIndex };
}

export interface DescribedExport {
  header: string[];
  rows: string[][];
  /** Position où la colonne a été insérée. */
  insertAt: number;
  /** Lignes ayant reçu un descriptif. */
  withDescription: number;
  /** Références du fichier sans descriptif connu, triées. */
  unknownReferences: string[];
  /** Références du fichier, distinctes. */
  references: string[];
}

/**
 * Ajoute la colonne « Description produit » JUSTE APRÈS « Nom produit » (à défaut, en fin
 * de ligne). Tout le reste du fichier est conservé à l'identique.
 */
export function addDescriptions(
  csv: TioCsv,
  descriptionByReference: Record<string, string>
): DescribedExport {
  const { header, rows, refIndex, nameIndex } = csv;
  if (header.length === 0) {
    return { header: [], rows: [], insertAt: -1, withDescription: 0, unknownReferences: [], references: [] };
  }
  // Après « Nom produit » quand la colonne existe : le descriptif se lit à côté du nom,
  // pas à 20 colonnes de là. Les colonnes sont lues par NOM partout, l'ordre ne casse rien.
  const insertAt = nameIndex >= 0 ? nameIndex + 1 : header.length;

  const clefs = new Map<string, string>();
  for (const [ref, desc] of Object.entries(descriptionByReference || {})) {
    clefs.set(norm(ref), flattenDescription(desc));
  }

  const refs = new Set<string>();
  const inconnues = new Set<string>();
  let withDescription = 0;

  const outRows = rows.map((cells) => {
    const ref = refIndex >= 0 ? String(cells[refIndex] ?? "").trim() : "";
    if (ref) refs.add(ref);
    const desc = ref ? clefs.get(norm(ref)) || "" : "";
    if (desc) withDescription++;
    else if (ref) inconnues.add(ref);
    const copie = [...cells];
    copie.splice(insertAt, 0, desc);
    return copie;
  });

  const outHeader = [...header];
  outHeader.splice(insertAt, 0, COLONNE_DESCRIPTION);

  return {
    header: outHeader,
    rows: outRows,
    insertAt,
    withDescription,
    unknownReferences: [...inconnues].sort(),
    references: [...refs].sort(),
  };
}

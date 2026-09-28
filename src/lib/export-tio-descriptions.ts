// Enrichissement d'un export TIO : DESCRIPTIF produit + MONTANT de la ligne.
//
// Le fichier déposé (export « commandes EAN », export « commandes à la couleur »…) est
// rendu TEL QUEL — toutes ses colonnes, dans leur ordre, sans rien retirer — avec au plus
// deux colonnes en plus :
//   • « Description produit » — référentiel GestLog (`Product.description`, TIO
//     `lng_product.description_fr`), insérée après « Nom produit » ;
//   • « Montant » — `Prix à la variation` × `Quantité`, insérée après « Quantité » ;
//   • « Pays d'origine » — référentiel GestLog (`Product.originCountry`, TIO
//     `lng_product.country`), insérée après « Composition ».
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
export const COLONNE_MONTANT = "Montant";
export const COLONNE_PAYS = "Pays d'origine";

/**
 * 🔴 TIO écrit « 000 » dans `country` quand le pays N'EST PAS renseigné — 280 produits
 * publiés au 28/09/2026. Recopié tel quel, il ressemblerait à un code pays sur un document
 * qui sert à l'étiquetage et au dédouanement. On le traite donc comme une absence.
 */
export const PAYS_NON_RENSEIGNE = "000";

let displayNames: { of(code: string): string | undefined } | null | undefined;

/**
 * Nom français d'un code ISO-2 (« TR » → « Turquie »). Le code inconnu du système est
 * RENDU TEL QUEL plutôt qu'effacé : perdre l'information serait pire que l'afficher brute.
 * Rend `null` quand il n'y a rien à afficher (vide, « 000 »).
 */
export function paysOrigine(code: string | null | undefined): string | null {
  const brut = String(code ?? "").trim().toUpperCase();
  if (!brut || brut === PAYS_NON_RENSEIGNE) return null;
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames(["fr"], { type: "region" });
    } catch {
      displayNames = null; // ICU réduit : on se rabat sur le code.
    }
  }
  if (!/^[A-Z]{2}$/.test(brut)) return brut;
  try {
    return displayNames?.of(brut) || brut;
  } catch {
    return brut;
  }
}

/** Une cellule : le texte d'origine, ou un NOMBRE pour les colonnes calculées. */
export type Cell = string | number;

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

/**
 * Lit un nombre écrit à la française OU à l'anglaise.
 * *Sur l'export du 28/09/2026 les prix sont en « 10.40 » — mais le même écran TIO exporte
 * parfois « 10,40 », et un montant lu 10 au lieu de 10,40 passerait inaperçu.* Quand les
 * deux séparateurs sont présents, le DERNIER est le séparateur décimal.
 */
export function parseNombre(v: Cell): number {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  let s = String(v ?? "").replace(/[\s  ]/g, "").replace(/[€$£]/g, "").trim();
  if (!s) return 0;
  const virgule = s.lastIndexOf(",");
  const point = s.lastIndexOf(".");
  if (virgule >= 0 && point >= 0) {
    s = virgule > point ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (virgule >= 0) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

/** Arrondi monétaire à 2 décimales (évite les 0.30000000000000004 d'Excel). */
const euros = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface TioCsv {
  header: string[];
  rows: string[][];
  /** Index de la colonne de référence produit (première occurrence), -1 si absente. */
  refIndex: number;
  /** Index de la colonne « Nom produit », -1 si absente. */
  nameIndex: number;
  /** Index de « Prix à la variation », -1 si absente. */
  priceIndex: number;
  /** Index de « Quantité », -1 si absente. */
  qtyIndex: number;
  /** Index de « Réduction à la variation », -1 si absente. */
  discountIndex: number;
  /** Index de « Composition », -1 si absente. */
  compositionIndex: number;
}

/** Lit un export TIO en CONSERVANT toutes ses colonnes. */
export function parseTioCsv(text: string): TioCsv {
  const vide: TioCsv = {
    header: [], rows: [], refIndex: -1, nameIndex: -1, priceIndex: -1, qtyIndex: -1,
    discountIndex: -1, compositionIndex: -1,
  };
  const lines = String(text ?? "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return vide;
  const sep = [";", ",", "\t"]
    .map((s) => ({ s, n: splitCsvLine(lines[0], s).length }))
    .sort((a, b) => b.n - a.n)[0].s;
  const header = splitCsvLine(lines[0], sep).map((h) => String(h).replace(/^﻿/, "").trim());
  const cherche = (...noms: string[]) => {
    const cibles = noms.map(norm);
    for (let i = 0; i < header.length; i++) if (cibles.includes(norm(header[i]))) return i;
    return -1;
  };
  const rows = lines.slice(1).map((l) => {
    const cells = splitCsvLine(l, sep);
    // ⚠️ On complète à la largeur de l'en-tête : une ligne plus courte décalerait
    // l'insertion des colonnes calculées.
    while (cells.length < header.length) cells.push("");
    return cells;
  });
  return {
    header,
    rows,
    refIndex: cherche("Référence produit", "Reference produit", "Référence", "Reference"),
    nameIndex: cherche("Nom produit", "Désignation", "Designation", "Libellé produit"),
    priceIndex: cherche("Prix à la variation", "Prix a la variation", "Prix unitaire", "Prix"),
    qtyIndex: cherche("Quantité", "Quantite", "Qté", "Qte"),
    discountIndex: cherche("Réduction à la variation", "Reduction a la variation", "Remise"),
    compositionIndex: cherche("Composition", "Matière", "Matiere"),
  };
}

export interface EnrichOptions {
  /** Descriptif par référence (HTML brut de TIO, aplati ici). */
  descriptionByReference?: Record<string, string>;
  /** Ajouter la colonne « Montant » = prix × quantité. Défaut : true. */
  withAmount?: boolean;
  /** Pays d'origine par référence (code ISO-2 brut de TIO, « 000 » toléré). */
  countryByReference?: Record<string, string>;
}

export interface EnrichedExport {
  header: string[];
  rows: Cell[][];
  /** Position de la colonne descriptif, -1 si non ajoutée. */
  descriptionAt: number;
  /** Position de la colonne montant, -1 si non ajoutée. */
  amountAt: number;
  /** Position de la colonne pays d'origine, -1 si non ajoutée. */
  countryAt: number;
  /** Lignes ayant reçu un pays d'origine. */
  withCountry: number;
  /** Références sans pays d'origine exploitable (absent ou « 000 »), triées. */
  referencesWithoutCountry: string[];
  withDescription: number;
  unknownReferences: string[];
  references: string[];
  /** Somme des montants de ligne (déjà arrondis) — égale à la somme de la colonne. */
  total: number;
  pieces: number;
  /** Lignes à quantité non nulle dont le prix est absent ou nul : montant à 0. */
  linesWithoutPrice: number;
  /** Lignes portant une réduction non nulle : le montant brut ne la déduit PAS. */
  linesWithDiscount: number;
}

/**
 * Ajoute le descriptif (après « Nom produit ») et le montant (après « Quantité »).
 * Tout le reste du fichier est conservé à l'identique. À défaut de colonne d'ancrage, la
 * colonne ajoutée va en fin de ligne.
 */
export function enrichTioCsv(csv: TioCsv, options: EnrichOptions = {}): EnrichedExport {
  const { header, rows, refIndex, nameIndex, priceIndex, qtyIndex, discountIndex, compositionIndex } = csv;
  const descriptions = options.descriptionByReference;
  const pays = options.countryByReference;
  const veutDesc = !!descriptions;
  const veutPays = !!pays;
  // Sans prix NI quantité, un montant n'aurait aucun sens : on ne fabrique pas une colonne
  // de zéros qui aurait l'air d'un chiffre d'affaires nul.
  const veutMontant = options.withAmount !== false && priceIndex >= 0 && qtyIndex >= 0;

  if (header.length === 0) {
    return {
      header: [], rows: [], descriptionAt: -1, amountAt: -1, countryAt: -1,
      withDescription: 0, withCountry: 0, unknownReferences: [], referencesWithoutCountry: [],
      references: [], total: 0, pieces: 0, linesWithoutPrice: 0, linesWithDiscount: 0,
    };
  }

  const clefs = new Map<string, string>();
  for (const [ref, desc] of Object.entries(descriptions || {})) {
    clefs.set(norm(ref), flattenDescription(desc));
  }
  const clefsPays = new Map<string, string>();
  for (const [ref, code] of Object.entries(pays || {})) {
    const nom = paysOrigine(code);
    if (nom) clefsPays.set(norm(ref), nom);
  }

  // Le pays d'origine se lit avec la composition : ce sont les deux mentions d'étiquette.
  // À défaut de colonne « Composition », il suit le descriptif / le nom produit.
  const ancrePays = compositionIndex >= 0 ? compositionIndex : nameIndex;

  // En-tête de sortie : chaque colonne ajoutée suit son ancre, sinon elle va à la fin.
  const outHeader: string[] = [];
  let descriptionAt = -1;
  let amountAt = -1;
  let countryAt = -1;
  for (let i = 0; i < header.length; i++) {
    outHeader.push(header[i]);
    if (veutDesc && i === nameIndex) {
      descriptionAt = outHeader.length;
      outHeader.push(COLONNE_DESCRIPTION);
    }
    if (veutPays && i === ancrePays) {
      countryAt = outHeader.length;
      outHeader.push(COLONNE_PAYS);
    }
    if (veutMontant && i === qtyIndex) {
      amountAt = outHeader.length;
      outHeader.push(COLONNE_MONTANT);
    }
  }
  if (veutDesc && descriptionAt < 0) {
    descriptionAt = outHeader.length;
    outHeader.push(COLONNE_DESCRIPTION);
  }
  if (veutMontant && amountAt < 0) {
    amountAt = outHeader.length;
    outHeader.push(COLONNE_MONTANT);
  }
  if (veutPays && countryAt < 0) {
    countryAt = outHeader.length;
    outHeader.push(COLONNE_PAYS);
  }

  const refs = new Set<string>();
  const inconnues = new Set<string>();
  let withDescription = 0;
  let withCountry = 0;
  const sansPays = new Set<string>();
  let total = 0;
  let pieces = 0;
  let linesWithoutPrice = 0;
  let linesWithDiscount = 0;

  const outRows: Cell[][] = rows.map((cells) => {
    const ref = refIndex >= 0 ? String(cells[refIndex] ?? "").trim() : "";
    if (ref) refs.add(ref);
    let desc = "";
    if (veutDesc) {
      desc = ref ? clefs.get(norm(ref)) || "" : "";
      if (desc) withDescription++;
      else if (ref) inconnues.add(ref);
    }

    let nomPays = "";
    if (veutPays) {
      nomPays = ref ? clefsPays.get(norm(ref)) || "" : "";
      if (nomPays) withCountry++;
      else if (ref) sansPays.add(ref);
    }

    let montant = 0;
    if (veutMontant) {
      const prix = parseNombre(cells[priceIndex]);
      const qte = parseNombre(cells[qtyIndex]);
      montant = euros(prix * qte);
      total = euros(total + montant);
      pieces += qte;
      if (qte !== 0 && prix === 0) linesWithoutPrice++;
      if (discountIndex >= 0 && parseNombre(cells[discountIndex]) !== 0) linesWithDiscount++;
    }

    const out: Cell[] = [];
    for (let i = 0; i < header.length; i++) {
      out.push(cells[i] ?? "");
      if (veutDesc && i === nameIndex) out.push(desc);
      if (veutPays && i === ancrePays) out.push(nomPays);
      if (veutMontant && i === qtyIndex) out.push(montant);
    }
    if (veutDesc && nameIndex < 0) out.push(desc);
    if (veutMontant && qtyIndex < 0) out.push(montant);
    if (veutPays && ancrePays < 0) out.push(nomPays);
    return out;
  });

  return {
    header: outHeader,
    rows: outRows,
    descriptionAt,
    amountAt,
    countryAt,
    withDescription,
    withCountry,
    unknownReferences: [...inconnues].sort(),
    referencesWithoutCountry: [...sansPays].sort(),
    references: [...refs].sort(),
    total,
    pieces,
    linesWithoutPrice,
    linesWithDiscount,
  };
}

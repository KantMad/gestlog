// Export « commandes EAN » éclaté par fournisseur.
//
// Entrée : l'export TIO « EAN » — une ligne par commande × produit × coloris × TAILLE,
// avec son EAN et sa quantité. Sortie : un classeur avec UN ONGLET PAR FOURNISSEUR,
// les lignes du fichier conservées telles quelles (EAN et SKU compris), le fournisseur
// venant de la BASE (correspondances importées, puis commandes fournisseurs).
//
// 🔴 LES COLONNES PERSONNELLES SONT ÉCARTÉES. Le fichier porte le nom, le prénom, le genre
// et l'e-mail du client, ceux du responsable commercial, et les adresses de facturation.
// *Sur l'export du 28/09/2026 : 8 e-mails clients distincts, 12 adresses.* Un onglet
// destiné à un fournisseur n'a aucune raison de les transporter — c'est un choix explicite,
// pas un oubli.
//
// ⚠️ La colonne « Référence produit » apparaît DEUX FOIS dans ce format (positions 19 et
// 25). *Vérifié sur 6 763 lignes : les deux valeurs sont toujours identiques.* On lit la
// première, et une lecture par nom de colonne (qui écraserait l'une par l'autre) serait
// tout aussi juste — mais moins explicite.

import { safeSheetName } from "@/lib/lancement-commande";

export interface EanOrderRow {
  orderNumber: string;
  status: string;
  shop: string;
  catalog: string;
  reference: string;
  productName: string;
  category: string;
  subCategory: string;
  colorCode: string;
  colorLabel: string;
  sizeType: string;
  size: string;
  sku: string;
  ean: string;
  quantity: number;
  /** Prix à la variation, conservé à part : son inclusion est un choix de l'exploitant. */
  price: string;
}

/** Onglet des références dont le fournisseur est inconnu. Toujours en dernier. */
export const SANS_FOURNISSEUR = "Sans fournisseur";

/** Découpe une ligne CSV en respectant les guillemets. */
export function splitCsvLine(line: string, sep = ";"): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const norm = (s: string) =>
  String(s ?? "").replace(/^﻿/, "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Lit l'export « EAN ». Colonnes repérées PAR NOM ; pour « Référence produit », présente
 * deux fois, on retient la PREMIÈRE occurrence.
 */
export function parseEanOrdersCsv(text: string): EanOrderRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map(norm);
  const at = (...noms: string[]) => {
    for (const n of noms) {
      const i = header.indexOf(norm(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const iRef = at("Référence produit");
  const iEan = at("EAN");
  const iQte = at("Quantité");
  // Sans référence, sans EAN ou sans quantité, ce n'est pas le bon fichier.
  if (iRef < 0 || iEan < 0 || iQte < 0) return [];

  const idx = {
    orderNumber: at("Numéro de commande"),
    status: at("Statut de commande"),
    shop: at("Nom d'enseigne"),
    catalog: at("Nom du catalogue de vente"),
    productName: at("Nom produit"),
    category: at("Catégorie produit"),
    subCategory: at("Sous-catégorie produit"),
    colorCode: at("Code couleur"),
    colorLabel: at("Nom de la couleur"),
    sizeType: at("Type de taille"),
    size: at("Taille"),
    sku: at("SKU"),
    price: at("Prix à la variation"),
  };
  const g = (c: string[], i: number) => (i >= 0 ? (c[i] ?? "").trim() : "");

  const out: EanOrderRow[] = [];
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line);
    const reference = (c[iRef] ?? "").trim();
    const quantity = Number((c[iQte] ?? "").replace(",", ".")) || 0;
    // Une ligne sans référence n'est rattachable à rien ; une quantité nulle n'a pas à
    // figurer dans une commande transmise au fournisseur.
    if (!reference || quantity <= 0) continue;
    out.push({
      reference,
      quantity,
      ean: (c[iEan] ?? "").trim(),
      orderNumber: g(c, idx.orderNumber),
      status: g(c, idx.status),
      shop: g(c, idx.shop),
      catalog: g(c, idx.catalog),
      productName: g(c, idx.productName),
      category: g(c, idx.category),
      subCategory: g(c, idx.subCategory),
      colorCode: g(c, idx.colorCode),
      colorLabel: g(c, idx.colorLabel),
      sizeType: g(c, idx.sizeType),
      size: g(c, idx.size),
      sku: g(c, idx.sku),
      price: g(c, idx.price),
    });
  }
  return out;
}

export interface EanSheet {
  supplier: string;
  sheetName: string;
  header: string[];
  rows: (string | number)[][];
  pieces: number;
  references: number;
}

export interface EanSplit {
  sheets: EanSheet[];
  /** Références du fichier sans fournisseur connu. */
  unknownReferences: string[];
  supplierCount: number;
  pieces: number;
  lines: number;
}

const COLONNES = [
  "Fournisseur",
  "N° commande",
  "Boutique",
  "Catalogue",
  "Référence",
  "Libellé produit",
  "Catégorie",
  "Sous-catégorie",
  "Code couleur",
  "Couleur",
  "Type taille",
  "Taille",
  "SKU",
  "EAN",
  "Quantité",
];

/**
 * Éclate les lignes par fournisseur, du plus gros volume au plus petit.
 *
 * ⚠️ Une ligne n'apparaît que dans UN onglet : recopier une référence servie par deux
 * fournisseurs doublerait les quantités du classeur. L'appelant a tranché en amont.
 *
 * ⚠️ `withPrices` ajoute la colonne « Prix à la variation ». Par défaut NON : c'est le prix
 * payé par la boutique, et un fournisseur n'a pas à le connaître.
 */
export function splitEanBySupplier(
  rows: EanOrderRow[],
  supplierByReference: Record<string, string>,
  { withPrices = false }: { withPrices?: boolean } = {}
): EanSplit {
  const parFournisseur = new Map<string, EanOrderRow[]>();
  const inconnues = new Set<string>();

  for (const r of rows) {
    const f = (supplierByReference[r.reference] || "").trim();
    if (!f) inconnues.add(r.reference);
    const cle = f || SANS_FOURNISSEUR;
    const bucket = parFournisseur.get(cle);
    if (bucket) bucket.push(r);
    else parFournisseur.set(cle, [r]);
  }

  const header = withPrices ? [...COLONNES, "Prix à la variation"] : COLONNES;

  const construits = [...parFournisseur.entries()]
    .map(([supplier, rs]) => ({
      supplier,
      rs,
      pieces: rs.reduce((n, r) => n + r.quantity, 0),
      references: new Set(rs.map((r) => r.reference)).size,
    }))
    .sort((a, b) => {
      // « Sans fournisseur » en dernier, quel que soit son volume : c'est une liste de
      // travail, pas un fournisseur.
      if (a.supplier === SANS_FOURNISSEUR) return 1;
      if (b.supplier === SANS_FOURNISSEUR) return -1;
      return b.pieces - a.pieces || a.supplier.localeCompare(b.supplier, "fr");
    });

  const taken = new Set<string>();
  const sheets: EanSheet[] = construits.map((x) => ({
    supplier: x.supplier,
    sheetName: safeSheetName(x.supplier, taken),
    header,
    pieces: x.pieces,
    references: x.references,
    rows: x.rs.map((r) => {
      const base: (string | number)[] = [
        x.supplier === SANS_FOURNISSEUR ? "" : x.supplier,
        r.orderNumber, r.shop, r.catalog, r.reference, r.productName,
        r.category, r.subCategory, r.colorCode, r.colorLabel,
        r.sizeType, r.size, r.sku, r.ean, r.quantity,
      ];
      return withPrices ? [...base, r.price] : base;
    }),
  }));

  return {
    sheets,
    unknownReferences: [...inconnues].sort((a, b) => a.localeCompare(b, "fr")),
    supplierCount: sheets.filter((s) => s.supplier !== SANS_FOURNISSEUR).length,
    pieces: rows.reduce((n, r) => n + r.quantity, 0),
    lines: rows.length,
  };
}

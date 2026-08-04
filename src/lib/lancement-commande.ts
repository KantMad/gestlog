// ─── Lancement de commande ───────────────────────────────────────────────────
// Transforme l'export TIO « commandes à la couleur » (CSV, une ligne par
// commande × produit × couleur, quantités en colonnes T0..T11) en tableaux de
// LANCEMENT : un onglet par catégorie, produits triés par quantité décroissante,
// couleurs détaillées sous chaque produit, et les colonnes de travail
// (site / % réa / réa / total) attendues par le service achat.
//
// ⚠️ Les colonnes T0..T11 sont des POSITIONS, pas des noms de tailles : `T0` est la
// 1re taille de la GRILLE DU PRODUIT (`Product.sizeScale` dans GestLog), `T1` la 2e…
// Ce n'est PAS l'ordre du « Type de taille » (`SizeType`), dont les positions en base
// ne suivent pas toujours l'ordre d'habillage (ex. HAU y commence par M).
//
// Fonctions PURES : pas de DB, pas de réseau → testables et utilisables côté écran.

export interface LancementCsvRow {
  reference: string;
  productName: string;
  category: string;
  colorCode: string;
  colorName: string;
  sizeType: string;
  /** Quantités par position (T0..T11), longueur = nb de colonnes T présentes. */
  quantities: number[];
  /** « Quantité à la couleur » du fichier (contrôle). */
  totalQty: number;
}

export type LancementLineKind = "category" | "product" | "color";

export interface LancementLine {
  kind: LancementLineKind;
  /** Colonne « Étiquettes de lignes ». */
  label: string;
  /** Quantités commandées par NOM de taille. */
  bySize: Record<string, number>;
  total: number;
}

export interface LancementSheet {
  category: string;
  /** Tailles de l'onglet, dans l'ordre d'habillage. */
  sizes: string[];
  lines: LancementLine[];
  total: number;
}

// ─── Parsing CSV ─────────────────────────────────────────────────────────────

/** Découpe une ligne CSV en respectant les guillemets (« a";"b » → [a, b]). */
function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      // "" échappe un guillemet à l'intérieur d'un champ
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (c === sep && !inQuotes) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const norm = (v: string): string => String(v ?? "").replace(/\s+/g, " ").trim();
const key = (v: string): string => norm(v).toLowerCase().replace(/[^a-z0-9]/g, "");

const toInt = (v: string): number => {
  const n = parseInt(norm(v).replace(/\s/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Parse l'export « commandes à la couleur ». Colonnes repérées PAR NOM (l'ordre peut
 * varier d'un export à l'autre) ; séparateur `;` ou `,` auto-détecté ; BOM toléré.
 * Les lignes sans référence, ou dont toutes les quantités sont nulles, sont ignorées.
 */
export function parseLancementCsv(text: string): LancementCsvRow[] {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];

  // Séparateur : celui qui découpe l'en-tête en le plus de colonnes.
  const sep = splitCsvLine(lines[0], ";").length >= splitCsvLine(lines[0], ",").length ? ";" : ",";
  const header = splitCsvLine(lines[0], sep).map(key);

  const col = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(key(n));
      if (i >= 0) return i;
    }
    return -1;
  };

  const cRef = col("Référence produit", "Reference produit");
  const cName = col("Nom produit");
  const cCat = col("Catégorie produit", "Categorie produit");
  const cColorCode = col("Code couleur");
  const cColorName = col("Nom de la couleur");
  const cSizeType = col("Type de taille");
  const cQty = col("Quantité à la couleur", "Quantite a la couleur");
  if (cRef < 0) return []; // pas le bon fichier

  // Colonnes T0..T11, dans l'ordre des positions.
  const tCols: number[] = [];
  for (let i = 0; i < 12; i++) {
    const idx = header.indexOf(key(`T${i}`));
    if (idx >= 0) tCols[i] = idx;
  }

  const out: LancementCsvRow[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = splitCsvLine(lines[r], sep);
    const reference = norm(cells[cRef] || "");
    if (!reference) continue;

    const quantities: number[] = [];
    for (let i = 0; i < tCols.length; i++) {
      const idx = tCols[i];
      quantities[i] = idx === undefined ? 0 : toInt(cells[idx] || "");
    }
    if (quantities.every((q) => q <= 0)) continue;

    out.push({
      reference,
      productName: cName >= 0 ? norm(cells[cName] || "") : "",
      category: cCat >= 0 ? norm(cells[cCat] || "") : "",
      colorCode: cColorCode >= 0 ? norm(cells[cColorCode] || "") : "",
      colorName: cColorName >= 0 ? norm(cells[cColorName] || "") : "",
      sizeType: cSizeType >= 0 ? norm(cells[cSizeType] || "") : "",
      quantities,
      totalQty: cQty >= 0 ? toInt(cells[cQty] || "") : 0,
    });
  }
  return out;
}

// ─── Ordre des tailles ───────────────────────────────────────────────────────

// Ordre d'habillage de référence, pour départager des tailles qu'aucune grille ne
// met côte à côte. Les tailles NUMÉRIQUES (jeans, vestes) se trient entre elles.
const CANONICAL = [
  "TU", "ONE SIZE", "XS", "S", "S/M", "S-M", "M", "M/L", "L", "L/XL", "L-XL",
  "XL", "XL/2XL", "2XL", "2XL-3XL", "3XL", "3XL/4XL", "4XL", "5XL", "6XL",
];
const canonRank = (s: string) => {
  const i = CANONICAL.indexOf(s.toUpperCase());
  return i >= 0 ? i : 999;
};
const numOf = (s: string) => {
  const m = s.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
};

/**
 * Ordonne l'union des tailles d'une catégorie. On part de la grille la plus longue
 * (elle porte l'ordre d'habillage réel), puis on insère les tailles des autres grilles
 * à leur place relative. Repli : ordre canonique, puis valeur numérique.
 */
export function mergeSizeOrder(scales: string[][]): string[] {
  const nonEmpty = scales.filter((s) => s.length > 0);
  if (nonEmpty.length === 0) return [];
  const base = [...nonEmpty].sort((a, b) => b.length - a.length)[0].slice();

  for (const scale of nonEmpty) {
    for (let i = 0; i < scale.length; i++) {
      const size = scale[i];
      if (base.includes(size)) continue;
      // Insérer juste après la taille précédente de SA grille si on la connaît,
      // sinon juste avant la suivante ; à défaut, à la fin (trié ensuite).
      let at = -1;
      for (let j = i - 1; j >= 0 && at < 0; j--) {
        const k = base.indexOf(scale[j]);
        if (k >= 0) at = k + 1;
      }
      if (at < 0) {
        for (let j = i + 1; j < scale.length && at < 0; j++) {
          const k = base.indexOf(scale[j]);
          if (k >= 0) at = k;
        }
      }
      if (at < 0) at = base.length;
      base.splice(at, 0, size);
    }
  }

  // Les tailles numériques restent triées entre elles (36 avant 38…), sans toucher
  // à l'ordre des tailles lettres qui vient des grilles.
  const nums = base.filter((s) => !isNaN(numOf(s)));
  const sortedNums = [...nums].sort((a, b) => numOf(a) - numOf(b) || canonRank(a) - canonRank(b));
  let n = 0;
  return base.map((s) => (isNaN(numOf(s)) ? s : sortedNums[n++]));
}

// ─── Construction des onglets ────────────────────────────────────────────────

/** Libellé d'une couleur : « 213 Chocolat » (code seul si le nom manque). */
export const colorLabel = (code: string, name: string) =>
  [norm(code), norm(name)].filter(Boolean).join(" ");

/** Libellé d'un produit : « RMPULL_W001 Pull 1/2 zip lambswool ». */
export const productLabel = (reference: string, name: string) =>
  [norm(reference), norm(name)].filter(Boolean).join(" ");

const addTo = (m: Record<string, number>, size: string, qty: number) => {
  if (qty > 0) m[size] = (m[size] || 0) + qty;
};

/**
 * Regroupe les lignes en onglets (une catégorie = un onglet). Dans chaque onglet :
 * une ligne de total catégorie, puis les produits **triés par quantité décroissante**,
 * chacun suivi de ses couleurs, elles aussi triées par quantité décroissante.
 *
 * `sizeScales` : grille de tailles par référence (depuis GestLog). Une référence sans
 * grille — ou dont la grille est plus courte que le nombre de positions renseignées —
 * est signalée dans `warnings` et ses positions inconnues sont nommées `T{i}`.
 */
export function buildLancementSheets(
  rows: LancementCsvRow[],
  sizeScales: Record<string, string[]>
): { sheets: LancementSheet[]; warnings: string[] } {
  const warnings: string[] = [];
  const missingScale = new Set<string>();
  const shortScale = new Set<string>();

  // Nom de la taille pour une position donnée, selon la grille du produit.
  const sizeAt = (reference: string, pos: number): string => {
    const scale = sizeScales[reference];
    if (!scale || scale.length === 0) {
      missingScale.add(reference);
      return `T${pos}`;
    }
    if (pos >= scale.length) {
      shortScale.add(reference);
      return `T${pos}`;
    }
    return scale[pos];
  };

  type Color = { label: string; bySize: Record<string, number>; total: number };
  type Product = {
    label: string;
    reference: string;
    bySize: Record<string, number>;
    total: number;
    colors: Map<string, Color>;
  };
  const byCategory = new Map<string, Map<string, Product>>();

  for (const row of rows) {
    const category = row.category || "Sans catégorie";
    let products = byCategory.get(category);
    if (!products) byCategory.set(category, (products = new Map()));

    let product = products.get(row.reference);
    if (!product) {
      product = {
        label: productLabel(row.reference, row.productName),
        reference: row.reference,
        bySize: {},
        total: 0,
        colors: new Map(),
      };
      products.set(row.reference, product);
    }

    const ckey = row.colorCode || row.colorName;
    let color = product.colors.get(ckey);
    if (!color) {
      color = { label: colorLabel(row.colorCode, row.colorName), bySize: {}, total: 0 };
      product.colors.set(ckey, color);
    }

    for (let pos = 0; pos < row.quantities.length; pos++) {
      const qty = row.quantities[pos];
      if (qty <= 0) continue;
      const size = sizeAt(row.reference, pos);
      addTo(color.bySize, size, qty);
      addTo(product.bySize, size, qty);
      color.total += qty;
      product.total += qty;
    }
  }

  if (missingScale.size > 0)
    warnings.push(
      `${missingScale.size} référence(s) introuvable(s) au référentiel — tailles nommées T0, T1… : ${[...missingScale].slice(0, 5).join(", ")}${missingScale.size > 5 ? "…" : ""}`
    );
  if (shortScale.size > 0)
    warnings.push(
      `${shortScale.size} référence(s) dont la grille de tailles est incomplète au référentiel : ${[...shortScale].slice(0, 5).join(", ")}${shortScale.size > 5 ? "…" : ""}`
    );

  const sheets: LancementSheet[] = [];
  for (const [category, products] of byCategory) {
    const sorted = [...products.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, "fr"));
    const sizes = mergeSizeOrder(sorted.map((p) => sizeScales[p.reference] || Object.keys(p.bySize)));
    // Tailles réellement utilisées, dans l'ordre — une colonne vide n'a pas d'intérêt.
    const used = new Set<string>();
    for (const p of sorted) for (const s of Object.keys(p.bySize)) used.add(s);
    const cols = sizes.filter((s) => used.has(s));
    for (const s of used) if (!cols.includes(s)) cols.push(s); // tailles hors grille (T{i}…)

    const catTotals: Record<string, number> = {};
    let catTotal = 0;
    for (const p of sorted) {
      for (const [s, q] of Object.entries(p.bySize)) addTo(catTotals, s, q);
      catTotal += p.total;
    }

    const lines: LancementLine[] = [
      { kind: "category", label: category, bySize: catTotals, total: catTotal },
    ];
    for (const p of sorted) {
      lines.push({ kind: "product", label: p.label, bySize: p.bySize, total: p.total });
      const colors = [...p.colors.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, "fr"));
      for (const c of colors) lines.push({ kind: "color", label: c.label, bySize: c.bySize, total: c.total });
    }

    sheets.push({ category, sizes: cols, lines, total: catTotal });
  }

  // Onglets triés par volume décroissant (le plus gros en premier).
  sheets.sort((a, b) => b.total - a.total || a.category.localeCompare(b.category, "fr"));
  return { sheets, warnings };
}

/** Nom d'onglet Excel valide : 31 caractères max, sans `: \ / ? * [ ]`. */
export function safeSheetName(name: string, taken: Set<string>): string {
  let base = norm(name).replace(/[:\\/?*[\]]/g, "-").slice(0, 31) || "Feuille";
  let candidate = base;
  let i = 2;
  while (taken.has(candidate.toLowerCase())) {
    const suffix = ` (${i++})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

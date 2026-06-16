// Logique PURE de génération du fichier de « répartition magasin » à partir d'un
// export commande client TIO. Transforme un fichier mono-onglet (lignes par
// client/produit/coloris, quantités positionnelles Q.1..Q.16) en un classeur avec
// UN ONGLET PAR FOURNISSEUR (colonne « Fournisseur principal fiche PF »), les
// quantités replacées sous les bons libellés de taille.
//
// Étiquetage des tailles : la LÉGENDE en tête du fichier (code grille → libellés
// dans l'ordre des positions Q) est la source d'ordre. Le lien produit→grille vient
// du catalogue (sizeScale), apparié à la grille légende dont l'ensemble de tailles
// est le plus petit sur-ensemble. Placement PAR LIBELLÉ (robuste aux grilles DB mal
// ordonnées et aux fournisseurs multi-familles).
//
// Aucune dépendance (pas de xlsx/prisma ici) → testable unitairement.

// Disposition des colonnes de l'export commande client TIO (index 0-based).
export const COL = {
  coloris: 2,      // "Coloris produit fini"  (ex. "752-Bleu marine")
  supplier: 3,     // "Fournisseur principal fiche PF" (ex. "ARETEX")
  totalQ: 4,       // "Total Q" (data) / code grille (légende)
  qStart: 5,       // "Q. 1"
  qEnd: 21,        // exclusif → Q.1..Q.16
  client: 38,      // "Code client(Client)"
  ville: 40,       // "Ville(Client)"
  reference: 41,   // "Code produit fini(Produit fini)"
} as const;

export interface RepartitionRow {
  client: string;
  ville: string;
  reference: string;
  coloris: string;
  supplier: string;
  totalQ: number;
  q: number[]; // 16 positions
}

export interface SupplierSheet {
  supplier: string;
  sheetName: string;
  header: string[];
  rows: (string | number)[][];
}

export interface RepartitionReportRow {
  supplier: string;
  sheetName: string;
  grid: string;
  lines: number;
  dropped: number;
}

export interface RepartitionResult {
  sheets: SupplierSheet[];
  report: RepartitionReportRow[];
  totalLines: number;
  totalDropped: number;
}

export type Legend = Record<string, string[]>; // code grille → libellés ordonnés

// Normalise un libellé de taille pour la sortie (catalogue/légende "2XL" → "XXL").
export function normalizeSize(s: string): string {
  const u = String(s).trim().toUpperCase();
  return u === "2XL" ? "XXL" : u;
}

// Légende = lignes SANS référence produit mais avec un code en colonne "Total Q",
// et des libellés de taille dans Q.1..Q.16 (dans l'ordre des positions).
export function parseLegend(aoa: unknown[][]): Legend {
  const legend: Legend = {};
  for (const r of aoa.slice(1)) {
    const ref = String(r[COL.reference] ?? "").trim();
    const code = String(r[COL.totalQ] ?? "").trim();
    if (ref || !code) continue;
    const labels = r
      .slice(COL.qStart, COL.qEnd)
      .map((x) => String(x ?? "").trim())
      .filter(Boolean)
      .map(normalizeSize);
    if (labels.length) legend[code] = labels;
  }
  return legend;
}

// Lignes de données = référence ET fournisseur renseignés.
export function extractDataRows(aoa: unknown[][]): RepartitionRow[] {
  const out: RepartitionRow[] = [];
  for (const r of aoa.slice(1)) {
    const reference = String(r[COL.reference] ?? "").trim();
    const supplier = String(r[COL.supplier] ?? "").trim();
    if (!reference || !supplier) continue;
    out.push({
      client: String(r[COL.client] ?? "").trim(),
      ville: String(r[COL.ville] ?? "").trim(),
      reference,
      coloris: String(r[COL.coloris] ?? "").trim(),
      supplier,
      totalQ: Number(r[COL.totalQ]) || 0,
      q: r.slice(COL.qStart, COL.qEnd).map((x) => Number(x) || 0),
    });
  }
  return out;
}

// Choisit la grille légende = plus petit sur-ensemble des tailles du produit.
export function pickGrid(sizes: string[], legend: Legend): string[] | null {
  const sset = sizes.map(normalizeSize).filter(Boolean);
  let best: string[] | null = null;
  for (const labels of Object.values(legend)) {
    const set = new Set(labels);
    if (sset.every((s) => set.has(s)) && (!best || labels.length < best.length)) best = labels;
  }
  return best;
}

// Nom d'onglet Excel valide (≤ 31 car, sans [ ] : * ? / \).
export function sanitizeSheetName(name: string): string {
  return name.replace(/[[\]:*?/\\]/g, "").trim().slice(0, 31) || "Inconnu";
}

// Ordre canonique global des libellés de taille, dérivé des grilles produits
// (les plus longues d'abord → elles fixent l'ossature ; les nouvelles tailles
// sont ajoutées à leur position). Sert à ordonner une grille fournisseur élargie.
export function buildSizeOrder(gridByRef: Record<string, string[]>): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const grids = Object.values(gridByRef).slice().sort((a, b) => b.length - a.length);
  for (const g of grids) for (const lab of g) if (!seen.has(lab)) { seen.add(lab); order.push(lab); }
  return order;
}

// Construit les onglets : un par fournisseur, grille = grille dominante de ses
// produits, quantités replacées PAR LIBELLÉ. `gridByRef` = réf → libellés ordonnés.
export function buildRepartition(
  dataRows: RepartitionRow[],
  gridByRef: Record<string, string[]>
): RepartitionResult {
  const suppliers = [...new Set(dataRows.map((d) => d.supplier))].sort();
  const sheets: SupplierSheet[] = [];
  const report: RepartitionReportRow[] = [];
  const usedNames = new Set<string>();
  const sizeOrder = buildSizeOrder(gridByRef);
  let totalDropped = 0;

  for (const sup of suppliers) {
    const supRows = dataRows.filter((d) => d.supplier === sup);
    // grille ÉLARGIE : union de toutes les tailles des produits du fournisseur,
    // ordonnée selon l'ordre canonique global → aucune pièce laissée hors grille.
    const needed = new Set<string>();
    for (const d of supRows) for (const lab of gridByRef[d.reference] || []) needed.add(lab);
    const grid = sizeOrder.filter((l) => needed.has(l));
    for (const lab of needed) if (!grid.includes(lab)) grid.push(lab); // libellés hors ordre global
    const gridSet = new Set(grid);

    let dropped = 0;
    const rows = supRows
      .slice()
      .sort(
        (a, b) =>
          a.client.localeCompare(b.client) ||
          a.reference.localeCompare(b.reference) ||
          a.coloris.localeCompare(b.coloris)
      )
      .map((d) => {
        const pg = gridByRef[d.reference] || [];
        const byLabel: Record<string, number> = {};
        pg.forEach((lab, i) => {
          byLabel[lab] = (byLabel[lab] || 0) + (d.q[i] || 0);
        });
        for (const [lab, qty] of Object.entries(byLabel)) {
          if (qty > 0 && !gridSet.has(lab)) dropped += qty; // taille hors grille fournisseur
        }
        const cells = grid.map((lab) => byLabel[lab] || 0);
        return [d.client, d.ville, d.reference, d.coloris, d.supplier, ...cells, d.totalQ];
      });

    // nom d'onglet unique
    let name = sanitizeSheetName(sup);
    let k = 1;
    const base = name;
    while (usedNames.has(name)) name = sanitizeSheetName(base.slice(0, 28) + "_" + ++k);
    usedNames.add(name);

    sheets.push({
      supplier: sup,
      sheetName: name,
      header: ["Client", "Ville", "Référence", "Coloris", "Fournisseur", ...grid, "TOTAL"],
      rows,
    });
    report.push({ supplier: sup, sheetName: name, grid: grid.join("/"), lines: rows.length, dropped });
    totalDropped += dropped;
  }

  return { sheets, report, totalLines: dataRows.length, totalDropped };
}

import * as XLSX from "xlsx";

// Parseurs dédiés aux formats de fichiers MCS (réels, fournis par l'utilisateur) :
//  - "statgen"      : export commande fournisseur (en-tête ligne 0, quantités sous
//                     "Q. 1".."Q. 16" décodées par position via la grille du produit).
//  - "packing-list" : liste de colisage = réception (en-tête enfoui ~ligne 18,
//                     tailles en lettres, couleur=code, réf avec tiret).
// Ces fonctions sont PURES (pas de DB) → utilisables côté client (détection/preview)
// ET côté serveur (parsing autoritatif). Le mapping vers les produits/tailles se fait
// dans mcs-mapper.ts (qui a accès à la base).

export type McsFormat = "statgen" | "packing-list";

type Cell = string | number | boolean | null | undefined;
type Grid = Cell[][];

const norm = (v: Cell): string => String(v ?? "").replace(/\s+/g, " ").trim();
const up = (v: Cell): string => norm(v).toUpperCase();

function readGrid(ws: XLSX.WorkSheet): Grid {
  // blankrows:true → on conserve les positions physiques (la PL repère les tailles
  // sur la ligne AU-DESSUS de l'en-tête : les positions relatives doivent être fiables).
  return XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, defval: "", blankrows: true });
}

function eachSheet(buffer: ArrayBuffer): { name: string; grid: Grid }[] {
  const wb = XLSX.read(buffer, { type: "array" });
  return wb.SheetNames.map((name) => ({ name, grid: readGrid(wb.Sheets[name]) }));
}

// "208-Cognac" → { code: "208", name: "Cognac" }
function splitColor(raw: Cell): { code: string; name: string } {
  const s = norm(raw);
  const i = s.indexOf("-");
  if (i === -1) return { code: s, name: "" };
  return { code: s.slice(0, i).trim(), name: s.slice(i + 1).trim() };
}

// En-tête d'une commande fournisseur StatGen : présence du fournisseur ET de la
// référence produit. L'ordre des colonnes et le libellé exact du n° de commande
// varient selon l'export TIO (« Numéro de commande » OU « N° commande PF
// fournisseur ») → on ne s'appuie PAS sur le libellé du n° de commande pour détecter.
const isStatgenHeader = (cells: string[]): boolean =>
  cells.includes("FICHE FOURNISSEUR") && cells.includes("FICHE PRODUIT FINI");

// ---------------------------------------------------------------- détection
export function detectMcsFormat(buffer: ArrayBuffer): McsFormat | null {
  for (const { grid } of eachSheet(buffer)) {
    for (let r = 0; r < Math.min(grid.length, 30); r++) {
      const cells = (grid[r] || []).map(up);
      if (cells.includes("FULL MCS PRODUCT REF")) return "packing-list";
      if (isStatgenHeader(cells)) return "statgen";
    }
  }
  return null;
}

// ---------------------------------------------------------------- StatGen
export interface McsSupplierLine {
  orderNumber: string;
  supplierCode: string;
  reference: string;
  colorCode: string;
  colorName: string;
  quantities: number[]; // dans l'ordre des colonnes Q.1..Q.n (positions)
}

export function parseMcsStatgen(buffer: ArrayBuffer): McsSupplierLine[] {
  for (const { grid } of eachSheet(buffer)) {
    let h = -1;
    for (let r = 0; r < Math.min(grid.length, 10); r++) {
      if (isStatgenHeader((grid[r] || []).map(up))) {
        h = r;
        break;
      }
    }
    if (h === -1) continue;

    const header = (grid[h] || []).map(up);
    // Repérage par NOM (robuste à l'ordre des colonnes et au libellé du n° de commande).
    const cOrder = header.findIndex((hh) => hh.includes("COMMANDE"));
    const cSupplier = header.findIndex((hh) => hh.includes("FOURNISSEUR"));
    const cRef = header.indexOf("FICHE PRODUIT FINI");
    const cColor = header.findIndex((hh) => hh.includes("COLORIS"));
    const qCols: number[] = [];
    header.forEach((hh, i) => {
      if (/^Q\.\s*\d+$/.test(hh)) qCols.push(i);
    });

    const lines: McsSupplierLine[] = [];
    for (let r = h + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      const orderNumber = norm(row[cOrder]);
      const reference = norm(row[cRef]);
      // saute la légende de tailles (n° commande vide), les vides et les totaux
      if (!orderNumber || !reference || reference.toUpperCase() === "TOTAL") continue;
      const { code, name } = splitColor(row[cColor]);
      const quantities = qCols.map((ci) => {
        const v = row[ci];
        const n = typeof v === "number" ? v : parseInt(String(v || "0"), 10);
        return isNaN(n) ? 0 : n;
      });
      lines.push({
        orderNumber,
        supplierCode: norm(row[cSupplier]),
        reference,
        colorCode: code,
        colorName: name,
        quantities,
      });
    }
    if (lines.length) return lines;
  }
  return [];
}

// ---------------------------------------------------------------- Packing List
const SIZE_LETTERS = new Set([
  "TU", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "2XL", "3XL", "4XL", "5XL",
]);

export interface McsReceptionLine {
  reference: string;
  colorCode: string;
  colorName: string;
  sizes: Record<string, number>; // par taille (lettre), déjà sommé sur toutes les lignes de colis
}

export function parseMcsPackingList(buffer: ArrayBuffer): McsReceptionLine[] {
  for (const { grid } of eachSheet(buffer)) {
    let h = -1;
    for (let r = 0; r < grid.length; r++) {
      if ((grid[r] || []).map(up).includes("FULL MCS PRODUCT REF")) {
        h = r;
        break;
      }
    }
    if (h === -1) continue;

    const header = (grid[h] || []).map(up);
    const cRef = header.indexOf("FULL MCS PRODUCT REF");
    const cCode = header.findIndex((s) => s.includes("COLOR") && s.includes("CODE"));
    const cName = header.findIndex((s) => s.includes("DESCR") && s.includes("COLOR"));

    // Tailles : lettres situées sur la ligne juste au-dessus de l'en-tête.
    const letterRow = (grid[h - 1] || []).map(up);
    const sizeCols: { col: number; size: string }[] = [];
    letterRow.forEach((lab, i) => {
      const u = lab.replace(/\s+/g, "");
      if (SIZE_LETTERS.has(u)) sizeCols.push({ col: i, size: u });
    });

    const agg = new Map<string, McsReceptionLine>();
    for (let r = h + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      // fin de la section détail : on tombe sur le 2e en-tête (= début du récapitulatif)
      if (up(row[cRef]) === "FULL MCS PRODUCT REF") break;
      const refCell = norm(row[cRef]);
      if (!refCell || refCell.toUpperCase() === "TOTAL") continue;
      const reference = refCell.replace(/-/g, "_"); // tiret → underscore (format référentiel)
      const colorCode = norm(row[cCode]);
      const key = `${reference}__${colorCode}`;
      let entry = agg.get(key);
      if (!entry) {
        entry = { reference, colorCode, colorName: cName >= 0 ? norm(row[cName]) : "", sizes: {} };
        agg.set(key, entry);
      }
      for (const { col, size } of sizeCols) {
        const v = row[col];
        const n = typeof v === "number" ? v : parseInt(String(v || "0"), 10);
        if (!isNaN(n) && n > 0) entry.sizes[size] = (entry.sizes[size] || 0) + n;
      }
    }
    const out = [...agg.values()].filter((e) => Object.keys(e.sizes).length > 0);
    if (out.length) return out;
  }
  return [];
}

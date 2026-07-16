import * as XLSX from "xlsx";

// Parseurs dédiés aux formats de fichiers MCS (réels, fournis par l'utilisateur) :
//  - "statgen"      : export commande fournisseur (en-tête ligne 0, quantités sous
//                     "Q. 1".."Q. 16" décodées par position via la grille du produit).
//  - "packing-list" : liste de colisage = réception (en-tête enfoui ~ligne 18,
//                     tailles en lettres, couleur=code, réf avec tiret).
// Ces fonctions sont PURES (pas de DB) → utilisables côté client (détection/preview)
// ET côté serveur (parsing autoritatif). Le mapping vers les produits/tailles se fait
// dans mcs-mapper.ts (qui a accès à la base).

export type McsFormat = "statgen" | "packing-list" | "client-order";

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

// En-tête d'une commande fournisseur StatGen : référence produit + une mention
// « fournisseur », et PAS « Fiche client » (qui caractérise une commande client).
// Le fournisseur peut être « Fiche fournisseur » (ancien export) OU « Code
// fournisseur » (nouvel export) ; l'ordre des colonnes et le libellé du n° de
// commande varient → on ne s'appuie sur aucune position ni libellé exact.
const isStatgenHeader = (cells: string[]): boolean =>
  cells.includes("FICHE PRODUIT FINI") &&
  !cells.includes("FICHE CLIENT") &&
  cells.some((c) => c.includes("FOURNISSEUR"));

// En-tête d'une commande CLIENT StatGen : « Fiche client » + « Fiche produit fini »
// (et PAS « Fiche fournisseur », qui caractérise une commande fournisseur).
const isClientOrderHeader = (cells: string[]): boolean =>
  cells.includes("FICHE CLIENT") && cells.includes("FICHE PRODUIT FINI");

// Libellés de tailles (réceptions) : lettres OU numériques OU groupées (39-42, S/M déjà lettre).
const SIZE_LETTERS = new Set([
  "TU", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "2XL", "3XL", "4XL", "5XL", "6XL",
]);
const isSizeHeader = (h: string): boolean => {
  const u = h.replace(/\s+/g, "").toUpperCase();
  return SIZE_LETTERS.has(u) || /^\d{2}$/.test(u) || /^\d{2}[-/]\d{2}$/.test(u);
};
// Colonne « référence » d'une réception : plusieurs libellés possibles selon l'export.
const isRefHeader = (h: string): boolean =>
  h === "FULL MCS PRODUCT REF" ||
  h === "REFERENCE" || h === "RÉFÉRENCE" || h === "REF" ||
  h === "CODE PRODUIT FINI" || h.includes("PRODUCT REF");
// Colonnes du format « LONG » : une ligne PAR TAILLE (la taille et la quantité sont des
// VALEURS, pas des colonnes). Ex. : REFERENCE | COULEUR | … | Taille | Quantité.
const isSizeColHeader = (h: string): boolean => h === "TAILLE" || h === "SIZE";
const isQtyColHeader = (h: string): boolean =>
  h.startsWith("QUANTIT") || h === "QTE" || h === "QTÉ" || h === "QTY";

// En-tête d'une réception (liste de colisage), 2 dispositions possibles :
//  - LARGE : une colonne par taille (≥ 2 colonnes de tailles) ;
//  - LONG  : une ligne par taille (colonnes « Taille » + « Quantité »).
const isWidePackingListHeader = (cells: string[]): boolean =>
  cells.some(isRefHeader) && cells.filter(isSizeHeader).length >= 2;
const isLongPackingListHeader = (cells: string[]): boolean =>
  cells.some(isRefHeader) && cells.some(isSizeColHeader) && cells.some(isQtyColHeader);
const isPackingListHeader = (cells: string[]): boolean =>
  isWidePackingListHeader(cells) || isLongPackingListHeader(cells);

// ---------------------------------------------------------------- détection
export function detectMcsFormat(buffer: ArrayBuffer): McsFormat | null {
  for (const { grid } of eachSheet(buffer)) {
    for (let r = 0; r < Math.min(grid.length, 30); r++) {
      const cells = (grid[r] || []).map(up);
      if (cells.includes("FULL MCS PRODUCT REF")) return "packing-list";
      if (isStatgenHeader(cells)) return "statgen";
      if (isClientOrderHeader(cells)) return "client-order";
      if (isPackingListHeader(cells)) return "packing-list";
    }
  }
  return null;
}

// ---------------------------------------------------------------- StatGen
export interface McsSupplierLine {
  orderNumber: string;
  supplierCode: string;
  season: string; // code saison lu dans le fichier (colonne « Saison » : W26, S27…)
  reference: string;
  colorCode: string;
  colorName: string;
  quantities: number[]; // dans l'ordre des colonnes Q.1..Q.n (positions)
  // Décodage par tailles reconstruit DEPUIS le fichier (légende « gamme » + Taille
  // début/fin). Présents quand le fichier fournit ces infos → autorité sur les tailles
  // (les Q.N sont des positions ABSOLUES dans la gamme, pas compactées par couleur).
  sizes?: Record<string, number>; // { "M": 3, "L": 5, ... } (quantités > 0)
  sizeScale?: string; // "M,L,XL,2XL" — sous-plage de la gamme propre à ce coloris
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
    // Fournisseur : « Fiche fournisseur » (ancien) ou « Code fournisseur » (nouvel export).
    // On évite « N° commande PF fournisseur » qui contient aussi le mot « fournisseur ».
    let cSupplier = header.indexOf("FICHE FOURNISSEUR");
    if (cSupplier < 0) cSupplier = header.findIndex((hh) => hh.includes("CODE FOURNISSEUR"));
    if (cSupplier < 0)
      cSupplier = header.findIndex((hh) => hh.includes("FOURNISSEUR") && !hh.includes("COMMANDE"));
    const cRef = header.indexOf("FICHE PRODUIT FINI");
    const cColor = header.findIndex((hh) => hh.includes("COLORIS"));
    // Code saison porté par le fichier (« Saison » = W26/S27…). Distinct de la saison GestLog.
    let cSeason = header.indexOf("SAISON");
    if (cSeason < 0) cSeason = header.findIndex((hh) => hh.includes("SAISON") && !hh.includes("CODE"));
    const qCols: number[] = [];
    header.forEach((hh, i) => {
      if (/^Q\.\s*\d+$/.test(hh)) qCols.push(i);
    });
    // Colonnes servant à reconstruire la grille de tailles (pour créer les produits
    // absents et décoder correctement les quantités) :
    //  - « Total Q » : dans les lignes de LÉGENDE (réf vide) elle porte le code gamme.
    //  - « Clé Langue+Gamme » : code gamme du produit (préfixé « FRA »).
    //  - « Taille début » / « Taille fin » : sous-plage de positions du coloris.
    const cLegendCode = header.indexOf("TOTAL Q");
    const cGamme = header.findIndex((hh) => hh.includes("LANGUE+GAMME"));
    const cDeb = header.findIndex((hh) => hh.includes("TAILLE DÉBUT") || hh.includes("TAILLE DEBUT"));
    const cFin = header.findIndex((hh) => hh.includes("TAILLE FIN"));

    // Légende : lignes en tête (réf vide) → code gamme (col « Total Q ») + tailles (cols Q.N).
    const legend = new Map<string, string[]>();
    if (cLegendCode >= 0) {
      for (let r = h + 1; r < grid.length; r++) {
        const row = grid[r] || [];
        if (norm(row[cRef])) break; // 1re ligne produit → fin de la légende
        const codeUp = up(row[cLegendCode]);
        if (!codeUp) continue;
        const sizes = qCols.map((ci) => norm(row[ci])).filter(Boolean);
        if (sizes.length) legend.set(codeUp, sizes);
      }
    }
    const canDecode = legend.size > 0 && cGamme >= 0 && cDeb >= 0 && cFin >= 0;

    const lines: McsSupplierLine[] = [];
    for (let r = h + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      const reference = norm(row[cRef]);
      // saute les lignes de légende de tailles (référence vide), les vides et les totaux
      if (!reference || reference.toUpperCase() === "TOTAL") continue;
      // Si le fichier a une colonne n° de commande, elle doit être remplie ; sinon
      // (export sans n° de commande) le n° sera fourni à l'import (importOrderNumber).
      const orderNumber = cOrder >= 0 ? norm(row[cOrder]) : "";
      if (cOrder >= 0 && !orderNumber) continue;
      const { code, name } = splitColor(row[cColor]);
      const quantities = qCols.map((ci) => {
        const v = row[ci];
        const n = typeof v === "number" ? v : parseInt(String(v || "0"), 10);
        return isNaN(n) ? 0 : n;
      });

      // Reconstruction des tailles depuis la gamme (positions ABSOLUES).
      let sizes: Record<string, number> | undefined;
      let sizeScale: string | undefined;
      if (canDecode) {
        const gamme = up(row[cGamme]).replace(/^FRA/, "");
        const full = legend.get(gamme);
        const deb = parseInt(String(row[cDeb]), 10);
        const fin = parseInt(String(row[cFin]), 10);
        if (full && deb >= 1 && fin >= deb && fin <= full.length) {
          sizeScale = full.slice(deb - 1, fin).join(",");
          sizes = {};
          for (let p = deb; p <= fin; p++) {
            const q = quantities[p - 1] || 0; // Q.p = position absolue p dans la gamme
            if (q > 0) sizes[full[p - 1]] = q;
          }
        }
      }

      lines.push({
        orderNumber,
        supplierCode: norm(row[cSupplier]),
        season: cSeason >= 0 ? up(row[cSeason]) : "",
        reference,
        colorCode: code,
        colorName: name,
        quantities,
        ...(sizes ? { sizes } : {}),
        ...(sizeScale ? { sizeScale } : {}),
      });
    }
    if (lines.length) return lines;
  }
  return [];
}

// ---------------------------------------------------------------- Commande client
export interface McsClientLine {
  orderNumber: string;
  clientCode: string;
  clientName: string;
  reference: string;
  colorCode: string;
  colorName: string;
  quantities: number[];
}

export function parseMcsClientOrders(buffer: ArrayBuffer): McsClientLine[] {
  for (const { grid } of eachSheet(buffer)) {
    let h = -1;
    for (let r = 0; r < Math.min(grid.length, 10); r++) {
      if (isClientOrderHeader((grid[r] || []).map(up))) {
        h = r;
        break;
      }
    }
    if (h === -1) continue;

    const header = (grid[h] || []).map(up);
    const cOrder = header.findIndex((hh) => hh.includes("COMMANDE")); // "N° commande client"
    const cClient = header.indexOf("FICHE CLIENT");
    const cName = header.findIndex((hh) => hh.includes("RAISON SOCIALE"));
    const cRef = header.indexOf("FICHE PRODUIT FINI");
    const cColor = header.findIndex((hh) => hh.includes("COLORIS"));
    const qCols: number[] = [];
    header.forEach((hh, i) => {
      if (/^Q\.\s*\d+$/.test(hh)) qCols.push(i);
    });

    const lines: McsClientLine[] = [];
    for (let r = h + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      const orderNumber = norm(row[cOrder]);
      const reference = norm(row[cRef]);
      if (!orderNumber || !reference || reference.toUpperCase() === "TOTAL") continue;
      const { code, name } = splitColor(row[cColor]);
      lines.push({
        orderNumber,
        clientCode: norm(row[cClient]),
        clientName: cName >= 0 ? norm(row[cName]) : "",
        reference,
        colorCode: code,
        colorName: name,
        quantities: qCols.map((ci) => {
          const v = row[ci];
          const n = typeof v === "number" ? v : parseInt(String(v || "0"), 10);
          return isNaN(n) ? 0 : n;
        }),
      });
    }
    if (lines.length) return lines;
  }
  return [];
}

// ---------------------------------------------------------------- Texas (ERP) commande client
// Variant StatGen « commande client » exporté par l'ERP Texas : colonne « Saison »,
// client via « Code client(Commande client) » (pas de nom), décodage Q.N ABSOLU par
// gamme (comme les commandes fournisseur). C'est la source de VÉRITÉ pour la répartition.
export interface TexasClientLine {
  orderNumber: string;
  // « Référence commande client » : le n° que la commande porte côté TIO (PO-… pour une
  // commande de catalogue, IS-… pour un réassort). C'est le SEUL lien entre les deux
  // sources — les n° de commande Texas et TIO sont totalement disjoints.
  tioOrderNumber: string;
  clientCode: string;
  season: string; // code saison du fichier (W26…)
  reference: string;
  colorCode: string;
  colorName: string;
  amount: number; // montant NET commandé de la commande (répété sur chaque ligne)
  sold: boolean; // commande soldée ?
  quantities: number[];
  sizes?: Record<string, number>;
  sizeScale?: string;
}

// En-tête Texas : réf produit + n° commande client + code client (Commande client).
const isTexasClientHeader = (cells: string[]): boolean =>
  cells.includes("FICHE PRODUIT FINI") &&
  cells.some((c) => c.includes("N° COMMANDE CLIENT") || c === "N° COMMANDE CLIENT") &&
  cells.some((c) => c.includes("CODE CLIENT") && c.includes("COMMANDE"));

export function parseTexasClientOrders(buffer: ArrayBuffer): TexasClientLine[] {
  for (const { grid } of eachSheet(buffer)) {
    let h = -1;
    for (let r = 0; r < Math.min(grid.length, 10); r++) {
      if (isTexasClientHeader((grid[r] || []).map(up))) {
        h = r;
        break;
      }
    }
    if (h === -1) continue;

    const header = (grid[h] || []).map(up);
    const cRef = header.indexOf("FICHE PRODUIT FINI");
    const cColor = header.findIndex((hh) => hh.includes("COLORIS"));
    let cOrder = header.indexOf("N° COMMANDE CLIENT");
    if (cOrder < 0) cOrder = header.findIndex((hh) => hh.startsWith("N° COMMANDE") && !hh.includes("RÉFÉRENCE"));
    const cTioRef = header.findIndex((hh) => hh.startsWith("RÉFÉRENCE COMMANDE CLIENT") || hh.startsWith("REFERENCE COMMANDE CLIENT"));
    const cClient = header.findIndex((hh) => hh.includes("CODE CLIENT") && hh.includes("COMMANDE"));
    const cSeason = header.indexOf("SAISON");
    const cGamme = header.findIndex((hh) => hh.includes("LANGUE+GAMME"));
    const cDeb = header.findIndex((hh) => hh.includes("TAILLE DÉBUT") || hh.includes("TAILLE DEBUT"));
    const cFin = header.findIndex((hh) => hh.includes("TAILLE FIN"));
    const cAmount = header.findIndex((hh) => hh.includes("MONTANT COMMANDÉ NET TOTAL"));
    const cSold = header.findIndex((hh) => hh.includes("SOLDÉ") && hh.includes("COMMANDE CLIENT"));
    const cLegendCode = header.indexOf("TOTAL Q");
    const qCols: number[] = [];
    header.forEach((hh, i) => {
      if (/^Q\.\s*\d+$/.test(hh)) qCols.push(i);
    });

    // Légende gammes (lignes en tête, réf vide) : code dans « Total Q », tailles dans Q.N.
    const legend = new Map<string, string[]>();
    if (cLegendCode >= 0) {
      for (let r = h + 1; r < grid.length; r++) {
        if (norm(grid[r]?.[cRef])) break;
        const codeUp = up(grid[r]?.[cLegendCode]);
        if (!codeUp) continue;
        const sizes = qCols.map((ci) => norm(grid[r]?.[ci])).filter(Boolean);
        if (sizes.length) legend.set(codeUp, sizes);
      }
    }
    const canDecode = legend.size > 0 && cGamme >= 0 && cDeb >= 0 && cFin >= 0;

    const lines: TexasClientLine[] = [];
    for (let r = h + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      const reference = norm(row[cRef]);
      const orderNumber = cOrder >= 0 ? norm(row[cOrder]) : "";
      if (!reference || reference.toUpperCase() === "TOTAL" || !orderNumber) continue;
      const { code, name } = splitColor(row[cColor]);
      const quantities = qCols.map((ci) => {
        const v = row[ci];
        const n = typeof v === "number" ? v : parseInt(String(v || "0"), 10);
        return isNaN(n) ? 0 : n;
      });

      let sizes: Record<string, number> | undefined;
      let sizeScale: string | undefined;
      if (canDecode) {
        const gamme = up(row[cGamme]).replace(/^FRA/, "");
        const full = legend.get(gamme);
        const deb = parseInt(String(row[cDeb]), 10);
        const fin = parseInt(String(row[cFin]), 10);
        if (full && deb >= 1 && fin >= deb && fin <= full.length) {
          sizeScale = full.slice(deb - 1, fin).join(",");
          sizes = {};
          for (let p = deb; p <= fin; p++) {
            const q = quantities[p - 1] || 0;
            if (q > 0) sizes[full[p - 1]] = q;
          }
        }
      }

      const amtRaw = cAmount >= 0 ? row[cAmount] : 0;
      const amount = typeof amtRaw === "number" ? amtRaw : parseFloat(String(amtRaw || "0").replace(",", ".")) || 0;

      lines.push({
        orderNumber,
        tioOrderNumber: cTioRef >= 0 ? norm(row[cTioRef]) : "",
        clientCode: cClient >= 0 ? norm(row[cClient]) : "",
        season: cSeason >= 0 ? up(row[cSeason]) : "",
        reference,
        colorCode: code,
        colorName: name,
        amount,
        sold: cSold >= 0 ? up(row[cSold]) === "O" : false,
        quantities,
        ...(sizes ? { sizes } : {}),
        ...(sizeScale ? { sizeScale } : {}),
      });
    }
    if (lines.length) return lines;
  }
  return [];
}

// ---------------------------------------------------------------- Packing List
export interface McsReceptionLine {
  reference: string;
  colorCode: string;
  colorName: string;
  sizes: Record<string, number>; // par taille, déjà sommé sur toutes les lignes de colis
  // Lecture ALTERNATIVE des mêmes cellules, présente uniquement quand le fichier porte
  // DEUX lignes de libellés de tailles sur les MÊMES colonnes (lettres au-dessus de
  // l'en-tête ET numériques dans l'en-tête — cf. template CITIME/RASEN, où la colonne 9
  // vaut « L » pour une maille et « 31 » pour un jean). Le fichier seul ne permet pas de
  // trancher : c'est le mapper qui choisit via la grille du produit au référentiel.
  sizesAlt?: Record<string, number>;
}

type SizeCol = { col: number; size: string };

/**
 * Tranche entre les deux lectures d'une réception ambiguë (cf. `sizesAlt`) à l'aide de la
 * grille de tailles du produit au référentiel : on garde la lecture dont les tailles
 * appartiennent le plus à cette grille (un jean lit « 31 », une maille lit « L »).
 * Sans ambiguïté, ou sans grille exploitable, la lecture principale est conservée.
 */
export function pickReceptionSizes(
  line: McsReceptionLine,
  sizeScale?: string | null
): Record<string, number> {
  if (!line.sizesAlt) return line.sizes;
  const scale = new Set(
    (sizeScale || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
  );
  if (scale.size === 0) return line.sizes;
  const score = (sizes: Record<string, number>) => Object.keys(sizes).filter((s) => scale.has(s)).length;
  return score(line.sizesAlt) > score(line.sizes) ? line.sizesAlt : line.sizes;
}

// Parseur réception TOLÉRANT : trouve la ligne d'en-tête (contenant une colonne
// « référence », quel que soit son libellé), repère les colonnes couleur et tailles
// PAR NOM (l'ordre n'importe pas). Gère :
//  - le format simple (REFERENCE | COLOR | S | M | L | … | Qty), en-tête pas forcément
//    en ligne 0 (un titre peut être au-dessus) ;
//  - l'ancien format MCS (FULL MCS PRODUCT REF, tailles en LETTRES sur la ligne au-dessus) ;
//  - les tailles portées par l'en-tête lui-même (template CITIME : une seule colonne « TU ») ;
//  - la disposition LONGUE : une ligne par taille (colonnes « Taille » + « Quantité »).
export function parseMcsPackingList(buffer: ArrayBuffer): McsReceptionLine[] {
  for (const { grid } of eachSheet(buffer)) {
    let h = -1;
    for (let r = 0; r < grid.length; r++) {
      if ((grid[r] || []).map(up).some(isRefHeader)) {
        h = r;
        break;
      }
    }
    if (h === -1) continue;

    const header = (grid[h] || []).map(up);
    const cRef = header.findIndex(isRefHeader);
    // couleur : « COLOR CODE » en priorité, sinon COLOR / COULEUR / COLORIS (hors DESCR).
    let cCode = header.findIndex((s) => s.includes("COLOR") && s.includes("CODE"));
    if (cCode < 0)
      cCode = header.findIndex(
        (s) => (s.includes("COLOR") || s.includes("COULEUR") || s.includes("COLORIS")) && !s.includes("DESCR")
      );
    const cName = header.findIndex((s) => s.includes("DESCR") && s.includes("COLOR"));

    // Lignes de détail : jusqu'au récapitulatif (2e en-tête) ; hors lignes TOTAL.
    const rows: Cell[][] = [];
    for (let r = h + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      if (isRefHeader(up(row[cRef]))) break;
      const refCell = norm(row[cRef]);
      if (!refCell || refCell.toUpperCase() === "TOTAL") continue;
      rows.push(row);
    }
    if (rows.length === 0) continue;

    const aggregate = (read: (row: Cell[]) => [string, number][]): McsReceptionLine[] => {
      const agg = new Map<string, McsReceptionLine>();
      for (const row of rows) {
        const reference = norm(row[cRef]).replace(/-/g, "_"); // tiret → underscore
        // couleur = code (on retire un éventuel « -Nom »)
        const rawColor = norm(row[cCode]);
        const colorCode = rawColor.includes("-") ? rawColor.slice(0, rawColor.indexOf("-")).trim() : rawColor;
        const key = `${reference}__${colorCode}`;
        let entry = agg.get(key);
        if (!entry) {
          entry = { reference, colorCode, colorName: cName >= 0 ? norm(row[cName]) : "", sizes: {} };
          agg.set(key, entry);
        }
        for (const [size, n] of read(row)) entry.sizes[size] = (entry.sizes[size] || 0) + n;
      }
      return [...agg.values()].filter((e) => Object.keys(e.sizes).length > 0);
    };

    const colsFrom = (rowUp: string[]) => {
      const out: SizeCol[] = [];
      rowUp.forEach((lab, i) => {
        if (isSizeHeader(lab)) out.push({ col: i, size: lab.replace(/\s+/g, "").toUpperCase() });
      });
      return out;
    };
    // Deux lignes de libellés possibles : l'en-tête lui-même, et la ligne AU-DESSUS
    // (ancien format MCS, toujours en lettres).
    const inline = colsFrom(header);
    const above = h > 0 ? colsFrom((grid[h - 1] || []).map(up)).filter((x) => SIZE_LETTERS.has(x.size)) : [];

    // Disposition LONGUE : aucune colonne de taille, mais des colonnes « Taille » + « Quantité ».
    const cSizeCol = header.findIndex(isSizeColHeader);
    const cQtyCol = header.findIndex(isQtyColHeader);
    if (inline.length === 0 && above.length === 0) {
      if (cSizeCol < 0 || cQtyCol < 0) continue;
      const out = aggregate((row) => {
        const size = up(row[cSizeCol]).replace(/\s+/g, "");
        const v = row[cQtyCol];
        const n = typeof v === "number" ? v : parseInt(String(v || "0"), 10);
        return size && !isNaN(n) && n > 0 ? [[size, n]] : [];
      });
      if (out.length) return out;
      continue;
    }

    const readWide = (cols: SizeCol[]) => (row: Cell[]): [string, number][] => {
      const out: [string, number][] = [];
      for (const { col, size } of cols) {
        const v = row[col];
        const n = typeof v === "number" ? v : parseInt(String(v || "0"), 10);
        if (!isNaN(n) && n > 0) out.push([size, n]);
      }
      return out;
    };
    const pieces = (ls: McsReceptionLine[]) =>
      ls.reduce((s, l) => s + Object.values(l.sizes).reduce((a, b) => a + b, 0), 0);

    const vAbove = above.length ? aggregate(readWide(above)) : [];
    const vInline = inline.length ? aggregate(readWide(inline)) : [];
    // Lecture principale = celle qui capte le PLUS de pièces : une ligne de libellés qui ne
    // couvre pas toutes les colonnes remplies en perd (RASEN : les lettres s'arrêtent à
    // « 4XL » alors que le détail va jusqu'à la colonne « 46 »). À égalité, la ligne du
    // dessus l'emporte (comportement historique de l'ancien format MCS).
    const [primary, other] =
      pieces(vInline) > pieces(vAbove) ? [vInline, vAbove] : [vAbove, vInline];
    if (!primary.length) continue;
    if (!other.length) return primary;

    // Les deux lectures tiennent : mêmes cellules, libellés différents → on remonte les
    // deux et le mapper tranchera avec la grille du produit.
    const altByKey = new Map(other.map((l) => [`${l.reference}__${l.colorCode}`, l.sizes]));
    return primary.map((l) => {
      const alt = altByKey.get(`${l.reference}__${l.colorCode}`);
      return alt ? { ...l, sizesAlt: alt } : l;
    });
  }
  return [];
}

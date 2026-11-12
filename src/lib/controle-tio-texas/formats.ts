// Détection et lecture des fichiers déposés dans le contrôle TIO ↔ Texas.
// PUR (aucun accès base) : utilisable côté client pour prévisualiser, côté serveur
// pour l'analyse autoritaire.
//
// Trois dispositions sont reconnues :
//  - « texas »   : export commande client de l'ERP Texas (Q.N absolus + légende de gamme) ;
//  - « long »    : UNE LIGNE PAR TAILLE — c'est la forme de l'export GestLog
//                  « Commandes clients — détail par code-barres », et celle de tout
//                  fichier portant les colonnes commande / référence / taille / quantité ;
//  - « statgen » : export commande client TIO (Q.1..Q.16 RELATIFS à la grille du produit
//                  → le décodage par taille exige le référentiel, cf. normalise.ts).

import * as XLSX from "xlsx";

export type FormatControle = "texas" | "long" | "statgen";

type Cell = string | number | boolean | null | undefined;
type Grid = Cell[][];

const norm = (v: Cell): string => String(v ?? "").replace(/\s+/g, " ").trim();
const up = (v: Cell): string => norm(v).toUpperCase();
const nombre = (v: Cell): number => {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const s = String(v ?? "").replace(/\s| /g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
};

function feuilles(buffer: ArrayBuffer): { nom: string; grid: Grid }[] {
  const wb = XLSX.read(buffer, { type: "array" });
  return wb.SheetNames.map((nom) => ({
    nom,
    grid: XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[nom], {
      header: 1,
      defval: "",
      blankrows: true,
    }),
  }));
}

// ─────────────────────────────────────────────────── repérage des colonnes « long »

const estColTaille = (h: string) => h === "TAILLE" || h === "SIZE";
const estColQte = (h: string) =>
  h.startsWith("QUANTIT") ||
  h === "QTE" ||
  h === "QTÉ" ||
  h === "QTY" ||
  h === "PIECES" ||
  h === "PIÈCES";
const estColRef = (h: string) =>
  h === "FICHE PRODUIT FINI" ||
  ((/^R[EÉ]F[EÉ]RENCE/.test(h) || /^REF\b/.test(h)) &&
    !h.includes("COMMANDE") &&
    !h.includes("CLIENT"));
const estColCommande = (h: string) =>
  h.includes("COMMANDE") &&
  (h.includes("NUM") || h.startsWith("N°") || /R[EÉ]F[EÉ]RENCE/.test(h)) &&
  !h.includes("CODE CLIENT");

interface ColonnesLong {
  commande: number;
  reference: number;
  taille: number;
  quantite: number;
  codeCouleur: number;
  libelleCouleur: number;
  coloris: number; // colonne « Coloris » façon « 208-Cognac »
  codeClient: number;
  nomClient: number;
  prixUnitaire: number;
  montantLigne: number;
  montantCommande: number;
}

function reperColonnesLong(header: string[]): ColonnesLong | null {
  const find = (p: (h: string) => boolean) => header.findIndex(p);
  const cols: ColonnesLong = {
    commande: find(estColCommande),
    reference: find(estColRef),
    taille: find(estColTaille),
    quantite: find(estColQte),
    codeCouleur: find((h) => h === "CODE COULEUR" || h === "CODE COLORIS"),
    libelleCouleur: find((h) => h.startsWith("LIBELL") && h.includes("COULEUR")),
    coloris: find((h) => h === "COLORIS" || h === "COULEUR"),
    codeClient: find((h) => h === "CODE CLIENT" || h === "FICHE CLIENT"),
    nomClient: find((h) => h.includes("ENSEIGNE") || h.includes("RAISON SOCIALE")),
    prixUnitaire: find(
      (h) =>
        h.includes("PRIX") &&
        (h.includes("WHOLESALE") || h.includes("GROS") || h.includes("ACHAT"))
    ),
    montantLigne: find((h) => h.startsWith("MONTANT") && !h.includes("COMMAND")),
    montantCommande: find((h) => h.startsWith("MONTANT") && h.includes("COMMAND")),
  };
  const ok = cols.commande >= 0 && cols.reference >= 0 && cols.taille >= 0 && cols.quantite >= 0;
  return ok ? cols : null;
}

/** « 208-Cognac » → { code: "208", nom: "Cognac" } */
function separeColoris(brut: Cell): { code: string; nom: string } {
  const s = norm(brut);
  const i = s.indexOf("-");
  if (i === -1) return { code: s, nom: "" };
  return { code: s.slice(0, i).trim(), nom: s.slice(i + 1).trim() };
}

// ─────────────────────────────────────────────────── détection

const estEnteteTexas = (cells: string[]) =>
  cells.includes("FICHE PRODUIT FINI") &&
  cells.some((c) => c.includes("N° COMMANDE CLIENT")) &&
  cells.some((c) => c.includes("CODE CLIENT") && c.includes("COMMANDE"));

const estEnteteStatgen = (cells: string[]) =>
  cells.includes("FICHE CLIENT") && cells.includes("FICHE PRODUIT FINI");

/**
 * Format du fichier, ou null s'il n'est reconnu d'aucune façon.
 * L'ordre compte : le format Texas est le plus spécifique, il passe en premier.
 */
export function detecterFormat(buffer: ArrayBuffer): FormatControle | null {
  for (const { grid } of feuilles(buffer)) {
    for (let r = 0; r < Math.min(grid.length, 30); r++) {
      const cells = (grid[r] || []).map(up);
      if (estEnteteTexas(cells)) return "texas";
      if (reperColonnesLong(cells)) return "long";
      if (estEnteteStatgen(cells)) return "statgen";
    }
  }
  return null;
}

// ─────────────────────────────────────────────────── lecture du format « long »

export interface LigneLong {
  numeroCommande: string;
  codeClient: string;
  nomClient: string;
  reference: string;
  codeCouleur: string;
  libelleCouleur: string;
  taille: string;
  quantite: number;
  /** Montant de la LIGNE, quand le fichier donne un prix unitaire ou un montant. */
  montantLigne?: number;
  /** Montant de la COMMANDE, répété sur chaque ligne. */
  montantCommande?: number;
}

/**
 * Lit un fichier « une ligne par taille ». Les lignes sans n° de commande, sans
 * référence ou à quantité nulle sont écartées : une taille à 0 n'a pas été commandée,
 * et la ligne « Total » d'un export ne doit pas devenir une commande.
 */
export function lireFormatLong(buffer: ArrayBuffer): LigneLong[] {
  for (const { grid } of feuilles(buffer)) {
    let h = -1;
    let cols: ColonnesLong | null = null;
    for (let r = 0; r < Math.min(grid.length, 30); r++) {
      const c = reperColonnesLong((grid[r] || []).map(up));
      if (c) {
        h = r;
        cols = c;
        break;
      }
    }
    if (h === -1 || !cols) continue;

    const out: LigneLong[] = [];
    for (let r = h + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      const numeroCommande = norm(row[cols.commande]);
      const reference = norm(row[cols.reference]);
      const taille = norm(row[cols.taille]);
      if (!numeroCommande || !reference) continue;
      if (reference.toUpperCase() === "TOTAL" || numeroCommande.toUpperCase() === "TOTAL") continue;
      const quantite = Math.round(nombre(row[cols.quantite]));
      if (quantite === 0) continue;

      let codeCouleur = cols.codeCouleur >= 0 ? norm(row[cols.codeCouleur]) : "";
      let libelleCouleur = cols.libelleCouleur >= 0 ? norm(row[cols.libelleCouleur]) : "";
      if (!codeCouleur && cols.coloris >= 0) {
        const c = separeColoris(row[cols.coloris]);
        codeCouleur = c.code;
        if (!libelleCouleur) libelleCouleur = c.nom;
      }

      const prix = cols.prixUnitaire >= 0 ? nombre(row[cols.prixUnitaire]) : 0;
      const mLigne = cols.montantLigne >= 0 ? nombre(row[cols.montantLigne]) : 0;
      const mCommande = cols.montantCommande >= 0 ? nombre(row[cols.montantCommande]) : 0;

      out.push({
        numeroCommande,
        codeClient: cols.codeClient >= 0 ? norm(row[cols.codeClient]) : "",
        nomClient: cols.nomClient >= 0 ? norm(row[cols.nomClient]) : "",
        reference,
        codeCouleur,
        libelleCouleur,
        taille,
        quantite,
        ...(mLigne > 0
          ? { montantLigne: mLigne }
          : prix > 0
            ? { montantLigne: Math.round(prix * quantite * 100) / 100 }
            : {}),
        ...(mCommande > 0 ? { montantCommande: mCommande } : {}),
      });
    }
    if (out.length) return out;
  }
  return [];
}

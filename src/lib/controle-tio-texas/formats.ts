// Détection et lecture des fichiers déposés dans le contrôle TIO ↔ Texas.
// PUR (aucun accès base) : utilisable côté client pour prévisualiser, côté serveur
// pour l'analyse autoritaire.
//
// Quatre dispositions sont reconnues :
//  - « texas »        : export commande client de l'ERP Texas (Q.N absolus + légende de gamme) ;
//  - « color-orders » : export CSV TIO « commandes à la couleur » — une ligne par commande ×
//                       produit × coloris, quantités en colonnes T0..T12 POSITIONNELLES ;
//  - « long »         : UNE LIGNE PAR TAILLE — c'est la forme de l'export GestLog
//                       « Commandes clients — détail par code-barres », et celle de tout
//                       fichier portant les colonnes commande / référence / taille / quantité ;
//  - « statgen »      : export commande client TIO (Q.1..Q.16 RELATIFS à la grille du produit
//                       → le décodage par taille exige le référentiel, cf. normalise.ts).

import * as XLSX from "xlsx";
import { splitCsvLine } from "@/lib/recoupement";

export type FormatControle = "texas" | "color-orders" | "long" | "statgen";

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
  // Le CSV « commandes à la couleur » est reconnu sur son texte : le passer à SheetJS
  // en espérant qu'il devine le point-virgule serait un pari inutile.
  const texte = texteSiPasBinaire(buffer);
  if (texte && estEnteteColorOrders(texte)) return "color-orders";

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

// ─────────────────────────────────────────────── CSV TIO « commandes à la couleur »

/**
 * Texte du fichier, ou null s'il s'agit d'un classeur binaire.
 *
 * Les exports TIO sortent en UTF-8 (avec BOM), mais un CSV français peut arriver en
 * Windows-1252 : on le détecte au caractère de remplacement et on redécode, sinon tous
 * les en-têtes accentués seraient méconnaissables.
 */
function texteSiPasBinaire(buffer: ArrayBuffer): string | null {
  const vue = new Uint8Array(buffer);
  if (vue.length < 4) return null;
  if (vue[0] === 0x50 && vue[1] === 0x4b) return null; // .xlsx = archive ZIP (« PK »)
  if (vue[0] === 0xd0 && vue[1] === 0xcf) return null; // .xls = conteneur OLE2
  try {
    let texte = new TextDecoder("utf-8").decode(vue);
    if (texte.includes("�")) {
      try {
        texte = new TextDecoder("windows-1252").decode(vue);
      } catch {
        /* on garde le décodage UTF-8 */
      }
    }
    return texte.includes("\u0000") ? null : texte;
  } catch {
    return null;
  }
}

/** Minuscules sans accents : un en-tête se reconnaît quel que soit son habillage. */
const sansAccent = (s: string) =>
  s
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

function premiereLigne(texte: string): string {
  const i = texte.search(/\r?\n/);
  return i === -1 ? texte : texte.slice(0, i);
}

const estEnteteColorOrders = (texte: string): boolean => {
  const h = sansAccent(premiereLigne(texte));
  return (
    h.includes("numero de commande") &&
    h.includes("quantite a la couleur") &&
    h.includes("reference produit")
  );
};

export interface LigneColorOrders {
  numeroCommande: string;
  /** « confirmed », « cancel »… tel quel : l'exclusion se décide dans normalise.ts. */
  statut: string;
  codeClient: string;
  nomClient: string;
  catalogue: string;
  reference: string;
  nomProduit: string;
  codeCouleur: string;
  libelleCouleur: string;
  typeTaille: string;
  /** Quantités dans l'ordre des colonnes T0..Tn — POSITIONNEL, voir normalise.ts. */
  quantitesParPosition: number[];
  /** « Quantité à la couleur ». */
  quantite: number;
  /**
   * « Montant total » de la ligne — NET, remise déjà appliquée.
   *
   * 🔴 NE JAMAIS LE RECALCULER depuis « Prix unitaire HT », ni y réappliquer « Remise
   * couleur ». *Mesuré sur l'export du 12/11/2026 (5 934 lignes) : 1 139 lignes portent
   * une remise non nulle alors que `Montant total` vaut exactement prix unitaire × quantité
   * — la remise est donc DÉJÀ dans le prix. Et le prix affiché est arrondi au centime :
   * 33,61 × 14 donnerait 470,54 € là où le fichier dit 470,47 € (prix réel 33,605). Les
   * 915 lignes qui « ne tombent pas juste » ne sont que cet arrondi.*
   */
  montant: number;
}

/**
 * Découpe un CSV en ENREGISTREMENTS, en respectant les retours à la ligne contenus DANS
 * un champ entre guillemets.
 *
 * 🔴 Un découpage ligne par ligne ne suffit pas. *Mesuré sur l'export du 12/11/2026 :
 * 75 des 5 934 enregistrements portent un « Modalités de paiement » rédigé sur deux
 * lignes (« Quand toute la marchandise est prête. / 1 seul envoi. »). Cette colonne
 * précède les colonnes de tailles T0..T12 : découpé à la ligne, l'enregistrement perdait
 * ses tailles en silence — 75 lignes sur 5 897 dont la répartition était muette.*
 */
function decouperCsv(texte: string, sep: string): string[][] {
  const out: string[][] = [];
  let champ = "";
  let enreg: string[] = [];
  let dansGuillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (dansGuillemets) {
      if (c === '"') {
        if (texte[i + 1] === '"') {
          champ += '"'; // guillemet doublé = guillemet littéral
          i++;
        } else dansGuillemets = false;
      } else champ += c;
      continue;
    }
    if (c === '"') {
      dansGuillemets = true;
    } else if (c === sep) {
      enreg.push(champ);
      champ = "";
    } else if (c === "\n") {
      enreg.push(champ);
      out.push(enreg);
      enreg = [];
      champ = "";
    } else if (c !== "\r") {
      champ += c;
    }
  }
  if (champ !== "" || enreg.length > 0) {
    enreg.push(champ);
    out.push(enreg);
  }
  return out.filter((e) => e.some((v) => v.trim() !== ""));
}

/**
 * Lit l'export CSV TIO « commandes à la couleur » : une ligne par commande × produit ×
 * coloris, les quantités réparties dans les colonnes T0..T12.
 */
export function lireColorOrders(texte: string): LigneColorOrders[] {
  // Le séparateur se devine sur la ligne d'en-tête, qui n'est jamais multiligne.
  const sep = [";", ",", "\t"]
    .map((c) => [c, splitCsvLine(premiereLigne(texte), c).length] as const)
    .sort((a, b) => b[1] - a[1])[0][0];
  const enregistrements = decouperCsv(texte, sep);
  if (enregistrements.length < 2) return [];
  const header = enregistrements[0].map(sansAccent);
  const col = (...noms: string[]) => {
    for (const n of noms) {
      const i = header.indexOf(sansAccent(n));
      if (i >= 0) return i;
    }
    return -1;
  };

  const iCmd = col("Numéro de commande", "N° de commande");
  const iStatut = col("Statut de commande");
  const iEnseigne = col("Nom d'enseigne");
  const iBoutique = col("Référence boutique");
  const iCatalogue = col("Nom du catalogue de vente");
  const iRef = col("Référence produit");
  const iNom = col("Nom produit");
  const iCode = col("Code couleur");
  const iCouleur = col("Nom de la couleur");
  const iType = col("Type de taille");
  const iQte = col("Quantité à la couleur");
  const iMontant = col("Montant total");
  if (iCmd < 0 || iRef < 0 || iQte < 0) return [];

  // Colonnes T0..Tn, triées par leur indice (et non par leur position physique).
  const tCols: { n: number; i: number }[] = [];
  header.forEach((h, i) => {
    const m = /^t(\d+)$/.exec(h);
    if (m) tCols.push({ n: parseInt(m[1], 10), i });
  });
  tCols.sort((a, b) => a.n - b.n);

  const out: LigneColorOrders[] = [];
  for (const c of enregistrements.slice(1)) {
    const reference = (c[iRef] ?? "").trim();
    const numeroCommande = (c[iCmd] ?? "").trim();
    if (!reference || !numeroCommande) continue;
    const quantite = Math.round(nombre(c[iQte]));
    if (quantite <= 0) continue;

    out.push({
      numeroCommande,
      statut: iStatut >= 0 ? (c[iStatut] ?? "").trim() : "",
      codeClient: iBoutique >= 0 ? (c[iBoutique] ?? "").trim() : "",
      nomClient: iEnseigne >= 0 ? (c[iEnseigne] ?? "").trim() : "",
      catalogue: iCatalogue >= 0 ? (c[iCatalogue] ?? "").trim() : "",
      reference,
      nomProduit: iNom >= 0 ? (c[iNom] ?? "").trim() : "",
      codeCouleur: iCode >= 0 ? (c[iCode] ?? "").trim() : "",
      libelleCouleur: iCouleur >= 0 ? (c[iCouleur] ?? "").trim() : "",
      typeTaille: iType >= 0 ? (c[iType] ?? "").trim() : "",
      quantitesParPosition: tCols.map((t) => Math.round(nombre(c[t.i]))),
      quantite,
      montant: iMontant >= 0 ? nombre(c[iMontant]) : 0,
    });
  }
  return out;
}

/** Le texte d'un fichier CSV, pour les lecteurs qui travaillent sur du texte. */
export function texteCsv(buffer: ArrayBuffer): string | null {
  return texteSiPasBinaire(buffer);
}

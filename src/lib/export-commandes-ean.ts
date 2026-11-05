// Export « commandes clients + infos produits + EAN ».
//
// Entrée : l'export TIO « commandes EAN » — une ligne par commande × produit × coloris ×
// TAILLE, avec son code-barres. Sortie : UN onglet, 14 colonnes dans l'ordre demandé, de
// l'EAN à l'enseigne, où le référentiel GestLog complète ce que le fichier ne porte pas :
// le PRIX DE VENTE CONSEILLÉ et le CODE CLIENT.
//
// 🔴 LES COLONNES PERSONNELLES NE SORTENT PAS. Le fichier source porte le nom, le prénom,
// le genre et l'e-mail du client ET du responsable commercial, plus les adresses de
// facturation (35 colonnes au total). Les 14 colonnes de sortie sont une LISTE BLANCHE
// explicite, pas un filtrage : rien d'autre ne peut passer, même si TIO ajoute des
// colonnes à son export.
//
// 🔴 « Prix à la variation » PORTE DÉJÀ LA REMISE. *Mesuré sur les 16 références des
// exports TIO des 28 et 29/09/2026 : le prix du fichier vaut exactement
// `Product.costPrice × 0,6`, et « Réduction à la variation » vaut 40 sur toutes les
// lignes.* Autrement dit le tarif de gros du catalogue (133 € sur PMMANT_S010) donne les
// 79,80 € facturés. Il ne faut donc PAS redéduire les 40 % : ce serait la deuxième fois.
// Le choix du prix wholesale reste explicite (`wholesaleSource`), parce que « prix du
// catalogue » et « prix facturé sur cette commande » sont deux questions différentes.
//
// 🔴 L'EAN RESTE DU TEXTE. Un code-barres à 13 chiffres converti en nombre s'affiche
// « 3,66525E+12 » dans Excel et perd ses zéros de tête. Toutes les cellules EAN sont donc
// des chaînes — y compris celles complétées depuis le référentiel.

import { splitCsvLine } from "@/lib/export-ean-suppliers";

/** Les 14 colonnes de sortie, dans l'ordre demandé. */
export const COLONNES = [
  "EAN",
  "Référence produit",
  "Nom produit",
  "Libellé couleur",
  "Code couleur",
  "Taille",
  "Quantité commandée",
  "Catégorie",
  "Sous-catégorie",
  "Prix wholesale",
  "Prix de vente conseillé",
  "Numéro de commande client",
  "Code client",
  "Enseigne client",
] as const;

/** Index des colonnes numériques de la sortie (quantité, puis les deux prix). */
export const COLONNE_QUANTITE = 6;
export const COLONNE_PRIX_WHOLESALE = 9;
export const COLONNE_PRIX_CONSEILLE = 10;

/** Une cellule de sortie : texte, ou nombre pour la quantité et les prix. */
export type Cell = string | number;

const norm = (s: string) =>
  String(s ?? "")
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Lit un nombre écrit « 79.80 » ou « 79,80 ». Rend null plutôt que 0 : un prix absent
 *  n'est pas un prix nul, et une cellule vide le dit mieux qu'un « 0,00 € ». */
export function parsePrix(v: unknown): number | null {
  const brut = String(v ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!brut) return null;
  const n = Number(brut);
  return Number.isFinite(n) ? n : null;
}

/** Clé d'un coloris : référence + code couleur. */
export const cleColoris = (reference: string, colorCode: string) =>
  `${norm(reference)}|${norm(colorCode)}`;

/** Clé d'une taille : référence + code couleur + taille. */
export const cleTaille = (reference: string, colorCode: string, size: string) =>
  `${norm(reference)}|${norm(colorCode)}|${norm(size)}`;

/** Une ligne du fichier source, réduite à ce dont l'export a besoin. */
export interface LigneCommande {
  ean: string;
  reference: string;
  productName: string;
  colorLabel: string;
  colorCode: string;
  size: string;
  quantity: number;
  category: string;
  subCategory: string;
  /** « Prix à la variation » : le prix facturé sur cette commande (remise comprise). */
  price: number | null;
  /** « Réduction à la variation », en %, conservée pour le diagnostic uniquement. */
  discount: number | null;
  orderNumber: string;
  shop: string;
}

export interface LectureCommandes {
  lignes: LigneCommande[];
  /** Nombre de lignes du fichier, avant tout écart (quantité nulle…). */
  lues: number;
  /** Colonnes indispensables manquantes, par leur nom attendu. */
  manquantes: string[];
  /** Lignes écartées faute de référence, ou à quantité nulle/négative. */
  ecartees: number;
}

/**
 * Lit l'export TIO « commandes EAN ». Les colonnes sont repérées PAR NOM : « Référence
 * produit » y figure DEUX FOIS (positions 20 et 27 sur l'export du 29/09/2026) et l'ordre
 * change d'un export à l'autre. La première occurrence l'emporte.
 */
export function parseCommandesEanCsv(text: string): LectureCommandes {
  const vide: LectureCommandes = { lignes: [], lues: 0, manquantes: [], ecartees: 0 };
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  if (lines.length < 2) return vide;

  // Séparateur : celui qui découpe l'en-tête en le plus de colonnes.
  const sep = [";", ",", "\t"]
    .map((s) => ({ s, n: splitCsvLine(lines[0], s).length }))
    .sort((a, b) => b.n - a.n)[0].s;
  const header = splitCsvLine(lines[0], sep).map(norm);
  const at = (...noms: string[]) => {
    for (const n of noms) {
      const i = header.indexOf(norm(n));
      if (i >= 0) return i;
    }
    return -1;
  };

  const idx = {
    reference: at("Référence produit", "Référence", "Reference produit"),
    size: at("Taille"),
    quantity: at("Quantité", "Quantite", "Qté"),
    ean: at("EAN"),
    productName: at("Nom produit", "Désignation", "Libellé produit"),
    colorLabel: at("Nom de la couleur", "Libellé couleur", "Couleur"),
    colorCode: at("Code couleur"),
    category: at("Catégorie produit", "Catégorie"),
    subCategory: at("Sous-catégorie produit", "Sous-catégorie"),
    price: at("Prix à la variation", "Prix unitaire HT", "Prix unitaire"),
    discount: at("Réduction à la variation", "Remise couleur", "Remise"),
    orderNumber: at("Numéro de commande", "N° de commande"),
    shop: at("Nom d'enseigne", "Enseigne"),
  };

  // Sans ces quatre colonnes, ce n'est pas le bon export : une ligne par TAILLE est la
  // granularité même de cet export (l'export « à la couleur » met les tailles en colonnes
  // T0…T11 et ne porte aucun EAN — il ne peut pas servir ici).
  const manquantes: string[] = [];
  if (idx.reference < 0) manquantes.push("Référence produit");
  if (idx.size < 0) manquantes.push("Taille");
  if (idx.quantity < 0) manquantes.push("Quantité");
  if (idx.orderNumber < 0) manquantes.push("Numéro de commande");
  if (manquantes.length > 0) return { ...vide, lues: lines.length - 1, manquantes };

  const g = (c: string[], i: number) => (i >= 0 ? String(c[i] ?? "").trim() : "");
  const lignes: LigneCommande[] = [];
  let ecartees = 0;
  for (const l of lines.slice(1)) {
    const c = splitCsvLine(l, sep);
    const reference = g(c, idx.reference);
    const quantity = Number(g(c, idx.quantity).replace(",", ".")) || 0;
    // Une ligne sans référence n'est rattachable à rien ; une quantité nulle n'est pas une
    // commande. Les deux sont comptées, pas effacées en silence.
    if (!reference || quantity <= 0) {
      ecartees++;
      continue;
    }
    lignes.push({
      reference,
      quantity,
      ean: g(c, idx.ean),
      productName: g(c, idx.productName),
      colorLabel: g(c, idx.colorLabel),
      colorCode: g(c, idx.colorCode),
      size: g(c, idx.size),
      category: g(c, idx.category),
      subCategory: g(c, idx.subCategory),
      price: parsePrix(g(c, idx.price)),
      discount: parsePrix(g(c, idx.discount)),
      orderNumber: g(c, idx.orderNumber),
      shop: g(c, idx.shop),
    });
  }
  return { lignes, lues: lines.length - 1, manquantes: [], ecartees };
}

/** Ce que le référentiel GestLog ajoute, par coloris puis par référence. */
export interface InfosReferentiel {
  /** `cleColoris()` → libellé couleur, catégorie, sous-catégorie du coloris. */
  colorisInfo?: Record<string, { colorLabel?: string; category?: string; subCategory?: string }>;
  /** Référence → prix catalogue. Les prix TIO sont portés par le PRODUIT, pas le coloris. */
  prixParReference?: Record<string, { salePrice?: number | null; costPrice?: number | null }>;
  /** `cleTaille()` → EAN, pour compléter les lignes dont le fichier n'en porte pas. */
  eans?: Record<string, string>;
  /** Numéro de commande → code client (`Client.code`). */
  codesClient?: Record<string, string>;
}

export interface OptionsExport extends InfosReferentiel {
  /**
   * Origine du prix wholesale :
   *  • "commande" (défaut) — « Prix à la variation » du fichier : le prix FACTURÉ sur cette
   *    commande, remise comprise ;
   *  • "catalogue" — `Product.costPrice`, le tarif de gros du catalogue, avant remise.
   */
  wholesaleSource?: "commande" | "catalogue";
}

export interface ExportCommandes {
  header: string[];
  rows: Cell[][];
  /** Pièces commandées (somme des quantités). */
  pieces: number;
  /** Lignes dont la colonne EAN est restée vide. */
  sansEan: number;
  /** Lignes dont l'EAN vient du référentiel et non du fichier. */
  eansCompletes: number;
  /** Lignes sans prix wholesale exploitable. */
  sansPrixWholesale: number;
  /** Lignes sans prix de vente conseillé. */
  sansPrixConseille: number;
  /** Références distinctes, triées. */
  references: string[];
  /** Références sans prix de vente conseillé au référentiel, triées. */
  referencesSansPrixConseille: string[];
  /** Numéros de commande sans code client au référentiel, triés. */
  commandesSansCodeClient: string[];
  /** Commandes distinctes, triées. */
  commandes: string[];
  /** Montant wholesale total (prix wholesale × quantité), arrondi à l'euro-cent. */
  totalWholesale: number;
}

const euros = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Construit les 14 colonnes. Chaque champ est pris dans le FICHIER en premier (il porte la
 * vérité de la commande), et complété par le référentiel quand le fichier est muet. Une
 * valeur introuvable laisse la cellule VIDE : la ligne n'est jamais retirée, et aucune
 * valeur n'est inventée.
 */
export function buildCommandesEanExport(
  lignes: LigneCommande[],
  options: OptionsExport = {}
): ExportCommandes {
  const colorisInfo = options.colorisInfo ?? {};
  const prixParReference = options.prixParReference ?? {};
  const eans = options.eans ?? {};
  const codesClient = options.codesClient ?? {};
  const catalogue = options.wholesaleSource === "catalogue";

  const refs = new Set<string>();
  const commandes = new Set<string>();
  const sansConseille = new Set<string>();
  const sansCode = new Set<string>();
  let pieces = 0;
  let sansEan = 0;
  let eansCompletes = 0;
  let sansPrixWholesale = 0;
  let sansPrixConseille = 0;
  let totalWholesale = 0;

  const rows: Cell[][] = lignes.map((l) => {
    refs.add(l.reference);
    if (l.orderNumber) commandes.add(l.orderNumber);
    pieces += l.quantity;

    const coloris = colorisInfo[cleColoris(l.reference, l.colorCode)] ?? {};
    const prix = prixParReference[norm(l.reference)] ?? {};

    // EAN : celui du fichier d'abord ; à défaut, celui du référentiel pour cette taille.
    let ean = l.ean;
    if (!ean) {
      const trouve = eans[cleTaille(l.reference, l.colorCode, l.size)];
      if (trouve) {
        ean = trouve;
        eansCompletes++;
      } else sansEan++;
    }

    const wholesale = catalogue ? (prix.costPrice ?? null) : l.price;
    if (wholesale === null || wholesale === undefined) sansPrixWholesale++;
    else totalWholesale = euros(totalWholesale + euros(wholesale * l.quantity));

    const conseille = prix.salePrice ?? null;
    if (conseille === null || conseille === undefined) {
      sansPrixConseille++;
      sansConseille.add(l.reference);
    }

    const codeClient = l.orderNumber ? codesClient[norm(l.orderNumber)] || "" : "";
    if (!codeClient && l.orderNumber) sansCode.add(l.orderNumber);

    return [
      ean, // texte : jamais converti en nombre (cf. en-tête de fichier)
      l.reference,
      l.productName,
      l.colorLabel || coloris.colorLabel || "",
      l.colorCode,
      l.size,
      l.quantity,
      l.category || coloris.category || "",
      l.subCategory || coloris.subCategory || "",
      wholesale === null || wholesale === undefined ? "" : euros(wholesale),
      conseille === null || conseille === undefined ? "" : euros(conseille),
      l.orderNumber,
      codeClient,
      l.shop,
    ];
  });

  const tri = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b, "fr"));
  return {
    header: [...COLONNES],
    rows,
    pieces,
    sansEan,
    eansCompletes,
    sansPrixWholesale,
    sansPrixConseille,
    references: tri(refs),
    referencesSansPrixConseille: tri(sansConseille),
    commandesSansCodeClient: tri(sansCode),
    commandes: tri(commandes),
    totalWholesale,
  };
}

/** Lignes brutes renvoyées par `/api/export/commandes-ean-info`. */
export interface ReferentielBrut {
  coloris?: {
    reference: string;
    colorCode: string | null;
    colorLabel: string | null;
    category: string | null;
    subCategory: string | null;
  }[];
  prix?: { reference: string; salePrice: number | null; costPrice: number | null }[];
  eans?: { reference: string; color: string; size: string; ean: string }[];
  clients?: { orderNumber: string; code: string }[];
}

/**
 * Indexe la réponse du serveur. La NORMALISATION DES CLÉS (casse, accents, espaces) vit
 * ici et nulle part ailleurs : le fichier TIO et la base n'écrivent pas toujours une
 * taille ou un code couleur de la même façon, et une clé construite différemment des deux
 * côtés produirait des colonnes vides sans rien signaler.
 */
export function buildReferentiel(brut: ReferentielBrut): InfosReferentiel {
  const colorisInfo: NonNullable<InfosReferentiel["colorisInfo"]> = {};
  for (const c of brut.coloris ?? []) {
    colorisInfo[cleColoris(c.reference, c.colorCode ?? "")] = {
      colorLabel: c.colorLabel ?? undefined,
      category: c.category ?? undefined,
      subCategory: c.subCategory ?? undefined,
    };
  }
  const prixParReference: NonNullable<InfosReferentiel["prixParReference"]> = {};
  for (const p of brut.prix ?? []) {
    prixParReference[norm(p.reference)] = { salePrice: p.salePrice, costPrice: p.costPrice };
  }
  const eans: Record<string, string> = {};
  for (const e of brut.eans ?? []) {
    eans[cleTaille(e.reference, e.color, e.size)] = e.ean;
  }
  const codesClient: Record<string, string> = {};
  for (const c of brut.clients ?? []) {
    codesClient[norm(c.orderNumber)] = c.code;
  }
  return { colorisInfo, prixParReference, eans, codesClient };
}

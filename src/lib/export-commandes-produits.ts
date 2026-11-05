// Export « commandes clients + infos produits et EAN », généré PAR GESTLOG.
//
// Rien n'est déposé : les lignes viennent de la base (`ClientOrderLine` × `Product` ×
// `ProductSizeEan` × `Client`), une ligne de sortie par commande × produit × coloris ×
// TAILLE, avec son code-barres.
//
// 🔴 LES QUANTITÉS SONT STOCKÉES EN JSON, PAS EN LIGNES. `ClientOrderLine` porte
// `quantitiesBySize` = `{"S":1,"M":1,"L":2}` : une ligne de base vaut plusieurs lignes
// d'export. L'éclatement est fait en SQL (`jsonb_each`), et les tailles à quantité nulle
// sont écartées — une taille à 0 n'a pas été commandée. *Mesuré sur la base du
// 05/11/2026 : 94 219 lignes de commande donnent 383 891 lignes taille, 831 704 pièces.*
//
// 🔴 IL N'Y A PAS DE PRIX UNITAIRE EN BASE. `ClientOrderLine.amount` est le CA **net de la
// ligne** ; le prix unitaire est donc RECONSTRUIT (`amount / totalQuantity`).
//
// 🔴 ET CETTE RECONSTRUCTION NE VAUT QUE POUR LA SOURCE **TIO**. *Mesuré sur la base du
// 05/11/2026, sur les commandes de plus de deux lignes : côté TIO, 8,91 prix unitaires
// distincts par commande en moyenne (3 235 des 3 349 commandes en ont plusieurs) et le
// prix reconstruit suit `Product.costPrice` — médiane du rapport exactement 1,000 sur
// neuf saisons. Côté TEXAS au contraire, **225 des 269 commandes n'ont qu'UN SEUL prix
// unitaire pour toutes leurs lignes** : l'import y répartit le total de la commande au
// prorata des pièces, si bien qu'un blouson cuir à 109,06 € de tarif et un pull à 24,97 €
// ressortent tous les deux à 37,75 €.* Autrement dit, sur une saison servie par TEXAS, ce
// « prix » est la MOYENNE de la commande, pas celui du produit. Il est donc refusé —
// l'export se rabat sur le tarif catalogue, et le dit.
//
// 🔴 L'EAN RESTE DU TEXTE. Un code à 13 chiffres converti en nombre s'affiche
// « 3,66525E+12 » dans Excel et perd ses zéros de tête.

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

/**
 * 15ᵉ colonne, ajoutée UNIQUEMENT quand l'export porte sur plusieurs saisons. Sur une
 * seule saison elle serait une colonne constante ; sur plusieurs, son absence rendrait le
 * fichier ambigu — le même produit, le même coloris et le même EAN se commandent d'une
 * saison à l'autre, à des prix différents. Elle est ajoutée EN FIN de ligne pour que les
 * 14 colonnes gardent exactement leur position.
 */
export const COLONNE_SAISON = "Saison";

/** Index des colonnes à formater dans Excel. */
export const COLONNE_QUANTITE = 6;
export const COLONNE_PRIX_WHOLESALE = 9;
export const COLONNE_PRIX_CONSEILLE = 10;

/** Une cellule de sortie : texte, ou nombre pour la quantité et les prix. */
export type Cell = string | number;

/** Une ligne lue en base, DÉJÀ éclatée par taille. */
export interface LigneBase {
  orderNumber: string;
  clientCode: string | null;
  clientName: string | null;
  reference: string;
  label: string | null;
  colorCode: string | null;
  colorLabel: string | null;
  /** Grille de tailles du produit (`"XS,S,M,L,XL,XXL"`), pour l'ordre d'affichage. */
  sizeScale: string | null;
  size: string;
  quantity: number;
  category: string | null;
  subCategory: string | null;
  /** Prix unitaire net reconstruit : `amount / totalQuantity`. Null si la ligne n'a pas de CA. */
  unitNet: number | null;
  /** Tarif de gros du catalogue (`Product.costPrice`). */
  costPrice: number | null;
  /** Prix de vente conseillé (`Product.salePrice`). */
  salePrice: number | null;
  ean: string | null;
  /** Nom de la saison. Ne sort en colonne qu'en multi-saisons (`withSeason`). */
  seasonName?: string | null;
}

export interface OptionsExport {
  /**
   * Origine du prix wholesale :
   *  • "commande" (défaut) — prix unitaire net de la commande (`amount / totalQuantity`) ;
   *  • "catalogue" — `Product.costPrice`, le tarif de gros, hors remise de commande.
   */
  wholesaleSource?: "commande" | "catalogue";
  /** Ajouter la colonne `Saison` en fin de ligne (export multi-saisons). */
  withSeason?: boolean;
}

export interface ExportProduits {
  header: string[];
  rows: Cell[][];
  /** Pièces commandées (somme des quantités). */
  pieces: number;
  /** Lignes dont la cellule EAN est vide. */
  sansEan: number;
  /** Lignes sans prix wholesale exploitable. */
  sansPrixWholesale: number;
  /** Lignes sans prix de vente conseillé. */
  sansPrixConseille: number;
  /** Références distinctes, triées. */
  references: string[];
  /** Références sans prix de vente conseillé, triées. */
  referencesSansPrixConseille: string[];
  /** Références dont une taille commandée n'a pas d'EAN, triées. */
  referencesSansEan: string[];
  /** Commandes distinctes, triées. */
  commandes: string[];
  /** Boutiques distinctes (enseignes), triées. */
  enseignes: string[];
  /** Saisons distinctes présentes dans l'export, triées. */
  saisons: string[];
  /** Montant wholesale total (prix × quantité), arrondi au centime. */
  totalWholesale: number;
}

/** Source B2B d'une saison, telle que `resolveOrderSource` la tranche. */
export type SourceCommandes = "TIO" | "TEXAS";

/**
 * Le prix unitaire reconstruit depuis `amount` est-il exploitable pour cette source ?
 *
 * 🔴 NON pour TEXAS : l'import y répartit le total de la commande au prorata des pièces,
 * donc toutes les lignes d'une commande ressortent au même prix (225 commandes sur 269).
 * Le proposer quand même donnerait une colonne « Prix wholesale » qui a l'air juste et qui
 * ne l'est pas — bien pire qu'une colonne absente.
 */
export function prixCommandeExploitable(source: SourceCommandes): boolean {
  return source === "TIO";
}

/**
 * Sur plusieurs saisons, le prix de la commande n'est exploitable que si **toutes** sont
 * servies par TIO. Une seule saison TEXAS dans le lot suffit à rendre la colonne
 * incomparable d'une ligne à l'autre : mieux vaut le tarif catalogue partout.
 */
export function prixCommandeExploitableSur(sources: SourceCommandes[]): boolean {
  return sources.length > 0 && sources.every(prixCommandeExploitable);
}

/** Pourquoi le prix de la commande est refusé sur TEXAS. Un seul texte, partout. */
export const RAISON_PRIX_TEXAS =
  "Sur une saison servie par TEXAS, l'import répartit le total de la commande au prorata " +
  "des pièces : toutes les lignes ressortent au même prix (un cuir à 109 € de tarif et un " +
  "pull à 25 € sortent tous deux à 37,75 €). Le tarif de gros du catalogue est utilisé à la place.";

/** Arrondi monétaire au centime (évite les 0.30000000000000004 d'Excel). */
const euros = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const norm = (s: string) => String(s ?? "").trim().toUpperCase();

/**
 * Ordonne les tailles d'un coloris selon la GRILLE du produit. Triées alphabétiquement,
 * `{S, M, L, XL, 2XL}` ressortirait « 2XL, L, M, S, XL » — illisible sur un document qui
 * sert à préparer une commande. Les tailles hors grille vont à la fin, dans leur ordre
 * d'arrivée, plutôt que d'être perdues.
 */
export function ordonnerParGrille<T extends { size: string }>(lignes: T[], sizeScale: string | null): T[] {
  const grille = String(sizeScale ?? "")
    .split(/[,;|]/)
    .map((s) => norm(s))
    .filter(Boolean);
  if (grille.length === 0) return lignes;
  const rang = new Map(grille.map((t, i) => [t, i]));
  return lignes
    .map((l, i) => ({ l, i, r: rang.get(norm(l.size)) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.l);
}

/** Clé d'un groupe « une commande × un coloris » : c'est là que l'ordre des tailles vaut. */
const cleGroupe = (l: LigneBase) =>
  `${norm(l.seasonName ?? "")}\u0000${l.orderNumber}\u0000${norm(l.reference)}\u0000${norm(
    l.colorCode ?? ""
  )}`;

/**
 * Construit les 14 colonnes. Une valeur absente laisse la cellule VIDE : la ligne n'est
 * jamais retirée, et aucune valeur n'est inventée — ni un code-barres, ni un prix.
 */
export function buildCommandesProduits(
  lignes: LigneBase[],
  options: OptionsExport = {}
): ExportProduits {
  const catalogue = options.wholesaleSource === "catalogue";
  const avecSaison = options.withSeason === true;

  // Tailles remises dans l'ordre de la grille, groupe par groupe. L'ordre des groupes
  // (celui du SQL : commande, référence, coloris) est conservé.
  const groupes = new Map<string, LigneBase[]>();
  for (const l of lignes) {
    const k = cleGroupe(l);
    const g = groupes.get(k);
    if (g) g.push(l);
    else groupes.set(k, [l]);
  }
  const ordonnees = [...groupes.values()].flatMap((g) => ordonnerParGrille(g, g[0].sizeScale));

  const refs = new Set<string>();
  const commandes = new Set<string>();
  const enseignes = new Set<string>();
  const sansConseille = new Set<string>();
  const sansEanRefs = new Set<string>();
  const saisons = new Set<string>();
  let pieces = 0;
  let sansEan = 0;
  let sansPrixWholesale = 0;
  let sansPrixConseille = 0;
  let totalWholesale = 0;

  const rows: Cell[][] = ordonnees.map((l) => {
    refs.add(l.reference);
    if (l.orderNumber) commandes.add(l.orderNumber);
    if (l.clientName) enseignes.add(l.clientName);
    if (l.seasonName) saisons.add(l.seasonName);
    pieces += l.quantity;

    if (!l.ean) {
      sansEan++;
      sansEanRefs.add(l.reference);
    }

    const wholesale = catalogue ? l.costPrice : l.unitNet;
    if (wholesale === null || wholesale === undefined) sansPrixWholesale++;
    else totalWholesale = euros(totalWholesale + euros(wholesale * l.quantity));

    if (l.salePrice === null || l.salePrice === undefined) {
      sansPrixConseille++;
      sansConseille.add(l.reference);
    }

    const ligne: Cell[] = [
      l.ean ?? "", // texte : jamais converti en nombre
      l.reference,
      l.label ?? "",
      l.colorLabel ?? "",
      l.colorCode ?? "",
      l.size,
      l.quantity,
      l.category ?? "",
      l.subCategory ?? "",
      wholesale === null || wholesale === undefined ? "" : euros(wholesale),
      l.salePrice === null || l.salePrice === undefined ? "" : euros(l.salePrice),
      l.orderNumber,
      l.clientCode ?? "",
      l.clientName ?? "",
    ];
    if (avecSaison) ligne.push(l.seasonName ?? "");
    return ligne;
  });

  const tri = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b, "fr"));
  return {
    header: avecSaison ? [...COLONNES, COLONNE_SAISON] : [...COLONNES],
    rows,
    pieces,
    sansEan,
    sansPrixWholesale,
    sansPrixConseille,
    references: tri(refs),
    referencesSansPrixConseille: tri(sansConseille),
    referencesSansEan: tri(sansEanRefs),
    commandes: tri(commandes),
    enseignes: tri(enseignes),
    saisons: tri(saisons),
    totalWholesale,
  };
}

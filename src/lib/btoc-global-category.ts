// « Catégorie globale » BtoC — déduite du TITRE du produit.
//
// Les catégories WooCommerce ne servent pas à analyser : un même produit en porte
// jusqu'à onze (« Collection été 50%, FB FR, FR, Non soldés, Pantalon, Pantalon chino,
// Pantalons, shoppingfeed, Ventes privées, Voir tout pantalon »), mélangeant type
// d'article, opération commerciale et canal de diffusion. Filtrer dessus revient à
// filtrer sur du marketing.
//
// Ici on reclasse par le TYPE D'ARTICLE lu dans le titre, insensible à la casse, aux
// accents et au pluriel.
//
// ⚠️ Le balayage se fait de GAUCHE À DROITE, premier mot reconnu gagnant : les titres MCS
// commencent par le type d'article. « Bermuda en jean » est un bermuda, « Veste en jean »
// une veste — un simple `contains('jean')` les rangerait tous deux dans Jean.

/** Minuscules, sans accents, ponctuation en espaces. */
export function normalizeTitle(title: string): string {
  return String(title ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Pluriel simple : « chaussettes » → « chaussette », « gants » → « gant ». */
export function singular(word: string): string {
  if (word.length > 3 && /(?:s|x)$/.test(word)) return word.slice(0, -1);
  return word;
}

/**
 * Mot (ou expression de deux mots) → catégorie globale.
 * Table volontairement explicite et modifiable : ajouter un synonyme est une ligne.
 * ⚠️ Les clés sont écrites au SINGULIER et sans accent : le titre est normalisé ET
 * dépluralisé AVANT la recherche, donc une clé au pluriel ne matcherait jamais.
 */
export const CATEGORY_KEYWORDS: Record<string, string> = {
  // Hauts
  chemise: "Chemise",
  surchemise: "Surchemise", // vêtement distinct, pas une chemise
  polo: "Polo",
  "t shirt": "T-shirt",
  "tee shirt": "T-shirt",
  tshirt: "T-shirt",
  pull: "Pull",
  pullover: "Pull",
  maille: "Pull",
  gilet: "Gilet",
  cardigan: "Gilet",
  sweat: "Sweat",
  sweatshirt: "Sweat",
  debardeur: "T-shirt",

  // Bas
  pantalon: "Pantalon",
  panton: "Pantalon", // faute de frappe du catalogue
  chino: "Pantalon",
  jean: "Jean",
  denim: "Jean",
  bermuda: "Bermuda",
  bemuda: "Bermuda", // faute de frappe présente dans le catalogue
  short: "Bermuda",

  // Pièces à manches
  veste: "Veste",
  blazer: "Veste",
  saharienne: "Veste",
  surveste: "Veste",
  blouson: "Blouson",
  bomber: "Blouson", // le titre porte « bombers », dépluralisé avant recherche
  teddy: "Blouson",
  bombardier: "Blouson",
  "flight jacket": "Blouson",
  manteau: "Manteau",
  parka: "Manteau",
  doudoune: "Manteau",
  impermeable: "Manteau",
  trench: "Manteau",
  caban: "Manteau",

  // Accessoires
  ceinture: "Ceinture",
  cheche: "Écharpe",
  echarpe: "Écharpe",
  foulard: "Écharpe",
  casquette: "Chapellerie",
  chapeau: "Chapellerie",
  bonnet: "Chapellerie",
  gavroche: "Chapellerie", // casquette plate
  gant: "Gants",
  sac: "Maroquinerie",
  sacoche: "Maroquinerie",
  cartable: "Maroquinerie",
  portefeuille: "Maroquinerie",
  pochette: "Maroquinerie",
  housse: "Maroquinerie",
  "porte carte": "Maroquinerie",
  "porte monnaie": "Maroquinerie",
  "porte cle": "Maroquinerie",
  "porte clef": "Maroquinerie",
  "porte feuille": "Maroquinerie",
  "porte passeport": "Maroquinerie",
  trousse: "Maroquinerie",
  etui: "Maroquinerie",
  "porte document": "Maroquinerie",
  chaussette: "Chaussettes",
  boxer: "Sous-vêtements",
  calecon: "Sous-vêtements",
};

/** Libellé des produits qu'aucun mot-clé ne reconnaît. */
export const UNCLASSIFIED = "Autres";

/**
 * Catégorie globale d'un titre, ou `null` si aucun mot-clé ne correspond.
 * À chaque position on essaie d'abord l'expression de DEUX mots (« porte cartes »),
 * puis le mot seul — sinon « porte » serait un mot vide qui ne conclut rien.
 */
export function globalCategoryOf(title: string): string | null {
  const words = normalizeTitle(title).split(" ").filter(Boolean).map(singular);
  for (let i = 0; i < words.length; i++) {
    if (i + 1 < words.length) {
      const pair = `${words[i]} ${words[i + 1]}`;
      if (CATEGORY_KEYWORDS[pair]) return CATEGORY_KEYWORDS[pair];
    }
    if (CATEGORY_KEYWORDS[words[i]]) return CATEGORY_KEYWORDS[words[i]];
  }
  return null;
}

/** Comme `globalCategoryOf`, mais renvoie toujours un libellé affichable. */
export function globalCategoryLabel(title: string): string {
  return globalCategoryOf(title) ?? UNCLASSIFIED;
}

/** Toutes les catégories que la table peut produire, triées. */
export function allGlobalCategories(): string[] {
  return [...new Set(Object.values(CATEGORY_KEYWORDS))].sort((a, b) => a.localeCompare(b, "fr"));
}

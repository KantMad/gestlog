// Recherche produit ↔ code-barres, dans les deux sens.
//
// Un seul champ pour trois usages : on scanne un EAN et on veut le produit, on tape une
// référence (ou un nom, une couleur) et on veut ses EAN taille par taille.
//
// 🔴 TROIS CHIFFRES NE SONT PAS UN DÉBUT D'EAN. Les codes couleur MCS font exactement
// trois chiffres (« 752 », « 213 », « 999 ») : les traiter comme un fragment de
// code-barres renverrait des milliers de lignes au lieu du coloris cherché. En dessous de
// quatre chiffres, on cherche donc du TEXTE.

/** Ce que l'utilisateur a tapé, une fois interprété. */
export type QueryKind = "vide" | "ean" | "ean-partiel" | "texte";

export interface ParsedQuery {
  kind: QueryKind;
  /** Valeur nettoyée à utiliser pour la requête (chiffres seuls pour un EAN). */
  value: string;
  /**
   * Pour un EAN-13 complet : la clé de contrôle est-elle juste ?
   * Un code mal recopié existe rarement en base — autant le dire tout de suite plutôt
   * que d'annoncer « aucun résultat ».
   */
  eanValide?: boolean;
}

/** Ne garde que les chiffres (le scanner et le copier-coller ajoutent espaces et tirets). */
export function digitsOnly(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/** Clé de contrôle EAN-13 : somme pondérée 1/3 des 12 premiers chiffres. */
export function ean13Checksum(douze: string): number {
  let somme = 0;
  for (let i = 0; i < 12; i++) {
    somme += Number(douze[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (somme % 10)) % 10;
}

/** Vrai si la chaîne est un EAN-13 complet ET cohérent avec sa clé de contrôle. */
export function isEan13(s: string | null | undefined): boolean {
  const d = digitsOnly(s);
  return d.length === 13 && ean13Checksum(d.slice(0, 12)) === Number(d[12]);
}

/** Interprète la saisie : code-barres complet, fragment de code-barres, ou texte. */
export function classifyQuery(raw: string | null | undefined): ParsedQuery {
  const texte = String(raw ?? "").trim();
  if (texte === "") return { kind: "vide", value: "" };

  // « 3665249594504 », « 3665249 594504 », « 3665249-594504 » : même code.
  const chiffres = digitsOnly(texte);
  const queDesChiffres = chiffres.length > 0 && /^[\d\s-]+$/.test(texte);

  if (queDesChiffres && chiffres.length === 13) {
    return { kind: "ean", value: chiffres, eanValide: isEan13(chiffres) };
  }
  // ≥ 4 chiffres : trop long pour un code couleur, c'est un fragment de code-barres.
  if (queDesChiffres && chiffres.length >= 4) {
    return { kind: "ean-partiel", value: chiffres };
  }
  return { kind: "texte", value: texte };
}

/** Présentation lisible d'un EAN-13 : « 3 665249 594504 » (découpage 1-6-6). */
export function formatEan(ean: string | null | undefined): string {
  const d = digitsOnly(ean);
  if (d.length !== 13) return String(ean ?? "");
  return `${d[0]} ${d.slice(1, 7)} ${d.slice(7)}`;
}

/**
 * Ordonne les tailles selon la grille du produit (`Product.sizeScale`).
 * ⚠️ Sans cette grille, TIO renvoie les tailles dans un ordre arbitraire : on verrait
 * « M, L, XL, S » — illisible pour qui cherche une taille précise. Les tailles absentes
 * de la grille passent à la fin, dans leur ordre d'origine, plutôt que d'être perdues.
 */
export function sortSizesByScale<T extends { size: string }>(lignes: T[], sizeScale: string | null | undefined): T[] {
  const grille = String(sizeScale ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const rang = new Map(grille.map((t, i) => [t.toUpperCase(), i]));
  return [...lignes].sort((a, b) => {
    const ra = rang.get(String(a.size).trim().toUpperCase()) ?? Number.MAX_SAFE_INTEGER;
    const rb = rang.get(String(b.size).trim().toUpperCase()) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return String(a.size).localeCompare(String(b.size), "fr", { numeric: true });
  });
}

// ─── Ordre d'habillage des tailles ───────────────────────────────────────────
//
// ⚠️ `Product.sizeScale` est alimenté par la synchro TIO
// (`variations.map(v => v.size).join(",")`) : l'ordre est celui que renvoie TIO, et il
// n'est pas fiable. Audit du 24/07/2026 : **893 produits sur 8 887 (10 %)** avaient une
// grille abîmée — **846 désordonnées** (`M,L,XL,S,2XL…` — le S en 4ᵉ position ; ou
// `42,30,31,…,28,44,29`) et **47 avec doublons** (`TU,TU`, jusqu'à `S,S,S,S,S,S,M,M,…`
// sur 42 entrées, ce qui produisait un onglet à 42 colonnes dans « Lancement de commande »).
//
// ⚠️ NE PAS brancher ce tri dans `parseSizeScale` : l'ORDRE de la grille sert aussi à
// **décoder les quantités par position** à l'import (`quantities[scale[i]]` dans
// `mcs-mapper`). Le tri s'applique à l'ÉCRITURE (synchro produits) et là où l'on a besoin
// d'un ordre d'affichage fiable — pas en remplacement global de la lecture.

const LETTER_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"];

/** Forme canonique d'une taille : `XXL` → `2XL`, `XXXL` → `3XL`, espaces retirés. */
export const canonSize = (s: string): string => {
  const u = String(s ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (u === "XXL") return "2XL";
  if (u === "XXXL") return "3XL";
  return u;
};

/**
 * Rang d'une taille dans l'ordre d'habillage. Les familles restent groupées :
 * taille unique (0) < tailles lettres (10+) < inconnues (900) < numériques (1000+).
 */
export function sizeRank(size: string): number {
  const u = canonSize(size);
  if (u === "TU" || u === "ONESIZE" || u === "U") return 0;

  // Numériques : « 38 », et plages « 39-42 » (rangées sur leur borne basse).
  const numeric = u.match(/^(\d+)(?:[-/](\d+))?$/);
  if (numeric) return 1000 + parseInt(numeric[1], 10) + (numeric[2] ? 0.5 : 0);

  const letter = LETTER_ORDER.indexOf(u);
  if (letter >= 0) return 10 + letter;

  // Groupées « S-M », « L/XL » : entre leurs deux bornes.
  const grouped = u.match(/^([A-Z0-9]+)[-/]([A-Z0-9]+)$/);
  if (grouped) {
    const a = LETTER_ORDER.indexOf(grouped[1]);
    const b = LETTER_ORDER.indexOf(grouped[2]);
    if (a >= 0 && b >= 0) return 10 + (a + b) / 2;
  }
  return 900; // inconnue → après les tailles connues, avant les numériques
}

/** Dédoublonne une grille et la remet dans l'ordre d'habillage. */
export function sortSizeScale(scale: string[]): string[] {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const raw of scale) {
    const s = String(raw ?? "").replace(/\s+/g, " ").trim();
    if (!s) continue;
    const k = canonSize(s);
    if (seen.has(k)) continue;
    seen.add(k);
    clean.push(s);
  }
  return clean.sort((a, b) => sizeRank(a) - sizeRank(b) || a.localeCompare(b, "fr"));
}

/** Idem, au format stocké (`"S,M,L"`). Chaîne vide si rien d'exploitable. */
export function sortSizeScaleString(sizeScale: string | null | undefined): string {
  return sortSizeScale(String(sizeScale ?? "").split(",")).join(",");
}

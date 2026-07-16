import { prisma } from "@/lib/prisma";

// ─── Équivalences de code couleur (fichiers ↔ référentiel TIO) ────────────────────
// Ex. « SSS » (Texas, code affiché) ↔ « 000 » (référentiel TIO, porteur des EAN/grille).
//
// À l'import : si (référence, SSS) n'existe pas au référentiel, on cherche (référence, 000).
// Si trouvé, le produit est **re-clé** en SSS (Product + ProductSizeEan) : on garde les mêmes
// EAN / la même grille / l'historique (les lignes pointent l'id produit), mais tout s'affiche
// désormais en SSS. Seules les références réellement rencontrées en SSS basculent.

export interface ColorEquiv {
  sourceCode: string; // code des fichiers = code affiché (SSS)
  targetCode: string; // code du référentiel (000)
  label: string | null;
}

/** Équivalences indexées par code source (majuscules). */
export type EquivIndex = Map<string, ColorEquiv[]>;

export async function loadColorEquivalences(): Promise<EquivIndex> {
  const rows = await prisma.colorEquivalence.findMany();
  const idx: EquivIndex = new Map();
  for (const r of rows) {
    const k = r.sourceCode.trim().toUpperCase();
    const arr = idx.get(k) || [];
    arr.push({ sourceCode: r.sourceCode, targetCode: r.targetCode, label: r.label });
    idx.set(k, arr);
  }
  return idx;
}

/** Variantes tolérées d'un code numérique ("6" ↔ "006"). */
function colorCandidates(code: string): string[] {
  const set = new Set<string>([code]);
  if (/^\d+$/.test(code)) {
    set.add(code.padStart(3, "0"));
    set.add(String(parseInt(code, 10)));
  }
  return [...set];
}

async function lookupExact(reference: string, code: string) {
  for (const color of colorCandidates(code)) {
    const p = await prisma.product.findUnique({ where: { reference_color: { reference, color } } });
    if (p) return p;
  }
  return null;
}

/**
 * Re-clé un produit (et ses EAN) du code référentiel vers le code affiché.
 * Idempotent et sûr : si la cible existe déjà, on ne fait rien.
 */
async function rekeyProductColor(
  productId: string,
  reference: string,
  fromColor: string,
  toColor: string,
  label: string | null
) {
  // Déjà un produit sous le code cible ? (course/ré-import) → on ne touche à rien.
  const existing = await prisma.product.findUnique({
    where: { reference_color: { reference, color: toColor } },
  });
  if (existing) return existing;

  const [product] = await prisma.$transaction([
    prisma.product.update({
      where: { id: productId },
      data: { color: toColor, colorCode: toColor, ...(label ? { colorLabel: label } : {}) },
    }),
    // Les EAN suivent la même clé (référence, couleur, taille).
    prisma.productSizeEan.updateMany({
      where: { reference, color: fromColor },
      data: { color: toColor },
    }),
  ]);
  return product;
}

export interface ResolveResult {
  product: { id: string; sizeScale: string; reference: string; color: string } | null;
  /** true si le produit a été basculé du code référentiel vers le code affiché. */
  rekeyed: boolean;
}

/**
 * Résout (référence, code couleur) vers un produit, en appliquant les équivalences.
 * 1) recherche directe (avec tolérance zéro initial) ;
 * 2) sinon, pour chaque équivalence dont le code source == code du fichier, recherche le
 *    code référentiel ; si trouvé → re-clé le produit vers le code du fichier.
 */
export async function resolveProductWithEquivalence(
  reference: string,
  colorCode: string,
  equivs: EquivIndex
): Promise<ResolveResult> {
  const direct = await lookupExact(reference, colorCode);
  if (direct) return { product: direct, rekeyed: false };

  const candidates = equivs.get(colorCode.trim().toUpperCase());
  if (!candidates?.length) return { product: null, rekeyed: false };

  for (const eq of candidates) {
    const target = await lookupExact(reference, eq.targetCode);
    if (!target) continue;
    const moved = await rekeyProductColor(
      target.id,
      reference,
      target.color,
      eq.sourceCode,
      eq.label
    );
    return { product: moved, rekeyed: true };
  }
  return { product: null, rekeyed: false };
}

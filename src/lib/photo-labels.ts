// Renommage des photos produit d'après l'étiquette manuscrite photographiée AVANT elles.
//
// Une série de photos ressemble à : [étiquette A] [photo] [photo] [étiquette B] [photo]…
// Chaque étiquette donne son nom aux photos qui la SUIVENT, jusqu'à la prochaine étiquette.
// Nom produit : `REFERENCE-CODECOULEUR-N.ext` (ex. THTMANT_901-209-1.jpg).
//
// Logique pure (pas de navigateur, pas d'IA) : testée dans photo-labels.test.ts.

export interface LabelReading {
  /** Référence produit, ex. « THTMANT_901 ». */
  reference: string;
  /** Code couleur, ex. « 209 » (peut être vide). */
  colorCode: string;
  /** Nom de la couleur, ex. « CARAMEL » (affichage seulement, pas dans le nom). */
  colorName: string;
}

export interface PhotoItem {
  id: string;
  fileName: string;
  /** true = photo d'étiquette, false = photo du vêtement. */
  isLabel: boolean;
  /** Lecture de l'étiquette (seulement si isLabel). */
  label?: LabelReading;
}

export interface PlannedName {
  id: string;
  /** Nouveau nom, ou null si la photo n'est pas exportée (étiquette exclue). */
  newName: string | null;
  /** Base du groupe (`REF-COULEUR`), null si aucune étiquette ne précède la photo. */
  groupBase: string | null;
}

/** Tri « naturel » des noms de fichiers : IMG_2 avant IMG_10. */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, "fr", { numeric: true, sensitivity: "base" });
}

/** Met un morceau de nom au propre : majuscules, sans accents, espaces → « _ ». */
export function cleanPart(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_]/g, "");
}

/** Base du nom à partir d'une étiquette : `REF-CODE`, ou `REF` sans code. "" si illisible. */
export function labelBase(label: LabelReading | undefined): string {
  if (!label) return "";
  const ref = cleanPart(label.reference);
  if (!ref) return "";
  const code = cleanPart(label.colorCode);
  return code ? `${ref}-${code}` : ref;
}

export function extensionOf(fileName: string): string {
  const m = fileName.match(/\.([A-Za-z0-9]+)$/);
  return m ? m[1].toLowerCase() : "jpg";
}

/**
 * Calcule le nouveau nom de chaque photo (dans l'ordre reçu, déjà trié).
 * - Les photos avant la première étiquette (ou après une étiquette illisible) gardent
 *   leur nom d'origine : groupBase = null, à signaler à l'utilisateur.
 * - Si la même étiquette revient plus loin, la numérotation continue (pas d'écrasement).
 * - includeLabels : exporte aussi la photo d'étiquette, nommée `REF-CODE-ETIQUETTE`.
 */
export function planNames(items: PhotoItem[], includeLabels = false): PlannedName[] {
  const counters = new Map<string, number>();
  const used = new Set<string>();
  const unique = (name: string): string => {
    if (!used.has(name.toLowerCase())) {
      used.add(name.toLowerCase());
      return name;
    }
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let i = 2; ; i++) {
      const candidate = `${stem}_${i}${ext}`;
      if (!used.has(candidate.toLowerCase())) {
        used.add(candidate.toLowerCase());
        return candidate;
      }
    }
  };

  let current: string | null = null;
  return items.map((it) => {
    if (it.isLabel) {
      current = labelBase(it.label) || null;
      if (!includeLabels) return { id: it.id, newName: null, groupBase: current };
      const name = current
        ? `${current}-ETIQUETTE.${extensionOf(it.fileName)}`
        : it.fileName;
      return { id: it.id, newName: unique(name), groupBase: current };
    }
    if (!current) return { id: it.id, newName: unique(it.fileName), groupBase: null };
    const n = (counters.get(current) ?? 0) + 1;
    counters.set(current, n);
    return {
      id: it.id,
      newName: unique(`${current}-${n}.${extensionOf(it.fileName)}`),
      groupBase: current,
    };
  });
}

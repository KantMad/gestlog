// Correspondance fournisseur → référence produit (écran Infos produits).
//
// Information COMMERCIALEMENT SENSIBLE : qui fabrique quoi. Elle est stockée et
// consultable, mais volontairement affichée NULLE PART ailleurs — l'écran et son API
// sont filtrés par le même droit (`/product-info`, cf. lib/screens.ts).
//
// Ce module ne fait que PRÉPARER l'import : il ne touche pas la base. Il répond à
// trois questions que l'import naïf laissait sans réponse.

/** Une ligne du fichier, colonnes déjà rapprochées. */
export interface SupplierRefRow {
  supplierCode: string;
  supplierName?: string;
  reference: string;
}

/** Un fournisseur déjà connu de GestLog. */
export interface ExistingSupplier {
  code: string;
  name: string;
}

export interface ImportPlan {
  /** Liens à écrire. `supplierCode` est celui du fournisseur EXISTANT quand il y en a un. */
  links: { supplierCode: string; reference: string }[];
  /** Fournisseurs absents de la base — seront créés, dans l'orthographe du fichier. */
  newSuppliers: { code: string; name: string }[];
  /** Codes du fichier rattachés à un fournisseur existant écrit différemment. */
  rapprochements: { fichier: string; base: string }[];
  /** Références du fichier introuvables au catalogue produit. */
  unknownRefs: string[];
  /** Lignes inexploitables : code ou référence manquant. */
  ignored: { line: number; reason: string }[];
  /** Nombre de doublons exacts à l'intérieur du fichier. */
  duplicates: number;
  /** Références rattachées à PLUSIEURS fournisseurs — légitime (double sourcing) mais à l'œil. */
  multiSupplier: { reference: string; suppliers: string[] }[];
}

/**
 * Clé de rapprochement : sans casse, sans accent, sans espaces superflus.
 *
 * ⚠️ C'est le cœur du problème. L'import d'origine faisait un `upsert` sur le code
 * brut : « Enteks » n'était pas reconnu comme le « ENTEKS » déjà en base, et créait un
 * SECOND fournisseur — pendant que les 3 commandes restaient attachées au premier.
 * Le lien produit → fournisseur aurait alors désigné un fournisseur fantôme.
 */
export function normalizeKey(value: string): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Prépare l'import sans rien écrire.
 *
 * `catalogueRefs` sert uniquement à SIGNALER les références inconnues — jamais à les
 * rejeter : une référence peut précéder sa synchronisation depuis TIO. Quand la
 * référence existe au catalogue, on retient **l'orthographe du catalogue** : c'est elle
 * qui servira de jointure le jour où l'information sera exploitée.
 */
export function planSupplierRefImport(
  rows: SupplierRefRow[],
  { suppliers, catalogueRefs }: { suppliers: ExistingSupplier[]; catalogueRefs: string[] }
): ImportPlan {
  const parCle = new Map<string, ExistingSupplier>();
  for (const s of suppliers) parCle.set(normalizeKey(s.code), s);

  const catalogue = new Map<string, string>();
  for (const r of catalogueRefs) catalogue.set(normalizeKey(r), r);

  const links: ImportPlan["links"] = [];
  const nouveaux = new Map<string, { code: string; name: string }>();
  const rapprochements = new Map<string, string>();
  const inconnues = new Set<string>();
  const ignored: ImportPlan["ignored"] = [];
  const vus = new Set<string>();
  const fournisseursParRef = new Map<string, Set<string>>();
  let duplicates = 0;

  rows.forEach((row, i) => {
    // +2 : l'en-tête occupe la ligne 1 du tableur.
    const ligne = i + 2;
    const code = String(row.supplierCode ?? "").trim();
    const reference = String(row.reference ?? "").trim();

    if (!code && !reference) return; // ligne vide : on ne la reproche pas
    if (!code) {
      ignored.push({ line: ligne, reason: "code fournisseur manquant" });
      return;
    }
    if (!reference) {
      ignored.push({ line: ligne, reason: "référence produit manquante" });
      return;
    }

    const cle = normalizeKey(code);
    const existant = parCle.get(cle);
    let codeRetenu: string;
    if (existant) {
      codeRetenu = existant.code;
      if (existant.code !== code) rapprochements.set(code, existant.code);
    } else {
      codeRetenu = code;
      if (!nouveaux.has(cle)) {
        nouveaux.set(cle, { code, name: String(row.supplierName ?? "").trim() || code });
      }
    }

    const cleRef = normalizeKey(reference);
    const refCatalogue = catalogue.get(cleRef);
    if (!refCatalogue) inconnues.add(reference);
    const refRetenue = refCatalogue ?? reference;

    const cleLien = `${normalizeKey(codeRetenu)}|${cleRef}`;
    if (vus.has(cleLien)) {
      duplicates++;
      return;
    }
    vus.add(cleLien);
    links.push({ supplierCode: codeRetenu, reference: refRetenue });

    const set = fournisseursParRef.get(refRetenue) ?? new Set<string>();
    set.add(codeRetenu);
    fournisseursParRef.set(refRetenue, set);
  });

  const multiSupplier = [...fournisseursParRef.entries()]
    .filter(([, s]) => s.size > 1)
    .map(([reference, s]) => ({ reference, suppliers: [...s].sort() }))
    .sort((a, b) => a.reference.localeCompare(b.reference, "fr"));

  return {
    links,
    newSuppliers: [...nouveaux.values()].sort((a, b) => a.code.localeCompare(b.code, "fr")),
    rapprochements: [...rapprochements.entries()]
      .map(([fichier, base]) => ({ fichier, base }))
      .sort((a, b) => a.fichier.localeCompare(b.fichier, "fr")),
    unknownRefs: [...inconnues].sort((a, b) => a.localeCompare(b, "fr")),
    ignored,
    duplicates,
    multiSupplier,
  };
}

// Quel fournisseur pour quelle référence produit ?
//
// GestLog connaît la réponse par DEUX chemins, qui ne se recouvrent pas :
//
//  1. les **correspondances importées** (`SupplierProductRef`, écran Infos produits),
//     saisies depuis l'export Texas « CodesBarres » — couvrent une saison à la fois ;
//  2. les **commandes fournisseurs** déjà passées dans GestLog (`SupplierOrderLine`) —
//     n'existent que pour ce qui a effectivement été commandé.
//
// *Relevé du 24/09/2026 : sur 2 017 références commandées par les boutiques, les
// commandes fournisseurs n'en couvrent que 250, dont 245 sur la seule AH26.* Aucune des
// deux sources ne suffit : on les cumule, la correspondance importée l'emportant.
//
// ⚠️ Information commercialement sensible : ce module est consommé par l'export
// « Quantités commandées », lui-même derrière le droit d'écran `/export`.

/** D'où vient le fournisseur retenu, pour pouvoir le dire à l'écran. */
export type SupplierOrigin = "correspondance" | "commande" | "inconnu";

export interface SupplierResolution {
  /** Référence → nom du fournisseur retenu. */
  byReference: Map<string, string>;
  /** Référence → origine de l'information. */
  originByReference: Map<string, SupplierOrigin>;
  /** Références portées par PLUSIEURS fournisseurs dans une même source. */
  conflicts: { reference: string; suppliers: string[] }[];
  /** Décompte par origine, pour le récapitulatif de l'export. */
  counts: { correspondance: number; commande: number };
}

/**
 * Fusionne les deux sources.
 *
 * ⚠️ En cas de fournisseurs multiples sur une même référence, on en retient **un seul**,
 * le premier par ordre alphabétique, et on le SIGNALE. Répartir la même référence dans
 * deux onglets doublerait ses quantités dans le classeur — un total faux est pire qu'un
 * choix arbitraire assumé.
 */
export function resolveProductSuppliers(
  correspondances: { reference: string; supplier: string }[],
  commandes: { reference: string; supplier: string }[]
): SupplierResolution {
  const conflicts: SupplierResolution["conflicts"] = [];

  const regrouper = (src: { reference: string; supplier: string }[]) => {
    const m = new Map<string, Set<string>>();
    for (const { reference, supplier } of src) {
      const r = String(reference ?? "").trim();
      const f = String(supplier ?? "").trim();
      if (!r || !f) continue;
      const set = m.get(r) ?? new Set<string>();
      set.add(f);
      m.set(r, set);
    }
    return m;
  };

  const parCorrespondance = regrouper(correspondances);
  const parCommande = regrouper(commandes);

  const byReference = new Map<string, string>();
  const originByReference = new Map<string, SupplierOrigin>();
  const counts = { correspondance: 0, commande: 0 };

  const retenir = (reference: string, candidats: Set<string>, origine: SupplierOrigin) => {
    const tries = [...candidats].sort((a, b) => a.localeCompare(b, "fr"));
    if (tries.length > 1) conflicts.push({ reference, suppliers: tries });
    byReference.set(reference, tries[0]);
    originByReference.set(reference, origine);
  };

  // La correspondance importée fait foi : elle est saisie exprès, la commande
  // fournisseur n'est qu'une trace de ce qui a été acheté un jour.
  for (const [reference, set] of parCorrespondance) {
    retenir(reference, set, "correspondance");
    counts.correspondance++;
  }
  for (const [reference, set] of parCommande) {
    if (byReference.has(reference)) continue;
    retenir(reference, set, "commande");
    counts.commande++;
  }

  conflicts.sort((a, b) => a.reference.localeCompare(b.reference, "fr"));
  return { byReference, originByReference, conflicts, counts };
}

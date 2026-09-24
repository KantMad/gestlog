// Montants commandés / répartis / manquants, vus du SEUL pipeline de répartition.
//
// ⚠️ PÉRIMÈTRE VOLONTAIREMENT ÉTROIT. Deux chiffres seulement entrent ici :
//   • le montant des **commandes clients importées** (`ClientOrderLine.amount`, le CA net
//     de la ligne réparti depuis le total de la commande) ;
//   • les quantités **attribuées par les répartitions validées**
//     (`AllocationLine.allocatedBySize`, sessions `VALIDATED` uniquement).
// Rien d'autre : ni BL entrepôt, ni factures, ni stock. C'est ce qui rend l'écran
// lisible — commandé, réparti, manquant parlent tous du même pipeline.
//
// 🔴 POURQUOI PAS `Delivery` ? Parce que la table est VIDE et qu'**aucun chemin de code
// de GestLog n'en crée jamais** : elle n'est que lue (Récap clients, Préparation, Vue
// dépôt, statistiques). Le « livré » de ces écrans vaut donc 0 depuis toujours. Ce que la
// répartition produit réellement, ce sont des `AllocationLine` — c'est donc elles qui
// font le « réparti » ici.
//
// ⚠️ LE MONTANT LIVRÉ N'EXISTE PAS EN BASE. `DeliveryLine` ne porte que des quantités, et
// `AllocationLine` aussi. Le montant réparti est donc DÉDUIT au prorata de la pièce :
// `montant de la ligne ÷ quantité commandée × quantité répartie`. C'est exact dès que le
// prix est uniforme sur les tailles d'un même coloris — ce qu'il est chez MCS.

/** Une ligne de commande, augmentée de ce que les répartitions lui ont attribué. */
export interface MontantLine {
  clientId: string;
  clientName: string;
  catalogId: string | null;
  catalogName: string | null;
  /** CA net de la ligne (€). */
  amount: number;
  /** Quantité commandée sur la ligne. */
  totalQuantity: number;
  /** Pièces soldées : elles ne seront JAMAIS livrées. */
  cancelledQty: number;
  /** Pièces attribuées par les répartitions validées. */
  allocatedQty: number;
}

export interface MontantTotals {
  /** Montant commandé (€). */
  commande: number;
  /** Montant des pièces soldées (€) — ni livrables, ni manquantes. */
  solde: number;
  /** Montant réparti (€), au prorata de la pièce. */
  reparti: number;
  /** Ce qu'il manque (€) = commandé − soldé − réparti. */
  manquant: number;
  qCommandee: number;
  qSoldee: number;
  qRepartie: number;
  /** Part du montant commandé effectivement répartie, en % (une décimale). */
  taux: number;
}

export interface MontantGroup extends MontantTotals {
  id: string;
  label: string;
}

export interface MontantReport {
  total: MontantTotals;
  parBoutique: MontantGroup[];
  parCatalogue: MontantGroup[];
  /**
   * Lignes commandées sans montant : le taux en € les ignore forcément.
   * *Sur PE25, 7 393 lignes sur 7 831 sont à 0 € — l'écran doit le dire plutôt que
   * d'afficher un taux qui n'a aucun sens.*
   */
  lignesSansMontant: number;
  /**
   * Lignes où la répartition dépasse le commandé net. Signalé, jamais corrigé :
   * un écrêtage silencieux masquerait une anomalie de données.
   */
  surRepartition: number;
}

/** Libellé de repli pour les commandes sans catalogue. */
export const SANS_CATALOGUE = "Sans catalogue";

const vide = (): MontantTotals => ({
  commande: 0, solde: 0, reparti: 0, manquant: 0,
  qCommandee: 0, qSoldee: 0, qRepartie: 0, taux: 0,
});

const cumuler = (t: MontantTotals, l: MontantLine) => {
  // Prix unitaire déduit de la ligne : c'est la seule façon de valoriser une quantité
  // répartie, qui ne porte aucun montant.
  const pu = l.totalQuantity > 0 ? l.amount / l.totalQuantity : 0;
  t.commande += l.amount;
  t.solde += pu * l.cancelledQty;
  t.reparti += pu * l.allocatedQty;
  t.qCommandee += l.totalQuantity;
  t.qSoldee += l.cancelledQty;
  t.qRepartie += l.allocatedQty;
};

const clore = <T extends MontantTotals>(t: T): T => {
  // ⚠️ Le manquant se calcule à la FIN, sur les cumuls : ligne à ligne, les arrondis
  // s'additionneraient. Le soldé est retiré — une pièce soldée ne manque pas, elle
  // n'existe plus.
  t.manquant = t.commande - t.solde - t.reparti;
  t.taux = t.commande > 0 ? Math.round((t.reparti / t.commande) * 1000) / 10 : 0;
  return t;
};

/**
 * Agrège les lignes en un total, une vue par boutique et une vue par catalogue.
 * Les deux vues sont triées par montant commandé décroissant : on lit d'abord où il y a
 * de l'argent, pas l'ordre alphabétique.
 */
export function buildMontantReport(lines: MontantLine[]): MontantReport {
  const total = vide();
  const boutiques = new Map<string, MontantGroup>();
  const catalogues = new Map<string, MontantGroup>();
  let lignesSansMontant = 0;
  let surRepartition = 0;

  const groupe = (
    m: Map<string, MontantGroup>,
    id: string,
    label: string
  ): MontantGroup => {
    let g = m.get(id);
    if (!g) {
      g = { id, label, ...vide() };
      m.set(id, g);
    }
    return g;
  };

  for (const l of lines) {
    if (l.amount <= 0 && l.totalQuantity > 0) lignesSansMontant++;
    if (l.allocatedQty > l.totalQuantity - l.cancelledQty) surRepartition++;

    cumuler(total, l);
    cumuler(groupe(boutiques, l.clientId, l.clientName), l);
    cumuler(
      groupe(catalogues, l.catalogId ?? "—", l.catalogName || SANS_CATALOGUE),
      l
    );
  }

  const trier = (m: Map<string, MontantGroup>) =>
    [...m.values()]
      .map(clore)
      .sort((a, b) => b.commande - a.commande || a.label.localeCompare(b.label, "fr"));

  return {
    total: clore(total),
    parBoutique: trier(boutiques),
    parCatalogue: trier(catalogues),
    lignesSansMontant,
    surRepartition,
  };
}

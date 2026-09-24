// Montants commandés / livrés / manquants, boutique par boutique et catalogue par catalogue.
//
// Trois chiffres, trois sources distinctes, volontairement séparées :
//   • **commandé** — `ClientOrderLine.amount`, le CA net de la ligne ;
//   • **réparti**  — `AllocationLine.allocatedBySize` des sessions `VALIDATED` : ce que
//     GestLog a DÉCIDÉ d'attribuer ;
//   • **livré**    — les bons de livraison de l'entrepôt (`WarehouseDocumentLine`) : ce
//     qui est RÉELLEMENT parti.
//
// 🔴 Réparti et livré ne se confondent pas, et l'écart est le sujet. *Sur AH26 : 23 022
// pièces réparties, 63 676 livrées. Le catalogue MCS Homme n'a jamais été réparti et a
// pourtant reçu 31 118 pièces.* C'est pourquoi les deux colonnes cohabitent.
//
// 🔴 POURQUOI PAS `Delivery` ? Parce que la table est VIDE et qu'**aucun chemin de code
// de GestLog n'en crée jamais** : elle n'est que lue (Récap clients, Préparation, Vue
// dépôt, statistiques). Le « livré » de ces écrans vaut donc 0 depuis toujours.
//
// ⚠️ AUCUN MONTANT N'EXISTE SUR UNE QUANTITÉ RÉPARTIE OU LIVRÉE. `AllocationLine` et
// `WarehouseDocumentLine` ne portent que des quantités (le `unitPrice` des BL n'est
// renseigné que pour les factures). Les deux montants sont donc DÉDUITS au prorata de la
// pièce : `montant de la ligne ÷ quantité commandée × quantité concernée`. C'est exact dès
// que le prix est uniforme sur les tailles d'un même coloris — ce qu'il est chez MCS.
//
// ⚠️ Valoriser au prix de la COMMANDE, et non à celui du BL, est délibéré : commandé et
// livré doivent se comparer sur la même base tarifaire, sinon l'écart mélange un écart de
// volume et un écart de prix.

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
  /** Pièces réellement livrées, d'après les bons de livraison entrepôt. */
  deliveredQty: number;
}

export interface MontantTotals {
  /** Montant commandé (€). */
  commande: number;
  /** Montant des pièces soldées (€) — ni livrables, ni manquantes. */
  solde: number;
  /** Montant réparti (€), au prorata de la pièce — ce que GestLog a décidé. */
  reparti: number;
  /** Montant livré (€), au prorata de la pièce — ce qui est réellement parti. */
  livre: number;
  /** Ce qu'il manque (€) = commandé − soldé − LIVRÉ. */
  manquant: number;
  qCommandee: number;
  qSoldee: number;
  qRepartie: number;
  qLivree: number;
  /** Part du montant commandé effectivement répartie, en % (une décimale). */
  taux: number;
  /** Part du montant commandé effectivement livrée, en % (une décimale). */
  tauxLivre: number;
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
  /** Lignes où la LIVRAISON dépasse le commandé net. Même règle : on signale. */
  surLivraison: number;
}

/** Libellé de repli pour les commandes sans catalogue. */
export const SANS_CATALOGUE = "Sans catalogue";

const vide = (): MontantTotals => ({
  commande: 0, solde: 0, reparti: 0, livre: 0, manquant: 0,
  qCommandee: 0, qSoldee: 0, qRepartie: 0, qLivree: 0, taux: 0, tauxLivre: 0,
});

const cumuler = (t: MontantTotals, l: MontantLine) => {
  // Prix unitaire déduit de la ligne : c'est la seule façon de valoriser une quantité
  // répartie, qui ne porte aucun montant.
  const pu = l.totalQuantity > 0 ? l.amount / l.totalQuantity : 0;
  t.commande += l.amount;
  t.solde += pu * l.cancelledQty;
  t.reparti += pu * l.allocatedQty;
  t.livre += pu * l.deliveredQty;
  t.qCommandee += l.totalQuantity;
  t.qSoldee += l.cancelledQty;
  t.qRepartie += l.allocatedQty;
  t.qLivree += l.deliveredQty;
};

const clore = <T extends MontantTotals>(t: T): T => {
  // ⚠️ Le manquant se calcule à la FIN, sur les cumuls : ligne à ligne, les arrondis
  // s'additionneraient. Le soldé est retiré — une pièce soldée ne manque pas, elle
  // n'existe plus. Et c'est le LIVRÉ qui le détermine : ce qui est réparti mais pas parti
  // manque encore à la boutique.
  t.manquant = t.commande - t.solde - t.livre;
  const part = (n: number) => (t.commande > 0 ? Math.round((n / t.commande) * 1000) / 10 : 0);
  t.taux = part(t.reparti);
  t.tauxLivre = part(t.livre);
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
  let surLivraison = 0;

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
    const net = l.totalQuantity - l.cancelledQty;
    if (l.allocatedQty > net) surRepartition++;
    if (l.deliveredQty > net) surLivraison++;

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
    surLivraison,
  };
}

// Logique métier pure de réconciliation commandé / livré / soldé.
// Source unique de vérité, utilisée par /api/reassort et testable unitairement.

export type OrderStatus = "NON_LIVREE" | "PARTIELLE" | "LIVREE" | "SOLDEE";

// Quantité réellement attendue après soldage des pièces annulées.
export function effectiveOrdered(ordered: number, cancelled: number): number {
  return Math.max(0, ordered - cancelled);
}

// Reste à livrer = commandé − soldé − livré (jamais négatif).
export function remaining(ordered: number, cancelled: number, delivered: number): number {
  return Math.max(0, ordered - cancelled - delivered);
}

// Statut d'une commande (ou d'une pièce) à partir des quantités.
//  - NON_LIVREE : rien livré et rien soldé
//  - LIVREE     : livré ≥ attendu, sans soldage
//  - SOLDEE     : livré ≥ attendu (=commandé − soldé) avec au moins une pièce soldée
//  - PARTIELLE  : sinon
export function orderStatus(ordered: number, cancelled: number, delivered: number): OrderStatus {
  const effective = effectiveOrdered(ordered, cancelled);
  if (delivered === 0 && cancelled === 0) return "NON_LIVREE";
  if (delivered >= effective) return cancelled > 0 ? "SOLDEE" : "LIVREE";
  return "PARTIELLE";
}

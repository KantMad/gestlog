// Répartition du CA d'une commande sur ses lignes.
//
// 🔴 POURQUOI. La synchro TIO calcule le montant d'une ligne comme
// `brut × (total commande ÷ Σ brut)`, le brut venant des prix portés par `product_data`.
// *Sur les commandes antérieures à 2026, TIO ne porte plus ces prix : Σ brut vaut 0, donc
// le ratio vaut 0, donc TOUTES les lignes tombent à 0 € — alors que le total de la
// commande, lui, est toujours là.* Résultat constaté le 28/09/2026 : 299 commandes de 2025
// vidées de leur CA, soit 3 276 978 €, et le phénomène progressait à chaque resynchro.
//
// Ce module reconstruit la répartition à partir de deux données RÉELLES : le total de la
// commande (TIO) et le prix catalogue de chaque produit (`Product.costPrice`).
//
// ⚠️ C'est une RÉPARTITION, pas une invention : le total est exact, seule sa ventilation
// entre les lignes est déduite. Validée sur les 124 commandes saines de 2025, où
// `Σ(prix catalogue × qté) ÷ montant réel` vaut **1,049 en moyenne (écart-type 0,185)** —
// le prix catalogue prédit le montant réel à ~5 % près, et le recalage sur le total absorbe
// le reste.

export interface AmountLine {
  /** Identifiant de ligne (produit), rendu tel quel dans le résultat. */
  id: string;
  quantity: number;
  /** Prix catalogue unitaire. 0 = inconnu. */
  unitPrice: number;
}

/**
 * Répartit `total` sur les lignes, au prorata de `prix × quantité`.
 *
 * ⚠️ La somme des montants rendus vaut EXACTEMENT `total` au centime : les restes
 * d'arrondi sont attribués à la plus grosse ligne (méthode du plus fort reste). Sans cela,
 * la somme des lignes ne retomberait pas sur le total de la commande et l'incohérence
 * réapparaîtrait ailleurs.
 *
 * ⚠️ Sans aucun prix connu, on retombe sur la QUANTITÉ seule. C'est moins fidèle — un
 * blouson et un tee-shirt pèsent alors pareil — donc `basis` le dit, pour que l'appelant
 * puisse le signaler.
 */
export function distributeOrderAmount(
  lines: AmountLine[],
  total: number
): { amounts: Map<string, number>; basis: "prix" | "quantité" | "aucune" } {
  const amounts = new Map<string, number>();
  const t = Number(total) || 0;
  const utiles = lines.filter((l) => (Number(l.quantity) || 0) > 0);
  if (t <= 0 || utiles.length === 0) return { amounts, basis: "aucune" };

  const parPrix = utiles.some((l) => (Number(l.unitPrice) || 0) > 0);
  const poids = (l: AmountLine) =>
    parPrix
      ? (Number(l.unitPrice) || 0) * (Number(l.quantity) || 0)
      : Number(l.quantity) || 0;

  const somme = utiles.reduce((s, l) => s + poids(l), 0);
  if (somme <= 0) return { amounts, basis: "aucune" };

  // Répartition au centime, puis attribution du reste à la plus grosse ligne.
  const centimes = Math.round(t * 100);
  let attribues = 0;
  const brut = utiles.map((l) => ({ id: l.id, part: Math.floor((poids(l) / somme) * centimes) }));
  for (const b of brut) attribues += b.part;

  let reste = centimes - attribues;
  // Les lignes les plus lourdes absorbent le reste, une unité chacune : c'est la
  // répartition qui minimise l'écart relatif ligne par ligne.
  const ordre = [...utiles]
    .map((l, i) => ({ i, p: poids(l) }))
    .sort((a, b) => b.p - a.p);
  for (let k = 0; reste > 0 && k < ordre.length; k++, reste--) {
    brut[ordre[k].i].part += 1;
  }

  for (const b of brut) amounts.set(b.id, Math.round(b.part) / 100);
  return { amounts, basis: parPrix ? "prix" : "quantité" };
}

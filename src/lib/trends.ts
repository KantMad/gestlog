// Analyse des tendances B2B (GESTLOG-12) — logique PURE, testée (trends.test.ts).
//
// Précommande = commandes TIO (prise de commande) ; commande finale = commandes TEXAS (ERP).
// Les deux sources ont des n° de commande disjoints : le SEUL lien est
// `ClientOrder.tioOrderNumber` côté Texas (cf. docs/08). On compare donc commande par
// commande :
//   - commande TIO SANS jumelle Texas  → commande perdue en entier ;
//   - commande TIO AVEC jumelle Texas → écart ligne à ligne (produits / tailles retirés).
// Marque : TDH = catalogues « Territoire d'homme… », MCS = tous les autres.

export type Brand = "MCS" | "TDH";

export function brandOfCatalog(catalogName: string | null | undefined): Brand {
  return /territoire/i.test(String(catalogName ?? "")) ? "TDH" : "MCS";
}

/** Une ligne agrégée renvoyée par la base pour UNE saison. */
export interface TrendLine {
  side: "pre" | "final";
  paired: boolean; // côté pre : la commande TIO a-t-elle une jumelle Texas ?
  brand: Brand;
  category: string;
  subCategory: string;
  reference: string;
  label: string;
  color: string;
  qty: number;
  amount: number;
}

export type TrendLevel = "category" | "subCategory" | "product" | "color";
export const TREND_LEVEL_LABELS: Record<TrendLevel, string> = {
  category: "Catégorie",
  subCategory: "Sous-catégorie",
  product: "Produit",
  color: "Produit × coloris",
};

export interface TrendRow {
  key: string;
  brand: Brand;
  category: string;
  subCategory: string;
  reference: string | null;
  label: string;
  color: string | null;
  preQty: number;
  preAmount: number;
  finalQty: number;
  finalAmount: number;
  lostOrdersQty: number; // pièces des commandes perdues en entier
  lostOrdersAmount: number;
  lostQty: number; // pre − final
  lostAmount: number;
  lossRate: number; // % des pièces précommandées perdues (1 décimale)
  lossRateAmount: number; // idem en €
}

function keyOf(l: TrendLine, level: TrendLevel): string {
  switch (level) {
    case "category":
      return `${l.brand}|${l.category}`;
    case "subCategory":
      return `${l.brand}|${l.category}|${l.subCategory}`;
    case "product":
      return `${l.brand}|${l.reference}`;
    default:
      return `${l.brand}|${l.reference}|${l.color}`;
  }
}

const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Agrège précommande vs finale au niveau voulu ; trié par pièces perdues décroissantes. */
export function buildTrendRows(lines: TrendLine[], level: TrendLevel, hasFinal: boolean): TrendRow[] {
  const map = new Map<string, TrendRow>();
  for (const l of lines) {
    const k = keyOf(l, level);
    let r = map.get(k);
    if (!r) {
      r = {
        key: k,
        brand: l.brand,
        category: l.category,
        subCategory: level === "category" ? "" : l.subCategory,
        reference: level === "product" || level === "color" ? l.reference : null,
        label: level === "product" || level === "color" ? l.label : level === "subCategory" ? l.subCategory : l.category,
        color: level === "color" ? l.color : null,
        preQty: 0,
        preAmount: 0,
        finalQty: 0,
        finalAmount: 0,
        lostOrdersQty: 0,
        lostOrdersAmount: 0,
        lostQty: 0,
        lostAmount: 0,
        lossRate: 0,
        lossRateAmount: 0,
      };
      map.set(k, r);
    }
    if (l.side === "pre") {
      r.preQty += l.qty;
      r.preAmount += l.amount;
      if (!l.paired) {
        r.lostOrdersQty += l.qty;
        r.lostOrdersAmount += l.amount;
      }
    } else {
      r.finalQty += l.qty;
      r.finalAmount += l.amount;
    }
  }
  const rows = [...map.values()].map((r) => {
    const lostQty = hasFinal ? r.preQty - r.finalQty : 0;
    const lostAmount = hasFinal ? r.preAmount - r.finalAmount : 0;
    return {
      ...r,
      preAmount: r2(r.preAmount),
      finalAmount: r2(r.finalAmount),
      lostOrdersAmount: r2(r.lostOrdersAmount),
      lostQty,
      lostAmount: r2(lostAmount),
      lossRate: hasFinal ? pct(lostQty, r.preQty) : 0,
      lossRateAmount: hasFinal ? pct(lostAmount, r.preAmount) : 0,
    };
  });
  return rows.sort((a, b) => b.lostQty - a.lostQty || b.preQty - a.preQty);
}

export interface TrendTotals {
  preQty: number;
  preAmount: number;
  finalQty: number;
  finalAmount: number;
  lostOrdersQty: number;
  lostOrdersAmount: number;
  lossRate: number;
  lossRateAmount: number;
}

export function trendTotals(rows: TrendRow[]): TrendTotals {
  const t = { preQty: 0, preAmount: 0, finalQty: 0, finalAmount: 0, lostOrdersQty: 0, lostOrdersAmount: 0 };
  for (const r of rows) {
    t.preQty += r.preQty;
    t.preAmount += r.preAmount;
    t.finalQty += r.finalQty;
    t.finalAmount += r.finalAmount;
    t.lostOrdersQty += r.lostOrdersQty;
    t.lostOrdersAmount += r.lostOrdersAmount;
  }
  return {
    ...t,
    preAmount: r2(t.preAmount),
    finalAmount: r2(t.finalAmount),
    lostOrdersAmount: r2(t.lostOrdersAmount),
    lossRate: pct(t.preQty - t.finalQty, t.preQty),
    lossRateAmount: pct(t.preAmount - t.finalAmount, t.preAmount),
  };
}

export type Verdict = "tient" | "moyenne" | "perd";
export const VERDICT_LABELS: Record<Verdict, string> = {
  tient: "Tient bien",
  moyenne: "Dans la moyenne",
  perd: "Perd plus que la moyenne",
};

/** Verdict d'une ligne face au taux de perte moyen (écart de ±5 points). Ligne < 50 pièces : pas de verdict. */
export function verdictOf(lossRate: number, averageLossRate: number, preQty: number): Verdict | null {
  if (preQty < 50) return null;
  if (lossRate <= averageLossRate - 5) return "tient";
  if (lossRate >= averageLossRate + 5) return "perd";
  return "moyenne";
}

// ─── Évolution d'une saison à l'autre (précommandes) ────────────────────

export interface SeasonCategoryAgg {
  season: string; // ex. AH24
  seasonYear: number;
  seasonType: string; // AH | PE
  brand: Brand;
  category: string;
  qty: number;
  amount: number;
}

export interface CategoryEvolution {
  brand: Brand;
  category: string;
  bySeason: Record<string, { qty: number; amount: number; share: number }>; // share = % des pièces de la saison (marque)
  trend: "hausse" | "baisse" | "stable" | null; // sur les saisons du même type (AH ou PE), dernières vs premières
}

/** Évolution des précommandes par catégorie, saison par saison, et sens de la tendance. */
export function categoryEvolution(aggs: SeasonCategoryAgg[], seasonType: "AH" | "PE"): {
  seasons: string[];
  rows: CategoryEvolution[];
} {
  const list = aggs.filter((a) => a.seasonType === seasonType);
  const seasons = [...new Set(list.map((a) => `${a.seasonYear}|${a.season}`))].sort().map((s) => s.split("|")[1]);
  const seasonBrandTotal = new Map<string, number>();
  for (const a of list) seasonBrandTotal.set(`${a.season}|${a.brand}`, (seasonBrandTotal.get(`${a.season}|${a.brand}`) ?? 0) + a.qty);
  const map = new Map<string, CategoryEvolution>();
  for (const a of list) {
    const k = `${a.brand}|${a.category}`;
    const e = map.get(k) ?? { brand: a.brand, category: a.category, bySeason: {}, trend: null };
    const prev = e.bySeason[a.season] ?? { qty: 0, amount: 0, share: 0 };
    prev.qty += a.qty;
    prev.amount = r2(prev.amount + a.amount);
    prev.share = pct(prev.qty, seasonBrandTotal.get(`${a.season}|${a.brand}`) ?? 0);
    e.bySeason[a.season] = prev;
    map.set(k, e);
  }
  for (const e of map.values()) {
    const shares = seasons.map((s) => e.bySeason[s]?.share ?? 0);
    if (shares.length < 2) continue;
    const first = shares[0];
    const last = shares[shares.length - 1];
    const diff = last - first;
    e.trend = diff >= 2 ? "hausse" : diff <= -2 ? "baisse" : "stable";
  }
  const rows = [...map.values()].sort((a, b) => {
    const last = seasons[seasons.length - 1];
    return (b.bySeason[last]?.qty ?? 0) - (a.bySeason[last]?.qty ?? 0);
  });
  return { seasons, rows };
}

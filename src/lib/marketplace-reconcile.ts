// Rapprochement commandes marketplaces (Shopping Feed) ↔ commandes WooCommerce (GESTLOG-15).
// Clé : n° de commande marketplace (BtocOrder.marketplaceRef = MarketplaceOrder.reference),
// à défaut l'id Woo que Shopping Feed a créé (MarketplaceOrder.storeReference = BtocOrder.wooId).

export interface SfSide {
  sfId: string;
  reference: string;
  storeReference: string | null;
  channel: string;
  status: string;
  isTest: boolean;
  createdAt: string; // ISO (UTC)
  day: string; // AAAA-MM-JJ (Paris)
  total: number;
  qty: number;
}

export interface WooSide {
  wooId: number;
  orderNumber: string;
  marketplaceRef: string | null;
  marketplace: string | null;
  status: string;
  total: number;
  totalRefunded: number;
  qty: number;
  day: string; // AAAA-MM-JJ (Paris)
}

export type Kind =
  | "ok" // présente des deux côtés, cohérente
  | "ecart" // présente des deux côtés, avec un écart (montant, articles, statut)
  | "absente_woo" // sur la marketplace, introuvable dans WooCommerce / GestLog
  | "absente_sf" // dans WooCommerce (marquée marketplace), introuvable dans Shopping Feed
  | "en_attente" // pas encore acceptée, ou passée après la dernière synchro Woo : normal
  | "annulee"; // annulée / refusée avant import : normal qu'elle ne soit pas dans Woo

export interface ReconRow {
  kind: Kind;
  issues: string[];
  day: string;
  reference: string | null;
  channel: string | null;
  sfStatus: string | null;
  sfTotal: number | null;
  sfQty: number | null;
  wooId: number | null;
  wooNumber: string | null;
  wooStatus: string | null;
  wooTotal: number | null;
  wooRefunded: number | null;
  wooQty: number | null;
}

/**
 * Écart de prix habituel : La Redoute vend chaque article un peu plus cher que le site (règle de
 * prix Shopping Feed : 83 → 83,30, 86 → 86,80, 80 → 80,50…). Toléré jusqu'à 1 € par article.
 */
export const USUAL_GAP_PER_ITEM = 1;
const EPS = 0.05;

const SF_NOT_IMPORTED = new Set(["created", "waiting_store_acceptance"]);
const SF_CANCELLED = new Set(["cancelled", "refused"]);
const SF_REFUNDED = new Set(["refunded"]);
const WOO_CANCELLED = new Set(["cancelled", "failed", "trash"]);

export function amountIssue(sfTotal: number, wooTotal: number, qty: number): string | null {
  const gap = sfTotal - wooTotal;
  if (gap >= -EPS && gap <= USUAL_GAP_PER_ITEM * Math.max(qty, 1) + EPS) return null;
  return `montant : ${fmt(sfTotal)} sur la marketplace, ${fmt(wooTotal)} dans Woo`;
}

const fmt = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export function statusIssue(sf: SfSide, woo: WooSide): string | null {
  const wooCancelled = WOO_CANCELLED.has(woo.status);
  const wooRefunded = woo.status === "refunded" || (woo.total > 0 && woo.totalRefunded >= woo.total - EPS);
  if (SF_CANCELLED.has(sf.status) && !wooCancelled && !wooRefunded) return "annulée sur la marketplace, pas dans Woo";
  if (SF_REFUNDED.has(sf.status) && !wooRefunded && !wooCancelled) return "remboursée sur la marketplace, pas dans Woo";
  if (!SF_CANCELLED.has(sf.status) && !SF_REFUNDED.has(sf.status) && sf.status !== "partially_refunded") {
    if (wooCancelled) return "annulée dans Woo, pas sur la marketplace";
    if (wooRefunded) return "remboursée dans Woo, pas sur la marketplace";
  }
  return null;
}

/**
 * @param lastWooSync ISO de la commande Woo la plus récente connue de GestLog : une commande
 *   marketplace plus récente ne peut pas encore y être (« en attente », pas une anomalie).
 */
export function reconcile(sf: SfSide[], woo: WooSide[], lastWooSync: string | null): ReconRow[] {
  const byRef = new Map<string, WooSide>();
  const byId = new Map<string, WooSide>();
  for (const w of woo) {
    if (w.marketplaceRef) byRef.set(w.marketplaceRef, w);
    byId.set(String(w.wooId), w);
  }
  const used = new Set<number>();
  const rows: ReconRow[] = [];

  for (const s of sf) {
    if (s.isTest) continue;
    const w = byRef.get(s.reference) ?? (s.storeReference ? byId.get(s.storeReference) : undefined);
    const base = {
      day: s.day,
      reference: s.reference,
      channel: s.channel,
      sfStatus: s.status,
      sfTotal: s.total,
      sfQty: s.qty,
    };
    if (!w) {
      let kind: Kind = "absente_woo";
      const issues: string[] = [];
      if (SF_NOT_IMPORTED.has(s.status)) issues.push("pas encore acceptée");
      else if (SF_CANCELLED.has(s.status)) issues.push("annulée ou refusée avant import");
      else if (lastWooSync && s.createdAt > lastWooSync) issues.push("passée après la dernière synchro Woo");
      else issues.push(s.storeReference ? `commande Woo n°${s.storeReference} introuvable` : "jamais importée dans Woo");
      if (SF_NOT_IMPORTED.has(s.status) || (lastWooSync && s.createdAt > lastWooSync)) kind = "en_attente";
      else if (SF_CANCELLED.has(s.status)) kind = "annulee";
      rows.push({ kind, issues, ...base, wooId: null, wooNumber: null, wooStatus: null, wooTotal: null, wooRefunded: null, wooQty: null });
      continue;
    }
    used.add(w.wooId);
    const issues = [
      amountIssue(s.total, w.total, s.qty),
      s.qty !== w.qty ? `articles : ${s.qty} sur la marketplace, ${w.qty} dans Woo` : null,
      statusIssue(s, w),
    ].filter((x): x is string => !!x);
    rows.push({
      kind: issues.length ? "ecart" : "ok",
      issues,
      ...base,
      wooId: w.wooId,
      wooNumber: w.orderNumber,
      wooStatus: w.status,
      wooTotal: w.total,
      wooRefunded: w.totalRefunded,
      wooQty: w.qty,
    });
  }

  for (const w of woo) {
    if (!w.marketplace || used.has(w.wooId)) continue;
    rows.push({
      kind: "absente_sf",
      issues: ["marquée marketplace dans Woo, introuvable dans Shopping Feed"],
      day: w.day,
      reference: w.marketplaceRef,
      channel: w.marketplace,
      sfStatus: null,
      sfTotal: null,
      sfQty: null,
      wooId: w.wooId,
      wooNumber: w.orderNumber,
      wooStatus: w.status,
      wooTotal: w.total,
      wooRefunded: w.totalRefunded,
      wooQty: w.qty,
    });
  }

  return rows.sort((a, b) => b.day.localeCompare(a.day) || String(a.reference).localeCompare(String(b.reference)));
}

export const KIND_LABELS: Record<Kind, string> = {
  ok: "Cohérente",
  ecart: "Écart",
  absente_woo: "Absente de Woo",
  absente_sf: "Absente de Shopping Feed",
  en_attente: "En attente (normal)",
  annulee: "Annulée avant import (normal)",
};

export const ANOMALY_KINDS: Kind[] = ["ecart", "absente_woo", "absente_sf"];

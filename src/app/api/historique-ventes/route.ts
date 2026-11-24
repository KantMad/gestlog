import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { globalCategoryLabel, normalizeTitle, UNCLASSIFIED } from "@/lib/btoc-global-category";
import {
  b2bAggregates,
  colorLabels,
  liveStartDay,
  monthlyCoverage,
  salesAggregates,
  type B2bScope,
} from "@/lib/sales-history-db";
import {
  b2bPeriod,
  groupSalesRows,
  UNKNOWN_COLOR,
  UNKNOWN_SIZE,
  type GroupMode,
  type RawSalesRow,
} from "@/lib/sales-history";

// GET — ventes agrégées par période × modèle × couleur × taille, pour l'écran
// Analyse → Historique des ventes.
// Paramètres :
//   channel    : btoc (défaut — site WooCommerce, période = année) | b2b (commandes
//                clients, période = saison ; réassort / hors-saison par année de commande)
//   group      : code (défaut, PULL_W001) | ref (MPULL_W001) | name (nom du produit)
//   categories : catégories globales séparées par des virgules (vide = toutes)
//   q          : texte cherché dans le nom du produit ou la référence
//   dateFrom / dateTo : AAAA-MM-JJ, inclus — BtoC seulement (en B2B, des commandes TEXAS
//                n'ont pas de date : un filtre de date les écarterait en silence)
//   scope      : B2B seulement — all | collection (saisons PE/AH) | reassort
// La catégorie est déduite du NOM (lib/btoc-global-category, testée), en TypeScript, et
// attribuée au MODÈLE entier : un modèle n'est jamais coupé en deux par le filtre.

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MODES: GroupMode[] = ["code", "ref", "name"];
const SCOPES: B2bScope[] = ["all", "collection", "reassort"];

export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const channel = p.get("channel") === "b2b" ? "b2b" : "btoc";
    const mode = (MODES as string[]).includes(p.get("group") || "") ? (p.get("group") as GroupMode) : "code";
    const scope = (SCOPES as string[]).includes(p.get("scope") || "") ? (p.get("scope") as B2bScope) : "all";
    const categories = new Set((p.get("categories") || "").split(",").map((c) => c.trim()).filter(Boolean));
    const q = normalizeTitle(p.get("q") || "");
    const dateFrom = DAY.test(p.get("dateFrom") || "") ? p.get("dateFrom") : null;
    const dateTo = DAY.test(p.get("dateTo") || "") ? p.get("dateTo") : null;

    const colors = await colorLabels();
    const colorOf = (code: string | null, fallback?: string | null) => {
      if (!code) return fallback || UNKNOWN_COLOR;
      const k = code.padStart(3, "0");
      return colors.get(k) ?? (fallback || `Code ${code}`);
    };

    let base: RawSalesRow[];
    let liveStart: string | null = null;
    let coverage: { month: string; history: number; live: number }[] = [];
    if (channel === "btoc") {
      liveStart = await liveStartDay();
      const [raw, cov] = await Promise.all([salesAggregates(liveStart, dateFrom, dateTo), monthlyCoverage(liveStart)]);
      coverage = cov;
      base = raw.map((r) => ({
        year: r.year,
        period: String(r.year),
        reference: r.reference,
        productName: r.productName,
        color: colorOf(r.colorCode),
        size: r.size || UNKNOWN_SIZE,
        qty: r.qty,
        amount: Math.round(r.amount * 100) / 100,
      }));
    } else {
      const raw = await b2bAggregates(scope);
      base = raw.map((r) => ({
        ...b2bPeriod({ name: r.seasonName, year: r.seasonYear, type: r.seasonType }, r.orderYear),
        reference: r.reference,
        productName: r.productName,
        color: colorOf(r.colorCode, r.colorLabel),
        size: r.size || UNKNOWN_SIZE,
        qty: r.qty,
        amount: Math.round(r.amount * 100) / 100,
      }));
    }

    const grouped = groupSalesRows(base, mode, globalCategoryLabel, UNCLASSIFIED);

    const categoryCounts = new Map<string, number>();
    for (const r of grouped) categoryCounts.set(r.category, (categoryCounts.get(r.category) ?? 0) + r.qty);

    // Recherche : un modèle est retenu si l'un de ses noms, sa clé ou une de ses références contient le texte.
    let rows = categories.size ? grouped.filter((r) => categories.has(r.category)) : grouped;
    if (q) {
      const hit = new Set(
        rows
          .filter((r) => normalizeTitle(`${r.productName} ${r.model} ${r.reference ?? ""}`).includes(q))
          .map((r) => r.model)
      );
      rows = rows.filter((r) => hit.has(r.model));
    }

    // Volume par période, toutes catégories (couverture B2B, l'équivalent des mois en BtoC).
    const periodTotals = new Map<number, { period: string; qty: number }>();
    for (const r of base) {
      const e = periodTotals.get(r.year) ?? { period: r.period, qty: 0 };
      e.qty += r.qty;
      periodTotals.set(r.year, e);
    }

    return NextResponse.json({
      channel,
      rows,
      liveStart,
      coverage,
      periods: [...periodTotals.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v),
      categories: [...categoryCounts.entries()]
        .map(([name, qty]) => ({ name, qty }))
        .sort((a, b) => b.qty - a.qty),
    });
  } catch (e) {
    return handleApiError(e, "api/historique-ventes");
  }
}

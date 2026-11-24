import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { globalCategoryLabel, normalizeTitle } from "@/lib/btoc-global-category";
import { colorLabels, liveStartDay, monthlyCoverage, salesAggregates } from "@/lib/sales-history-db";
import { UNKNOWN_COLOR, UNKNOWN_SIZE, type SalesAggRow } from "@/lib/sales-history";

// GET — ventes BtoC agrégées par année × produit × couleur × taille (historique importé +
// ventes live), pour l'écran BtoC → Historique ventes.
// Paramètres : category (catégorie globale, « all » = toutes), q (texte dans le nom du
// produit), dateFrom / dateTo (AAAA-MM-JJ, inclus).
// La catégorie est déduite du NOM du produit en TypeScript (lib/btoc-global-category,
// testée) — pas de réécriture de la table de mots-clés en SQL.

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const category = p.get("category") || "all";
    const q = normalizeTitle(p.get("q") || "");
    const dateFrom = DAY.test(p.get("dateFrom") || "") ? p.get("dateFrom") : null;
    const dateTo = DAY.test(p.get("dateTo") || "") ? p.get("dateTo") : null;

    const cutoff = await liveStartDay();
    const [raw, colors, coverage] = await Promise.all([
      salesAggregates(cutoff, dateFrom, dateTo),
      colorLabels(),
      monthlyCoverage(cutoff),
    ]);

    const categoryCounts = new Map<string, number>();
    const rows: SalesAggRow[] = [];
    for (const r of raw) {
      const cat = globalCategoryLabel(r.productName);
      categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + r.qty);
      if (category !== "all" && cat !== category) continue;
      if (q && !normalizeTitle(r.productName).includes(q)) continue;
      const code = r.colorCode ? r.colorCode.padStart(3, "0") : null;
      rows.push({
        year: r.year,
        productName: r.productName,
        category: cat,
        color: code ? (colors.get(code) ?? `Code ${r.colorCode}`) : UNKNOWN_COLOR,
        size: r.size || UNKNOWN_SIZE,
        qty: r.qty,
        amount: Math.round(r.amount * 100) / 100,
      });
    }

    return NextResponse.json({
      rows,
      liveStart: cutoff,
      coverage,
      categories: [...categoryCounts.entries()]
        .map(([name, qty]) => ({ name, qty }))
        .sort((a, b) => b.qty - a.qty),
    });
  } catch (e) {
    return handleApiError(e, "api/btoc/sales-history");
  }
}

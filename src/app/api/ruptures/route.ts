import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { globalCategoryLabel, normalizeTitle } from "@/lib/btoc-global-category";
import { modelKeyOf, parseSku } from "@/lib/sales-history";
import { addDays, buildStockOutReport } from "@/lib/stock-outs";
import { salesBySku, snapshotSpan, stockOutPeriods } from "@/lib/stock-outs-db";

// GET — ruptures de stock du site BtoC et ventes manquées estimées (GESTLOG-14).
// Paramètres : dateFrom / dateTo (AAAA-MM-JJ, inclus ; défaut : 1er janvier → dernière photo),
//              windowDays (fenêtre du rythme de vente, défaut 365), q (nom / UGS).
// Rythme de vente d'une UGS = pièces vendues sur la fenêtre ÷ jours EN STOCK sur la fenêtre ;
// ventes manquées = rythme × jours de rupture dans la période. Voir lib/stock-outs.ts.

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TOP_MODELS = 20;

export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const span = await snapshotSpan();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
    const last = span.last ?? today;
    const to = DAY.test(p.get("dateTo") || "") ? (p.get("dateTo") as string) : last;
    const from = DAY.test(p.get("dateFrom") || "") ? (p.get("dateFrom") as string) : `${to.slice(0, 4)}-01-01`;
    const windowDays = Math.min(730, Math.max(30, Number(p.get("windowDays")) || 365));
    const windowFrom = addDays(to, 1 - windowDays);
    const q = normalizeTitle(p.get("q") || "");

    const [periods, sales] = await Promise.all([
      stockOutPeriods(from < windowFrom ? from : windowFrom, to),
      salesBySku(windowFrom, to),
    ]);

    // Meilleures ventes : modèles (code PULL_W001…) classés par pièces vendues sur la fenêtre.
    const modelQty = new Map<string, number>();
    for (const [sku, s] of sales) {
      const ref = parseSku(sku).reference;
      if (!ref) continue;
      const key = modelKeyOf(ref, "", "code");
      modelQty.set(key, (modelQty.get(key) ?? 0) + s.qty);
    }
    const rank = new Map(
      [...modelQty.entries()].sort((a, b) => b[1] - a[1]).map(([k], i) => [k, i + 1] as const)
    );

    const rows = buildStockOutReport(periods, sales, { from, to, windowFrom, lastSnapshotDay: last })
      .map((r) => {
        const model = modelKeyOf(r.reference, r.productName, "code");
        return {
          ...r,
          model,
          category: globalCategoryLabel(r.productName),
          modelRank: rank.get(model) ?? null,
          bestSeller: (rank.get(model) ?? Infinity) <= TOP_MODELS,
        };
      })
      .filter((r) => !q || normalizeTitle(`${r.productName} ${r.sku ?? ""} ${r.model}`).includes(q));

    return NextResponse.json({
      from,
      to,
      windowFrom,
      windowDays,
      topModels: TOP_MODELS,
      tracking: span,
      rows,
    });
  } catch (e) {
    return handleApiError(e, "api/ruptures");
  }
}

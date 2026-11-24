import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { globalCategoryLabel, normalizeTitle, UNCLASSIFIED } from "@/lib/btoc-global-category";
import { colorLabels, liveStartDay, monthlyCoverage, salesAggregates } from "@/lib/sales-history-db";
import { groupSalesRows, UNKNOWN_COLOR, UNKNOWN_SIZE, type GroupMode, type RawSalesRow } from "@/lib/sales-history";

// GET — ventes BtoC agrégées par année × modèle × couleur × taille (historique importé +
// ventes live), pour l'écran BtoC → Historique ventes.
// Paramètres :
//   group      : code (défaut, PULL_W001) | ref (MPULL_W001) | name (nom du produit)
//   categories : catégories globales séparées par des virgules (vide = toutes)
//   q          : texte cherché dans le nom du produit ou la référence
//   dateFrom / dateTo : AAAA-MM-JJ, inclus
// La catégorie est déduite du NOM (lib/btoc-global-category, testée), en TypeScript, et
// attribuée au MODÈLE entier (catégorie dominante) : un modèle n'est jamais coupé en deux
// par le filtre.

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MODES: GroupMode[] = ["code", "ref", "name"];

export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const mode = (MODES as string[]).includes(p.get("group") || "") ? (p.get("group") as GroupMode) : "code";
    const categories = new Set((p.get("categories") || "").split(",").map((c) => c.trim()).filter(Boolean));
    const q = normalizeTitle(p.get("q") || "");
    const dateFrom = DAY.test(p.get("dateFrom") || "") ? p.get("dateFrom") : null;
    const dateTo = DAY.test(p.get("dateTo") || "") ? p.get("dateTo") : null;

    const cutoff = await liveStartDay();
    const [raw, colors, coverage] = await Promise.all([
      salesAggregates(cutoff, dateFrom, dateTo),
      colorLabels(),
      monthlyCoverage(cutoff),
    ]);

    const base: RawSalesRow[] = raw.map((r) => {
      const code = r.colorCode ? r.colorCode.padStart(3, "0") : null;
      return {
        year: r.year,
        reference: r.reference,
        productName: r.productName,
        color: code ? (colors.get(code) ?? `Code ${r.colorCode}`) : UNKNOWN_COLOR,
        size: r.size || UNKNOWN_SIZE,
        qty: r.qty,
        amount: Math.round(r.amount * 100) / 100,
      };
    });
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

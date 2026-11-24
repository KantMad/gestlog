import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { buildTrendRows, categoryEvolution, trendTotals, verdictOf, type Brand, type TrendLevel } from "@/lib/trends";
import { incompleteTio, seasonCategoryAggs, trendLines, trendSeasons, unpairedFinal } from "@/lib/trends-db";

export const maxDuration = 60;

// GET — Analyse des tendances B2B (GESTLOG-12) : précommandes (TIO) contre commandes
// finales (Texas), par marque (MCS / TDH), et évolution des précommandes par catégorie.
// Paramètres : seasonId (défaut : la plus récente qui a des commandes Texas, sinon la plus
// récente), level (category | subCategory | product | color), brand (MCS | TDH | vide = les deux).

const LEVELS: TrendLevel[] = ["category", "subCategory", "product", "color"];

export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const level = (LEVELS as string[]).includes(p.get("level") || "") ? (p.get("level") as TrendLevel) : "category";
    const brandParam = p.get("brand");
    const brand: Brand | null = brandParam === "MCS" || brandParam === "TDH" ? brandParam : null;

    const seasons = await trendSeasons();
    const season =
      seasons.find((s) => s.id === p.get("seasonId")) ?? seasons.find((s) => s.hasFinal) ?? seasons[0] ?? null;
    if (!season) return NextResponse.json({ seasons, season: null, rows: [] });

    const [lines, unpaired, incomplete, aggs] = await Promise.all([
      trendLines(season.id),
      season.hasFinal ? unpairedFinal(season.id) : Promise.resolve(null),
      incompleteTio(season.id),
      seasonCategoryAggs(),
    ]);
    const scoped = brand ? lines.filter((l) => l.brand === brand) : lines;

    const totalsByBrand = (["MCS", "TDH"] as Brand[]).map((b) => ({
      brand: b,
      ...trendTotals(buildTrendRows(lines.filter((l) => l.brand === b), "category", season.hasFinal)),
    }));
    const totals = trendTotals(buildTrendRows(scoped, "category", season.hasFinal));

    const rows = buildTrendRows(scoped, level, season.hasFinal).map((r) => {
      // Verdict face à la moyenne de SA marque (TDH ne doit pas fausser MCS).
      const avg = totalsByBrand.find((t) => t.brand === r.brand)?.lossRate ?? totals.lossRate;
      return { ...r, verdict: season.hasFinal ? verdictOf(r.lossRate, avg, r.preQty) : null };
    });

    const evolution = categoryEvolution(
      brand ? aggs.filter((a) => a.brand === brand) : aggs,
      season.type === "PE" ? "PE" : "AH"
    );

    return NextResponse.json({ seasons, season, level, brand, totals, totalsByBrand, unpaired, incomplete, rows, evolution });
  } catch (e) {
    return handleApiError(e, "api/tendances");
  }
}

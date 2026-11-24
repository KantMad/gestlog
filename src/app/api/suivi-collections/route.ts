import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { familyCounts, NON_COLLECTION, sumCounts } from "@/lib/collections";
import { catalogSnapshotSpan, clientOrderedIds, collectionItems, factoryOrderedIds, tioCatalogs } from "@/lib/collections-db";

export const maxDuration = 60;

// GET — suivi des collections (GESTLOG-13) : produits et coloris présentés dans les
// catalogues TIO d'une saison, retirés, commandés par les clients et commandés à l'usine.
// Paramètres : season (AH26, PE27… ; défaut : la plus récente), catalogs (ids TIO séparés par
// des virgules ; défaut : catalogues de collection de la saison — hors stock / offre /
// proposition…, cf. NON_COLLECTION), family (category | subCategory).

export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const family = p.get("family") === "subCategory" ? "subCategory" : "category";
    const catalogs = await tioCatalogs();
    const seasonOrder = (s: string) => Number(s.slice(2)) * 10 + (s.startsWith("AH") ? 2 : 1);
    const seasons = [...new Set(catalogs.map((c) => c.seasonName).filter((s): s is string => !!s))].sort(
      (a, b) => seasonOrder(b) - seasonOrder(a)
    );
    const season = seasons.includes(p.get("season") || "") ? (p.get("season") as string) : (seasons[0] ?? null);
    const isDefault = (c: (typeof catalogs)[number]) => !c.deleted && !NON_COLLECTION.test(c.name) && c.items > 0;

    const seasonCatalogs = catalogs.filter((c) => c.seasonName === season);
    const requested = (p.get("catalogs") || "")
      .split(",")
      .map(Number)
      .filter((n) => seasonCatalogs.some((c) => c.tioCatalogId === n));
    const selected = requested.length ? requested : seasonCatalogs.filter(isDefault).map((c) => c.tioCatalogId);

    const tracking = await catalogSnapshotSpan();
    if (!season) return NextResponse.json({ seasons, season, catalogs: [], rows: [], comparison: [], tracking });

    const [items, clientIds, factory] = await Promise.all([
      collectionItems(selected, family),
      clientOrderedIds(season),
      factoryOrderedIds(season),
    ]);
    const rows = familyCounts(items, clientIds, factory.ids, factory.hasFactory);
    const total = sumCounts(rows, factory.hasFactory);

    // Retraits et ajouts DATÉS (depuis le début du relevé), les plus récents d'abord.
    const events = items
      .filter((i) => i.removedDay || i.addedDuringTracking)
      .map((i) => ({
        kind: i.removedDay ? "retiré" : "ajouté",
        day: i.removedDay,
        catalog: catalogs.find((c) => c.tioCatalogId === i.tioCatalogId)?.name ?? String(i.tioCatalogId),
        reference: i.reference,
        label: i.label,
        color: i.color,
        family: i.category,
      }))
      .sort((a, b) => String(b.day ?? "").localeCompare(String(a.day ?? "")))
      .slice(0, 300);

    // Comparaison d'une saison à l'autre (catalogues de collection par défaut, familles = catégories).
    const comparison = await Promise.all(
      seasons.map(async (s) => {
        const ids = catalogs.filter((c) => c.seasonName === s && isDefault(c)).map((c) => c.tioCatalogId);
        const [its, cl, fa] = await Promise.all([collectionItems(ids, "category"), clientOrderedIds(s), factoryOrderedIds(s)]);
        return { season: s, catalogs: ids.length, hasFactory: fa.hasFactory, ...sumCounts(familyCounts(its, cl, fa.ids, fa.hasFactory), fa.hasFactory) };
      })
    );

    return NextResponse.json({
      seasons,
      season,
      family,
      catalogs: seasonCatalogs.map((c) => ({ ...c, selected: selected.includes(c.tioCatalogId), isDefault: isDefault(c) })),
      hasFactory: factory.hasFactory,
      rows,
      total,
      events,
      comparison,
      tracking,
    });
  } catch (e) {
    return handleApiError(e, "api/suivi-collections");
  }
}

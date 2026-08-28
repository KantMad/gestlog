import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

// GET — Liste des SKU de produits PARENTS WooCommerce, pour un fichier de ré-import.
//   ?mode=include|exclude   (défaut : include)
//   ?prefixes=RM,PM         préfixes de SKU (vide en mode include = tous)
//   ?status=publish|draft|all   (défaut : publish)
//
// « Parent » = `type = 'variable'` : le produit qui porte les déclinaisons taille/couleur.
// Les variations elles-mêmes ne sont pas listées.
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const mode = p.get("mode") === "exclude" ? "exclude" : "include";
    const prefixes = (p.get("prefixes") || "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const status = p.get("status") || "publish";

    const where: Record<string, unknown> = { type: "variable", sku: { not: null } };
    if (status === "publish" || status === "draft") where.status = status;

    const rows = await prisma.btocProduct.findMany({
      where,
      select: { sku: true, name: true, status: true },
      orderBy: { sku: "asc" },
    });

    // Filtrage par préfixe. En mode « include » sans préfixe, on prend tout ; en mode
    // « exclude » sans préfixe, on n'exclut rien — dans les deux cas : la liste complète.
    const matches = (sku: string) =>
      prefixes.length === 0 ? true : prefixes.some((pre) => sku.toUpperCase().startsWith(pre));

    const seen = new Set<string>();
    const skus: { sku: string; name: string; status: string }[] = [];
    for (const r of rows) {
      const sku = String(r.sku || "").trim();
      if (!sku) continue;
      const keep = mode === "include" ? matches(sku) : !matches(sku);
      if (!keep) continue;
      // Un même SKU parent peut exister en double côté Woo → une seule ligne.
      const k = sku.toUpperCase();
      if (seen.has(k)) continue;
      seen.add(k);
      skus.push({ sku, name: r.name, status: r.status });
    }

    // Préfixes disponibles (2 premiers caractères), pour guider la saisie à l'écran.
    const prefixCounts = new Map<string, number>();
    for (const r of rows) {
      const pre = String(r.sku || "").slice(0, 2).toUpperCase();
      if (pre) prefixCounts.set(pre, (prefixCounts.get(pre) || 0) + 1);
    }

    return NextResponse.json({
      skus,
      meta: {
        total: rows.length,
        returned: skus.length,
        availablePrefixes: [...prefixCounts.entries()]
          .map(([prefix, count]) => ({ prefix, count }))
          .sort((a, b) => b.count - a.count),
      },
    });
  } catch (e) {
    return handleApiError(e, "api/btoc/export/parents");
  }
}

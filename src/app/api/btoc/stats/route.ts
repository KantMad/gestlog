import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parisRangeToUtc } from "@/lib/btoc-dates";
import { globalCategoryLabel, allGlobalCategories, UNCLASSIFIED } from "@/lib/btoc-global-category";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const dateFrom = params.get("dateFrom");
    const dateTo = params.get("dateTo");
    const category = params.get("category");
    const parentProduct = params.get("parentProduct"); // now expects a SKU / reference
    const customerId = params.get("customerId");
    // Catégorie GLOBALE : déduite du titre du produit, pas des catégories WooCommerce.
    const globalCategory = params.get("globalCategory");
    // Bornes de dates en fuseau Paris (jour de fin INCLUS, cf. lib/btoc-dates).
    const { gte: dateGte, lt: dateLt } = parisRangeToUtc(dateFrom, dateTo);

    // ─── Build WHERE clauses for orders ──────────────────────
    const orderConditions: string[] = [];
    const orderParams: unknown[] = [];
    let paramIndex = 1;

    if (dateFrom) {
      orderConditions.push(`o."orderDate" >= $${paramIndex}`);
      orderParams.push(dateGte!);
      paramIndex++;
    }
    if (dateTo) {
      orderConditions.push(`o."orderDate" < $${paramIndex}`);
      orderParams.push(dateLt!);
      paramIndex++;
    }
    if (customerId) {
      orderConditions.push(`o."customerId" = $${paramIndex}`);
      orderParams.push(customerId);
      paramIndex++;
    }

    // La catégorie globale se calcule en TypeScript (cf. lib/btoc-global-category) :
    // on classe les titres une fois, puis on ne passe au SQL que la liste des SKU
    // parents retenus. Rejouer la table de mots-clés en SQL serait illisible et
    // divergerait de la version testée.
    let globalCategorySkus: string[] = [];
    if (globalCategory) {
      const prods = await prisma.btocProduct.findMany({
        where: { sku: { not: null } },
        select: { sku: true, name: true },
      });
      const seen = new Set<string>();
      for (const pr of prods) {
        const parent = (pr.sku ?? "").split("-")[0];
        if (!parent || seen.has(parent)) continue;
        if (globalCategoryLabel(pr.name) === globalCategory) seen.add(parent);
      }
      globalCategorySkus = [...seen];
      // Aucun produit : on force une liste impossible pour que le résultat soit vide
      // plutôt que non filtré.
      if (globalCategorySkus.length === 0) globalCategorySkus = ["__aucun__"];
    }

    // Category, parentProduct et globalCategory imposent la jointure sur les lignes
    const needsLineJoin = !!category || !!parentProduct || !!globalCategory;
    let lineJoin = "";
    // Index des paramètres du filtre de ligne : ils sont RÉUTILISÉS tels quels par
    // `lineScopeSql`, qui rejoue les mêmes prédicats sous d'autres alias.
    let categoryIdx = 0;
    let parentIdx = 0;
    let globalIdx = 0;
    if (needsLineJoin) {
      lineJoin = `JOIN "BtocOrderLine" ol ON ol."orderId" = o.id
                  LEFT JOIN "BtocProduct" p ON p.sku = SPLIT_PART(ol.sku, '-', 1)`;
      if (category) {
        categoryIdx = paramIndex;
        orderConditions.push(`p.category ILIKE '%' || $${paramIndex} || '%'`);
        orderParams.push(category);
        paramIndex++;
      }
      if (parentProduct) {
        parentIdx = paramIndex;
        orderConditions.push(`p.sku ILIKE $${paramIndex}`);
        orderParams.push(`%${parentProduct}%`);
        paramIndex++;
      }
      if (globalCategory) {
        globalIdx = paramIndex;
        orderConditions.push(`SPLIT_PART(ol.sku, '-', 1) = ANY($${paramIndex})`);
        orderParams.push(globalCategorySkus);
        paramIndex++;
      }
    }

    /** Le filtre de ligne courant, rejoué sur d'autres alias (sous-requêtes). */
    const lineScopeSql = (lineAlias: string, prodAlias: string) => {
      const parts: string[] = [];
      if (categoryIdx) parts.push(`${prodAlias}.category ILIKE '%' || $${categoryIdx} || '%'`);
      if (parentIdx) parts.push(`${prodAlias}.sku ILIKE $${parentIdx}`);
      if (globalIdx) parts.push(`SPLIT_PART(${lineAlias}.sku, '-', 1) = ANY($${globalIdx})`);
      return parts.length > 0 ? parts.join(" AND ") : "TRUE";
    };

    const whereClause =
      orderConditions.length > 0
        ? "WHERE " + orderConditions.join(" AND ")
        : "";

    // Filtre "chiffre d'affaires" : on exclut les commandes annulées, remboursées
    // et échouées (cohérent avec les exports). Appliqué aux requêtes de CA
    // UNIQUEMENT — pas au graphe "commandes par statut" qui doit tout afficher.
    const REVENUE_FILTER = `o.status NOT IN ('cancelled', 'refunded', 'failed')`;
    const revenueWhere = whereClause
      ? `${whereClause} AND ${REVENUE_FILTER}`
      : `WHERE ${REVENUE_FILTER}`;

    // ⚠️ « Articles vendus » : `BtocOrder.itemCount` compte la commande ENTIÈRE. Avec un
    // filtre catégorie ou produit parent, cela comptait aussi les articles des AUTRES
    // catégories présents dans la même commande. *Cas réel — Pantalons du 16/03 au
    // 31/08/2026 : 624 articles affichés pour 405 réellement vendus (+54 %).* Dès qu'un
    // filtre de ligne est actif, on ne compte donc que les lignes RETENUES.
    const itemCountExpr = needsLineJoin
      ? `(SELECT COALESCE(SUM(ol2.quantity), 0)
          FROM "BtocOrderLine" ol2
          LEFT JOIN "BtocProduct" p2 ON p2.sku = SPLIT_PART(ol2.sku, '-', 1)
          WHERE ol2."orderId" = o.id AND ${lineScopeSql("ol2", "p2")})`
      : `o."itemCount"`;
    const refQtyExpr = needsLineJoin
      ? `(SELECT COALESCE(SUM(rl.quantity), 0)
          FROM "BtocRefundLine" rl
          LEFT JOIN "BtocProduct" p3 ON p3.sku = SPLIT_PART(rl.sku, '-', 1)
          WHERE rl."orderWooId" = o."wooId" AND ${lineScopeSql("rl", "p3")})`
      : `(SELECT COALESCE(SUM(rl.quantity), 0) FROM "BtocRefundLine" rl WHERE rl."orderWooId" = o."wooId")`;

    // ─── Overview ────────────────────────────────────────────
    const overviewRows = await prisma.$queryRawUnsafe<
      {
        totalOrders: bigint;
        totalRevenue: number;
        netRevenue: number;
        totalCustomers: bigint;
        avgOrderValue: number;
        totalItems: bigint;
      }[]
    >(
      // On dédoublonne les commandes (le lineJoin éventuel multiplie les lignes)
      // via une sous-requête DISTINCT par id, PUIS on agrège — sinon SUM(DISTINCT
      // o.total) fusionne à tort deux commandes de même montant (CA sous-estimé).
      `SELECT
        COUNT(*) AS "totalOrders",
        COALESCE(SUM(o.total - o."totalRefunded"), 0) AS "totalRevenue",
        COALESCE(SUM(o.total - o."totalRefunded" - COALESCE(o."totalTax",0) - COALESCE(o."shippingTotal",0)), 0) AS "netRevenue",
        COUNT(DISTINCT o."customerId") AS "totalCustomers",
        CASE WHEN COUNT(*) > 0
          THEN ROUND((SUM(o.total - o."totalRefunded") / COUNT(*))::numeric, 2)
          ELSE 0 END AS "avgOrderValue",
        COALESCE(SUM(GREATEST(o."itemCount" - o."refQty", 0)), 0) AS "totalItems"
      FROM (
        SELECT DISTINCT o.id, o.total, o."totalRefunded", o."totalTax", o."shippingTotal", o."customerId",
          ${itemCountExpr} AS "itemCount",
          ${refQtyExpr} AS "refQty"
        FROM "BtocOrder" o
        ${lineJoin}
        ${revenueWhere}
      ) o`,
      ...orderParams
    );

    const overview = {
      totalOrders: Number(overviewRows[0]?.totalOrders ?? 0),
      totalRevenue: Number(overviewRows[0]?.totalRevenue ?? 0),
      netRevenue: Number(overviewRows[0]?.netRevenue ?? 0),
      totalCustomers: Number(overviewRows[0]?.totalCustomers ?? 0),
      avgOrderValue: Number(overviewRows[0]?.avgOrderValue ?? 0),
      totalItems: Number(overviewRows[0]?.totalItems ?? 0),
    };

    // ─── Revenue by month (last 12 months) ───────────────────
    const revenueByMonth = await prisma.$queryRawUnsafe<
      { month: string; revenue: number; orders: bigint }[]
    >(
      // ⚠️ `lineJoin` multiplie la commande par son nombre de lignes retenues : sans le
      // DISTINCT ci-dessous, `SUM(o.total)` comptait la même commande plusieurs fois.
      // *Cas réel — Pantalons du 16/03 au 31/08/2026 : 74 942,60 € affichés pour
      // 46 002,20 € réels (x1,63), en contradiction avec la tuile CA, elle dédoublonnée.*
      `SELECT
        TO_CHAR(((o."orderDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris'), 'YYYY-MM') AS month,
        COALESCE(SUM(o.total - o."totalRefunded"), 0) AS revenue,
        COUNT(*) AS orders
      FROM (
        SELECT DISTINCT o.id, o."orderDate", o.total, o."totalRefunded"
        FROM "BtocOrder" o
        ${lineJoin}
        ${revenueWhere} AND o."orderDate" >= NOW() - INTERVAL '12 months'
      ) o
      GROUP BY TO_CHAR(((o."orderDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris'), 'YYYY-MM')
      ORDER BY month ASC`,
      ...orderParams
    );

    // ─── Top products by revenue ─────────────────────────────
    // Build conditions for the order-lines query
    const topProductConditions: string[] = [];
    const topProductParams: unknown[] = [];
    let tpIdx = 1;

    if (dateFrom) {
      topProductConditions.push(`o."orderDate" >= $${tpIdx}`);
      topProductParams.push(dateGte!);
      tpIdx++;
    }
    if (dateTo) {
      topProductConditions.push(`o."orderDate" < $${tpIdx}`);
      topProductParams.push(dateLt!);
      tpIdx++;
    }
    if (customerId) {
      topProductConditions.push(`o."customerId" = $${tpIdx}`);
      topProductParams.push(customerId);
      tpIdx++;
    }
    if (category) {
      topProductConditions.push(`p.category ILIKE '%' || $${tpIdx} || '%'`);
      topProductParams.push(category);
      tpIdx++;
    }
    if (parentProduct) {
      topProductConditions.push(`p.sku ILIKE $${tpIdx}`);
      topProductParams.push(`%${parentProduct}%`);
      tpIdx++;
    }
    if (globalCategory) {
      topProductConditions.push(`SPLIT_PART(ol.sku, '-', 1) = ANY($${tpIdx})`);
      topProductParams.push(globalCategorySkus);
      tpIdx++;
    }

    topProductConditions.push(REVENUE_FILTER);
    const tpWhere =
      topProductConditions.length > 0
        ? "WHERE " + topProductConditions.join(" AND ")
        : "";

    // Branche remboursements (déduits des ventes) : elle doit porter EXACTEMENT les
    // mêmes filtres que la branche ventes.
    // ⚠️ Elle ignorait catégorie / produit parent : avec un filtre « Pantalons », les
    // remboursements de chemises étaient injectés en négatif dans le Top produits —
    // *118 références non-pantalon et 379 pièces sur mars→août 2026*. Les lignes de
    // remboursement portent un `sku`, elles peuvent donc joindre `BtocProduct` comme
    // les ventes. Params séparés pour ne pas perturber les requêtes qui réutilisent
    // `topProductParams` (ex. sizeDistribution).
    const tpAllParams = [...topProductParams];
    const tpRefundConds: string[] = [REVENUE_FILTER];
    let tpr = topProductParams.length + 1;
    if (dateFrom) { tpRefundConds.push(`o."orderDate" >= $${tpr++}`); tpAllParams.push(dateGte!); }
    if (dateTo) { tpRefundConds.push(`o."orderDate" < $${tpr++}`); tpAllParams.push(dateLt!); }
    if (customerId) { tpRefundConds.push(`o."customerId" = $${tpr++}`); tpAllParams.push(customerId); }
    if (category) { tpRefundConds.push(`rp.category ILIKE '%' || $${tpr++} || '%'`); tpAllParams.push(category); }
    if (parentProduct) { tpRefundConds.push(`rp.sku ILIKE $${tpr++}`); tpAllParams.push(`%${parentProduct}%`); }
    if (globalCategory) { tpRefundConds.push(`SPLIT_PART(rl.sku, '-', 1) = ANY($${tpr++})`); tpAllParams.push(globalCategorySkus); }
    const tpRefundWhere = "WHERE " + tpRefundConds.join(" AND ");

    // Top produits : on agrège par RÉFÉRENCE (SPLIT_PART(sku,'-',1)) — un produit =
    // une barre, toutes couleurs/tailles confondues — avec le détail par COULEUR
    // (SPLIT_PART(sku,'-',2)) pour l'infobulle. Le classement (CA ou quantité) se fait
    // ensuite côté JS pour servir les deux bascules.
    const tpRows = await prisma.$queryRawUnsafe<
      { ref: string; name: string; color: string; quantity: bigint; revenue: number }[]
    >(
      `SELECT ref, MAX(name) AS name, color, SUM(qty) AS quantity, SUM(revenue) AS revenue
      FROM (
        SELECT SPLIT_PART(ol.sku, '-', 1) AS ref, ol.name AS name, SPLIT_PART(ol.sku, '-', 2) AS color, ol.quantity AS qty, ol.total AS revenue
        FROM "BtocOrderLine" ol
        JOIN "BtocOrder" o ON o.id = ol."orderId"
        LEFT JOIN "BtocProduct" p ON p.sku = SPLIT_PART(ol.sku, '-', 1)
        ${tpWhere}
        UNION ALL
        SELECT SPLIT_PART(rl.sku, '-', 1), rl.name, SPLIT_PART(rl.sku, '-', 2), -rl.quantity, -rl.total
        FROM "BtocRefundLine" rl
        JOIN "BtocOrder" o ON o."wooId" = rl."orderWooId"
        LEFT JOIN "BtocProduct" rp ON rp.sku = SPLIT_PART(rl.sku, '-', 1)
        ${tpRefundWhere}
      ) t
      WHERE ref IS NOT NULL AND ref <> ''
      GROUP BY ref, color`,
      ...tpAllParams
    );

    // Agrégation par produit (ref) + détail couleurs.
    type ColorBd = { color: string; quantity: number; revenue: number };
    const prodMap = new Map<
      string,
      { name: string; quantity: number; revenue: number; colors: ColorBd[] }
    >();
    for (const r of tpRows) {
      const q = Number(r.quantity);
      const rev = Number(r.revenue);
      let e = prodMap.get(r.ref);
      if (!e) {
        e = { name: r.name, quantity: 0, revenue: 0, colors: [] };
        prodMap.set(r.ref, e);
      }
      e.quantity += q;
      e.revenue += rev;
      e.colors.push({ color: r.color || "—", quantity: q, revenue: rev });
    }
    const allProducts = [...prodMap.entries()].map(([ref, e]) => ({
      name: e.name,
      sku: ref,
      quantity: e.quantity,
      revenue: e.revenue,
      colors: e.colors.filter((c) => c.revenue !== 0 || c.quantity !== 0),
    }));
    const topProducts = [...allProducts].sort((a, b) => b.revenue - a.revenue).slice(0, 15);
    const topProductsByQty = [...allProducts].sort((a, b) => b.quantity - a.quantity).slice(0, 15);

    // ─── Top catégories (catégories BtoB via matching réf) + Top pays ─────────
    // Regroupement par catégorie BtoB (Product.category, PAS la catégorie BtoC),
    // matching réf par préfixe SKU avec repli "corps" saison-agnostique.
    // Conditions date + client uniquement (les filtres BtoC ne s'appliquent pas).
    const geoConditions: string[] = [];
    const geoParams: unknown[] = [];
    let geoIdx = 1;
    if (dateFrom) {
      geoConditions.push(`o."orderDate" >= $${geoIdx++}`);
      geoParams.push(dateGte!);
    }
    if (dateTo) {
      geoConditions.push(`o."orderDate" < $${geoIdx++}`);
      geoParams.push(dateLt!);
    }
    if (customerId) {
      geoConditions.push(`o."customerId" = $${geoIdx++}`);
      geoParams.push(customerId);
    }
    geoConditions.push(REVENUE_FILTER);
    const geoWhere = geoConditions.length > 0 ? "WHERE " + geoConditions.join(" AND ") : "";

    const topCategories = await prisma.$queryRawUnsafe<
      { category: string; quantity: bigint; revenue: number }[]
    >(
      `SELECT COALESCE(cat, 'Non catégorisé') AS category,
              SUM(qty) AS quantity, SUM(revenue) AS revenue
       FROM (
         SELECT ol.quantity AS qty, ol.total AS revenue,
           COALESCE(
             (SELECT pr.category FROM "Product" pr WHERE pr.reference = SPLIT_PART(ol.sku, '-', 1) AND pr.category IS NOT NULL AND pr.category != '' LIMIT 1),
             (SELECT pr.category FROM "Product" pr WHERE SUBSTRING(pr.reference FROM 2) = SUBSTRING(SPLIT_PART(ol.sku, '-', 1) FROM 2) AND pr.category IS NOT NULL AND pr.category != '' LIMIT 1)
           ) AS cat
         FROM "BtocOrderLine" ol
         JOIN "BtocOrder" o ON o.id = ol."orderId"
         ${geoWhere}
         UNION ALL
         -- Remboursements (quantité + CA négatifs)
         SELECT -rl.quantity AS qty, -rl.total AS revenue,
           COALESCE(
             (SELECT pr.category FROM "Product" pr WHERE pr.reference = SPLIT_PART(rl.sku, '-', 1) AND pr.category IS NOT NULL AND pr.category != '' LIMIT 1),
             (SELECT pr.category FROM "Product" pr WHERE SUBSTRING(pr.reference FROM 2) = SUBSTRING(SPLIT_PART(rl.sku, '-', 1) FROM 2) AND pr.category IS NOT NULL AND pr.category != '' LIMIT 1)
           ) AS cat
         FROM "BtocRefundLine" rl
         JOIN "BtocOrder" o ON o."wooId" = rl."orderWooId"
         ${geoWhere}
       ) t
       GROUP BY cat
       ORDER BY revenue DESC`,
      ...geoParams
    );

    // ─── Top pays (BtocOrder.billingCountry) ─────────────────
    const topCountries = await prisma.$queryRawUnsafe<
      { country: string; orders: bigint; revenue: number }[]
    >(
      `SELECT COALESCE(NULLIF(o."billingCountry", ''), 'Inconnu') AS country,
              COUNT(*) AS orders, SUM(o.total - o."totalRefunded") AS revenue
       FROM "BtocOrder" o
       ${geoWhere}
       GROUP BY COALESCE(NULLIF(o."billingCountry", ''), 'Inconnu')
       ORDER BY revenue DESC
       LIMIT 12`,
      ...geoParams
    );

    // ─── Orders by status ────────────────────────────────────
    const ordersByStatus = await prisma.$queryRawUnsafe<
      { status: string; count: bigint }[]
    >(
      `SELECT
        o.status,
        COUNT(DISTINCT o.id) AS count
      FROM "BtocOrder" o
      ${lineJoin}
      ${whereClause}
      GROUP BY o.status
      ORDER BY count DESC`,
      ...orderParams
    );

    // ─── Top cities by billing city ──────────────────────────
    const topCities = await prisma.$queryRawUnsafe<
      { city: string; orders: bigint; revenue: number }[]
    >(
      `SELECT
        COALESCE(o.city, 'Inconnu') AS city,
        COUNT(*) AS orders,
        SUM(o.total - o."totalRefunded") AS revenue
      FROM (
        SELECT DISTINCT o.id, o."billingCity" AS city, o.total, o."totalRefunded"
        FROM "BtocOrder" o
        ${lineJoin}
        ${revenueWhere}
      ) o
      GROUP BY o.city
      ORDER BY revenue DESC
      LIMIT 20`,
      ...orderParams
    );

    // ─── Revenue by day (selected period) ────────────────────
    const revenueByDay = await prisma.$queryRawUnsafe<
      { date: string; revenue: number; orders: bigint }[]
    >(
      // Même dédoublonnage que le CA par mois (cf. commentaire ci-dessus).
      `SELECT
        TO_CHAR(((o."orderDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris'), 'YYYY-MM-DD') AS date,
        COALESCE(SUM(o.total - o."totalRefunded"), 0) AS revenue,
        COUNT(*) AS orders
      FROM (
        SELECT DISTINCT o.id, o."orderDate", o.total, o."totalRefunded"
        FROM "BtocOrder" o
        ${lineJoin}
        ${revenueWhere}
      ) o
      GROUP BY TO_CHAR(((o."orderDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris'), 'YYYY-MM-DD')
      ORDER BY date ASC`,
      ...orderParams
    );

    // ─── Size distribution ───────────────────────────────────
    const sizeDistribution = await prisma.$queryRawUnsafe<
      { size: string; quantity: bigint }[]
    >(
      `SELECT
        ol.size,
        SUM(ol.quantity) AS quantity
      FROM "BtocOrderLine" ol
      JOIN "BtocOrder" o ON o.id = ol."orderId"
      LEFT JOIN "BtocProduct" p ON p.sku = SPLIT_PART(ol.sku, '-', 1)
      ${tpWhere.length > 0 ? tpWhere + " AND " : "WHERE "}
        ol.size IS NOT NULL AND ol.size != ''
      GROUP BY ol.size
      ORDER BY quantity DESC`,
      ...topProductParams
    );

    // ─── Available categories (for filter dropdown) ──────────
    // Categories can be comma-separated (multiple per product), so unnest them
    const categoryRows = await prisma.$queryRawUnsafe<
      { category: string }[]
    >(
      `SELECT DISTINCT TRIM(unnest(string_to_array(category, ','))) AS category
      FROM "BtocProduct"
      WHERE category IS NOT NULL AND category != ''
      ORDER BY category ASC`
    );
    const availableCategories = categoryRows
      .map((r) => r.category)
      .filter((c) => c.length > 0);

    // ─── Catégories globales disponibles (filtre) ────────────
    // Comptées sur les produits réellement au catalogue, avec « Autres » seulement s'il
    // reste des titres non reconnus (carte cadeau, mug…).
    const namedProducts = await prisma.btocProduct.findMany({
      where: { sku: { not: null } },
      select: { sku: true, name: true },
    });
    const globalCounts = new Map<string, Set<string>>();
    for (const pr of namedProducts) {
      const parent = (pr.sku ?? "").split("-")[0];
      if (!parent) continue;
      const label = globalCategoryLabel(pr.name);
      const set = globalCounts.get(label) ?? new Set<string>();
      set.add(parent);
      globalCounts.set(label, set);
    }
    const availableGlobalCategories = [
      ...allGlobalCategories().filter((c) => globalCounts.has(c)),
      ...(globalCounts.has(UNCLASSIFIED) ? [UNCLASSIFIED] : []),
    ].map((name) => ({ name, products: globalCounts.get(name)!.size }));

    // ─── Available parent products (for filter dropdown) ─────
    const parentProductRows = await prisma.$queryRawUnsafe<
      { sku: string; name: string; wooId: number }[]
    >(
      `SELECT sku, name, "wooId"
      FROM "BtocProduct"
      WHERE type = 'variable' AND sku IS NOT NULL AND sku != ''
      ORDER BY sku ASC`
    );
    const availableParentProducts = parentProductRows.map((r) => ({
      sku: r.sku,
      name: r.name,
      wooId: Number(r.wooId),
    }));

    // ─── Serialize bigints ───────────────────────────────────
    return NextResponse.json({
      overview,
      revenueByMonth: revenueByMonth.map((r) => ({
        month: r.month,
        revenue: Number(r.revenue),
        orders: Number(r.orders),
      })),
      topProducts,
      topProductsByQty,
      topCategories: topCategories.map((r) => ({
        category: r.category,
        quantity: Number(r.quantity),
        revenue: Number(r.revenue),
      })),
      topCountries: topCountries.map((r) => ({
        country: r.country,
        orders: Number(r.orders),
        revenue: Number(r.revenue),
      })),
      ordersByStatus: ordersByStatus.map((r) => ({
        status: r.status,
        count: Number(r.count),
      })),
      topCities: topCities.map((r) => ({
        city: r.city,
        orders: Number(r.orders),
        revenue: Number(r.revenue),
      })),
      revenueByDay: revenueByDay.map((r) => ({
        date: r.date,
        revenue: Number(r.revenue),
        orders: Number(r.orders),
      })),
      sizeDistribution: sizeDistribution.map((r) => ({
        size: r.size,
        quantity: Number(r.quantity),
      })),
      availableCategories,
      availableGlobalCategories,
      availableParentProducts,
    });
  } catch (e) {
    return handleApiError(e, "api/btoc/stats");
  }
}

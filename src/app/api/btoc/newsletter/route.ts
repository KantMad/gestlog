import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parisRangeToUtc } from "@/lib/btoc-dates";
import { NON_ORDER_STATUSES, parisYmd } from "@/lib/btoc-contacts";
import { listLabel, newsletterListIds, type NewsletterListItem } from "@/lib/btoc-newsletter";

// ─── Onglet Newsletter de /btoc ──────────────────────────────────────────
// Lit BtocNewsletterContact (miroir Brevo, cf. /api/sync/btoc/newsletter).
// Filtres : status=subscribed|unsubscribed|all (défaut subscribed ; « désinscrit » =
// a été dans une liste newsletter et ne l'est plus), ordered=all|yes|no,
// list=<id>|all, dateFrom/dateTo (date d'inscription, bornes Paris), q (recherche),
// page/limit, export=1 (tout, sans pagination).
// « A commandé » = au moins une commande aboutie, live OU historique (même règle que
// l'export Clients & prospects).

const ORDERS_CTE = `orders AS (
  SELECT k, COUNT(*) n, SUM(amt) spent, MAX(d) last FROM (
    SELECT LOWER(TRIM(o."customerEmail")) k, o.total - COALESCE(o."totalRefunded", 0) amt, o."orderDate" d
      FROM "BtocOrder" o
     WHERE o."customerEmail" IS NOT NULL AND TRIM(o."customerEmail") <> '' AND o.status <> ALL($1)
    UNION ALL
    SELECT LOWER(TRIM(h."customerEmail")), h.total, h."orderDate"
      FROM "HistOrder" h WHERE h."customerEmail" IS NOT NULL AND TRIM(h."customerEmail") <> ''
  ) s GROUP BY k
)`;

export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const status = p.get("status") ?? "subscribed";
    const ordered = p.get("ordered") ?? "all";
    const list = Number(p.get("list"));
    const q = (p.get("q") ?? "").trim().toLowerCase();
    const isExport = p.get("export") === "1";
    const limit = Math.min(200, Math.max(1, Number(p.get("limit")) || 50));
    const page = Math.max(1, Number(p.get("page")) || 1);
    const { gte, lt } = parisRangeToUtc(p.get("dateFrom"), p.get("dateTo"));
    const nlIds = newsletterListIds();

    // $1 = statuts exclus ; les filtres ajoutent leurs paramètres à la suite
    // (jamais de paramètre inutilisé : Postgres ne saurait pas le typer).
    const args: unknown[] = [[...NON_ORDER_STATUSES]];
    const where: string[] = [];
    if (status === "subscribed") where.push("c.subscribed");
    else if (status === "unsubscribed") where.push(`c."inNewsletterList" AND NOT c.subscribed`);
    else where.push(`(c.subscribed OR c."inNewsletterList")`);
    if (ordered === "yes") where.push("o.k IS NOT NULL");
    if (ordered === "no") where.push("o.k IS NULL");
    if (Number.isInteger(list) && list > 0) {
      args.push(list);
      where.push(`($${args.length}::int = ANY(c."listIds") OR $${args.length}::int = ANY(c."unsubscribedListIds"))`);
    }
    if (gte) { args.push(gte); where.push(`c."subscribedAt" >= $${args.length}`); }
    if (lt) { args.push(lt); where.push(`c."subscribedAt" < $${args.length}`); }
    if (q) {
      args.push(`%${q}%`);
      const n = args.length;
      where.push(`(c.email LIKE $${n} OR LOWER(COALESCE(c."firstName",'') || ' ' || COALESCE(c."lastName",'')) LIKE $${n})`);
    }
    const whereSql = where.join(" AND ");

    const base = `WITH ${ORDERS_CTE}
      SELECT c.email, c."firstName", c."lastName", c.phone, c."listIds", c."unsubscribedListIds",
             c.subscribed, c."subscribedAt", c."unsubscribedAt",
             COALESCE(o.n, 0) n, COALESCE(o.spent, 0) spent, o.last, COUNT(*) OVER() total
        FROM "BtocNewsletterContact" c
        LEFT JOIN orders o ON o.k = c.email
       WHERE ${whereSql}
       ORDER BY c."subscribedAt" DESC NULLS LAST, c.email`;
    const rows = await prisma.$queryRawUnsafe<
      {
        email: string; firstName: string | null; lastName: string | null; phone: string | null;
        listIds: number[]; unsubscribedListIds: number[]; subscribed: boolean;
        subscribedAt: Date | null; unsubscribedAt: Date | null;
        n: bigint; spent: number; last: Date | null; total: bigint;
      }[]
    >(isExport ? base : `${base} LIMIT ${limit} OFFSET ${(page - 1) * limit}`, ...args);

    const items: NewsletterListItem[] = rows.map((r) => {
      const ids = r.subscribed
        ? r.listIds.filter((id) => nlIds.includes(id))
        : [...new Set([...r.listIds, ...r.unsubscribedListIds])].filter((id) => nlIds.includes(id));
      return {
        email: r.email,
        firstName: r.firstName ?? "",
        lastName: r.lastName ?? "",
        phone: r.phone ?? "",
        lists: ids.map(listLabel).join(", "),
        subscribed: r.subscribed,
        subscribedAt: parisYmd(r.subscribedAt),
        unsubscribedAt: parisYmd(r.unsubscribedAt),
        ordersCount: Number(r.n),
        totalSpent: Number(r.spent),
        lastOrder: parisYmd(r.last),
      };
    });
    const total = rows.length ? Number(rows[0].total) : 0;
    if (isExport) return NextResponse.json({ items, total });

    // Synthèse (indépendante des filtres) : compteurs, par liste, par mois.
    const [summary] = await prisma.$queryRawUnsafe<
      { subscribed: bigint; unsubscribed: bigint; subscribed_no_order: bigint }[]
    >(
      `WITH ${ORDERS_CTE}
       SELECT COUNT(*) FILTER (WHERE c.subscribed) subscribed,
              COUNT(*) FILTER (WHERE c."inNewsletterList" AND NOT c.subscribed) unsubscribed,
              COUNT(*) FILTER (WHERE c.subscribed AND o.k IS NULL) subscribed_no_order
         FROM "BtocNewsletterContact" c LEFT JOIN orders o ON o.k = c.email`,
      [...NON_ORDER_STATUSES],
    );
    const byList = await prisma.$queryRawUnsafe<{ id: number; n: bigint }[]>(
      // ⚠️ alias list_id : la table a déjà une colonne « id » (ambiguïté SQL).
      `SELECT l.list_id id, COUNT(*) n
         FROM "BtocNewsletterContact" c, unnest(c."listIds") AS l(list_id)
        WHERE c.subscribed AND l.list_id = ANY($1) GROUP BY l.list_id ORDER BY n DESC`,
      nlIds,
    );
    // Par mois (Paris), 18 derniers mois : nouveaux inscrits (encore inscrits ou non)
    // et désinscriptions constatées.
    const monthly = await prisma.$queryRawUnsafe<{ month: string; subs: bigint; unsubs: bigint }[]>(
      `WITH m AS (
         SELECT to_char(("subscribedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris', 'YYYY-MM') AS month,
                1 subs, 0 unsubs
           FROM "BtocNewsletterContact" WHERE "inNewsletterList" AND "subscribedAt" IS NOT NULL
         UNION ALL
         SELECT to_char(("unsubscribedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris', 'YYYY-MM'), 0, 1
           FROM "BtocNewsletterContact" WHERE "inNewsletterList" AND "unsubscribedAt" IS NOT NULL
       )
       SELECT month, SUM(subs) subs, SUM(unsubs) unsubs FROM m
        WHERE month >= to_char(NOW() - INTERVAL '17 months', 'YYYY-MM')
        GROUP BY month ORDER BY month`,
    );
    const lastSync = await prisma.btocSyncLog.findFirst({
      where: { syncType: "NEWSLETTER" },
      orderBy: { syncedAt: "desc" },
      select: { syncedAt: true, itemCount: true, errorCount: true },
    });

    return NextResponse.json({
      items,
      total,
      page,
      limit,
      summary: {
        subscribed: Number(summary?.subscribed ?? 0),
        unsubscribed: Number(summary?.unsubscribed ?? 0),
        subscribedNoOrder: Number(summary?.subscribed_no_order ?? 0),
        byList: byList.map((l) => ({ id: l.id, label: listLabel(l.id), count: Number(l.n) })),
        monthly: monthly.map((m) => ({ month: m.month, subscribed: Number(m.subs), unsubscribed: Number(m.unsubs) })),
      },
      lists: nlIds.map((id) => ({ id, label: listLabel(id) })),
      lastSync,
    });
  } catch (e) {
    return handleApiError(e, "api/btoc/newsletter");
  }
}

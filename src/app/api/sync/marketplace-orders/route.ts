import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { fetchSfOrders } from "@/lib/shoppingfeed";

export const maxDuration = 120;

// POST — relit les commandes marketplaces dans Shopping Feed (GESTLOG-15) et les range dans
// MarketplaceOrder. Appelé chaque nuit par n8n (« GestLog — Commandes Shopping Feed »).
// Body (facultatif) : { since?: "AAAA-MM-JJ", until?: "AAAA-MM-JJ" } — dates de CRÉATION des
// commandes ; défaut : les 45 derniers jours (pour suivre les changements de statut :
// expédiée, remboursée…). Pour reprendre l'historique : { since: "2025-12-01" }. Idempotent.

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const Body = z.object({ since: z.string().regex(DAY).optional(), until: z.string().regex(DAY).optional() });
const parisDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(d);

export async function POST(request: NextRequest) {
  try {
    if (request.headers.get("x-api-key") !== process.env.SYNC_API_KEY) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Format invalide" }, { status: 400 });
    const since = parsed.data.since ?? parisDay(new Date(Date.now() - 45 * 86400000));
    const until = parsed.data.until;

    const started = Date.now();
    const orders = await fetchSfOrders(`${since}T00:00:00`, until ? `${until}T23:59:59` : undefined);

    for (let i = 0; i < orders.length; i += 500) {
      const chunk = orders.slice(i, i + 500);
      await prisma.$executeRawUnsafe(
        `INSERT INTO "MarketplaceOrder" ("sfId", reference, "storeReference", "channelId", channel, status, "isTest",
            "orderCreatedAt", "acknowledgedAt", "sfUpdatedAt", "totalAmount", "productAmount", "shippingAmount",
            currency, "itemCount", items, "createdAt", "updatedAt")
         SELECT r."sfId", r.reference, r."storeReference", r."channelId", r.channel, r.status, r."isTest",
                r."orderCreatedAt"::timestamptz AT TIME ZONE 'UTC', r."acknowledgedAt"::timestamptz AT TIME ZONE 'UTC',
                r."sfUpdatedAt"::timestamptz AT TIME ZONE 'UTC', r."totalAmount", r."productAmount", r."shippingAmount",
                r.currency, r."itemCount", r.items, NOW(), NOW()
           FROM jsonb_to_recordset($1::jsonb) AS r("sfId" text, reference text, "storeReference" text, "channelId" int,
                channel text, status text, "isTest" boolean, "orderCreatedAt" text, "acknowledgedAt" text,
                "sfUpdatedAt" text, "totalAmount" float8, "productAmount" float8, "shippingAmount" float8,
                currency text, "itemCount" int, items jsonb)
         ON CONFLICT ("sfId") DO UPDATE SET reference = EXCLUDED.reference, "storeReference" = EXCLUDED."storeReference",
           "channelId" = EXCLUDED."channelId", channel = EXCLUDED.channel, status = EXCLUDED.status, "isTest" = EXCLUDED."isTest",
           "orderCreatedAt" = EXCLUDED."orderCreatedAt", "acknowledgedAt" = EXCLUDED."acknowledgedAt",
           "sfUpdatedAt" = EXCLUDED."sfUpdatedAt", "totalAmount" = EXCLUDED."totalAmount", "productAmount" = EXCLUDED."productAmount",
           "shippingAmount" = EXCLUDED."shippingAmount", currency = EXCLUDED.currency, "itemCount" = EXCLUDED."itemCount",
           items = EXCLUDED.items, "updatedAt" = NOW()`,
        JSON.stringify(chunk)
      );
    }

    await prisma.btocSyncLog.create({
      data: { syncType: "MARKETPLACE_ORDERS", itemCount: orders.length, errorCount: 0, duration: Date.now() - started },
    });
    return NextResponse.json({ success: true, since, until: until ?? null, orders: orders.length });
  } catch (e) {
    return handleApiError(e, "api/sync/marketplace-orders");
  }
}

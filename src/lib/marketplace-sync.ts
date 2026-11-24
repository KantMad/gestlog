import { prisma } from "@/lib/prisma";
import { fetchSfOrders } from "@/lib/shoppingfeed";

// Lecture des commandes marketplaces dans Shopping Feed → table MarketplaceOrder (GESTLOG-15).
// Utilisée par la synchro de nuit (/api/sync/marketplace-orders) et par le bouton
// « Actualiser maintenant » de l'onglet BtoC → Marketplaces. Idempotent. Lecture seule côté
// Shopping Feed ; aucune donnée personnelle client n'est gardée (voir mapSfOrder).

const parisDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(d);

/** Jour (AAAA-MM-JJ, Paris) il y a `days` jours : fenêtre par défaut de relecture. */
export const daysAgo = (days: number) => parisDay(new Date(Date.now() - days * 86400000));

/** @param since / until AAAA-MM-JJ, dates de CRÉATION des commandes. Renvoie le nombre lu. */
export async function syncMarketplaceOrders(since: string, until?: string): Promise<number> {
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
  return orders.length;
}

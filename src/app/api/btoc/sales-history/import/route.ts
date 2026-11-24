import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handleApiError, parseBody } from "@/lib/api";
import { liveStartDay } from "@/lib/sales-history-db";

// POST — import d'un lot de lignes d'historique (écran BtoC → Historique ventes).
// Le navigateur lit le fichier xlsx (lib/sales-history.parseExportWorkbook) et envoie
// les lignes par lots : pas de gros fichier à faire transiter par nginx.
// Idempotent : (channel, orderNumber, lineKey) unique → réimporter un fichier, ou deux
// exports qui se chevauchent, ne crée pas de doublon.
// Les lignes datées à partir du début de la synchro live (1re BtocOrder) sont ignorées :
// ces ventes sont déjà dans BtocOrder, les garder les compterait deux fois.

const Line = z.object({
  orderNumber: z.string().min(1).max(64),
  lineKey: z.string().min(1).max(300),
  orderDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  productName: z.string().min(1).max(300),
  sku: z.string().max(200).nullable(),
  reference: z.string().max(120).nullable(),
  colorCode: z.string().max(10).nullable(),
  size: z.string().max(20).nullable(),
  quantity: z.number().int(),
  unitPrice: z.number(),
  lineTotal: z.number(),
});

const Body = z.object({
  fileName: z.string().max(255),
  lines: z.array(Line).max(5000),
});

export async function POST(request: NextRequest) {
  try {
    const r = await parseBody(request, Body);
    if ("error" in r) return r.error;
    const { fileName, lines } = r.data;

    const cutoff = await liveStartDay();
    const kept = cutoff ? lines.filter((l) => l.orderDay < cutoff) : lines;
    const skippedLive = lines.length - kept.length;
    if (kept.length === 0) return NextResponse.json({ inserted: 0, updated: 0, skippedLive });

    const res = await prisma.$queryRawUnsafe<{ inserted: boolean }[]>(
      `INSERT INTO "SalesHistoryLine" AS t
         (id, channel, "orderNumber", "lineKey", "orderDay", "productName", sku, reference,
          "colorCode", size, quantity, "unitPrice", "lineTotal", "importFile", "createdAt", "updatedAt")
       SELECT 'sh_' || md5('BTOC§' || r."orderNumber" || '§' || r."lineKey"), 'BTOC', r."orderNumber", r."lineKey",
              r."orderDay"::date, r."productName", r.sku, r.reference, r."colorCode", r.size,
              r.quantity, r."unitPrice", r."lineTotal", $2, NOW(), NOW()
         FROM jsonb_to_recordset($1::jsonb) AS r(
              "orderNumber" text, "lineKey" text, "orderDay" text, "productName" text, sku text,
              reference text, "colorCode" text, size text, quantity int, "unitPrice" float8, "lineTotal" float8)
       ON CONFLICT (channel, "orderNumber", "lineKey") DO UPDATE SET
         "orderDay" = EXCLUDED."orderDay",
         "productName" = EXCLUDED."productName",
         sku = EXCLUDED.sku,
         reference = EXCLUDED.reference,
         "colorCode" = EXCLUDED."colorCode",
         size = EXCLUDED.size,
         quantity = EXCLUDED.quantity,
         "unitPrice" = EXCLUDED."unitPrice",
         "lineTotal" = EXCLUDED."lineTotal",
         "importFile" = EXCLUDED."importFile",
         "updatedAt" = NOW()
       RETURNING (xmax = 0) AS inserted`,
      JSON.stringify(kept),
      fileName
    );
    const inserted = res.filter((x) => x.inserted).length;
    return NextResponse.json({ inserted, updated: res.length - inserted, skippedLive });
  } catch (e) {
    return handleApiError(e, "api/btoc/sales-history/import");
  }
}

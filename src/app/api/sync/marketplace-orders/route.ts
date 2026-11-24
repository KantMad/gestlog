import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/api";
import { daysAgo, syncMarketplaceOrders } from "@/lib/marketplace-sync";

export const maxDuration = 120;

// POST — relit les commandes marketplaces dans Shopping Feed (GESTLOG-15) et les range dans
// MarketplaceOrder. Appelé chaque nuit par n8n (« GestLog — Commandes Shopping Feed »).
// Body (facultatif) : { since?: "AAAA-MM-JJ", until?: "AAAA-MM-JJ" } — dates de CRÉATION des
// commandes ; défaut : les 45 derniers jours (pour suivre les changements de statut :
// expédiée, remboursée…). Pour reprendre l'historique : { since: "2025-12-01" }. Idempotent.

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const Body = z.object({ since: z.string().regex(DAY).optional(), until: z.string().regex(DAY).optional() });

export async function POST(request: NextRequest) {
  try {
    if (request.headers.get("x-api-key") !== process.env.SYNC_API_KEY) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Format invalide" }, { status: 400 });
    const since = parsed.data.since ?? daysAgo(45);
    const until = parsed.data.until;

    const count = await syncMarketplaceOrders(since, until);
    return NextResponse.json({ success: true, since, until: until ?? null, orders: count });
  } catch (e) {
    return handleApiError(e, "api/sync/marketplace-orders");
  }
}

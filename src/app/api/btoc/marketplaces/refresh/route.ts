import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { daysAgo, syncMarketplaceOrders } from "@/lib/marketplace-sync";

export const maxDuration = 180;

// POST — bouton « Actualiser maintenant » de l'onglet BtoC → Marketplaces (GESTLOG-15).
// Relance, sans attendre la nuit :
//  - la synchro des commandes WooCommerce des 3 derniers jours (workflow n8n « GestLog —
//    Commandes Woo à la demande », webhook protégé par la clé de synchro) ;
//  - la lecture Shopping Feed des 45 derniers jours (lecture seule).
// Une seule actualisation à la fois ; les deux synchros sont idempotentes.

const WEBHOOK = process.env.N8N_WOO_ORDERS_WEBHOOK || "https://centralway.pro/webhook/gestlog-woo-orders-now";
let running: Promise<unknown> | null = null;

async function syncWoo(): Promise<void> {
  const res = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "x-api-key": process.env.SYNC_API_KEY ?? "", "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(150_000),
  });
  if (!res.ok) throw new Error(`n8n HTTP ${res.status}`);
}

export async function POST() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Non connecté" }, { status: 401 });
    if (running) return NextResponse.json({ error: "Une actualisation est déjà en cours" }, { status: 409 });

    const job = Promise.allSettled([syncWoo(), syncMarketplaceOrders(daysAgo(45))]);
    running = job;
    const [woo, sf] = await job.finally(() => {
      running = null;
    });
    if (woo.status === "rejected") console.error("[marketplaces/refresh] Woo:", woo.reason);
    if (sf.status === "rejected") console.error("[marketplaces/refresh] Shopping Feed:", sf.reason);
    return NextResponse.json({
      woo: woo.status === "fulfilled",
      shoppingFeed: sf.status === "fulfilled",
      sfOrders: sf.status === "fulfilled" ? sf.value : null,
    });
  } catch (e) {
    return handleApiError(e, "api/btoc/marketplaces/refresh");
  }
}

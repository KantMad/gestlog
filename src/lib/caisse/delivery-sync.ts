import { prisma } from "@/lib/prisma";
import { parseSizeQuantities } from "@/lib/utils";

// Intégration sortante GestLog → CaissePro : une livraison validée est envoyée à
// l'API caisse, qui l'applique en réception de stock. Idempotent (deliveryId = id
// stable de la livraison → la caisse n'applique jamais deux fois la même).

const CAISSE_URL = "https://api.techincash.app/api/integrations/gestlog/delivery";

// Statut gestlog qui déclenche l'envoi (configurable). Par défaut EXPEDIEE
// (livraison partie → le magasin reçoit le stock).
export const CAISSE_TRIGGER_STATUS = process.env.CAISSE_TRIGGER_STATUS || "EXPEDIEE";

export type CaisseSyncStatus = "SENT" | "ALREADY" | "FAILED" | "SKIPPED";

export interface CaisseSyncResult {
  status: CaisseSyncStatus;
  matched?: number;
  unmatchedEans?: string[];
  error?: string;
}

const isEan13 = (s: string) => /^\d{13}$/.test(s);

// Construit le corps de la requête : agrège les quantités par EAN-13 valide.
// `missingEans` = (réf, coloris, taille) sans EAN dans le référentiel — à logger.
export async function buildCaissePayload(deliveryId: string): Promise<{
  deliveryId: string;
  supplier?: string;
  storeId?: string;
  lines: { ean: string; quantity: number }[];
  missing: string[];
}> {
  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: { lines: { include: { product: true } } },
  });
  if (!delivery) throw new Error("Livraison introuvable");

  const byEan = new Map<string, number>();
  const missing: string[] = [];

  for (const line of delivery.lines) {
    const quantities = parseSizeQuantities(line.quantitiesBySize);
    for (const [size, qty] of Object.entries(quantities)) {
      const q = Number(qty) || 0;
      if (q <= 0) continue;
      const rec = await prisma.productSizeEan.findUnique({
        where: {
          reference_color_size: {
            reference: line.product.reference,
            color: line.product.color,
            size,
          },
        },
      });
      if (rec && isEan13(rec.ean)) {
        byEan.set(rec.ean, (byEan.get(rec.ean) || 0) + q);
      } else {
        missing.push(`${line.product.reference}/${line.product.color}/${size}`);
      }
    }
  }

  const storeId = process.env.CAISSE_STORE_ID || undefined;
  return {
    deliveryId: delivery.id, // id cuid = identifiant unique ET stable
    supplier: "MCS",
    ...(storeId ? { storeId } : {}),
    lines: [...byEan.entries()].map(([ean, quantity]) => ({ ean, quantity })),
    missing,
  };
}

// Envoie la livraison à la caisse, gère les réponses, enregistre le résultat sur
// la Delivery. Réessaie en interne sur 5xx / erreur réseau (transitoires).
export async function sendDeliveryToCaisse(deliveryId: string): Promise<CaisseSyncResult> {
  const record = async (r: CaisseSyncResult) => {
    await prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        caisseSyncStatus: r.status,
        caisseSyncAt: new Date(),
        caisseSyncMatched: r.matched ?? null,
        caisseSyncInfo: r.error
          ? r.error
          : r.unmatchedEans && r.unmatchedEans.length
            ? JSON.stringify({ unmatchedEans: r.unmatchedEans })
            : null,
      },
    }).catch(() => {});
    return r;
  };

  const secret = process.env.GESTLOG_CAISSE_SECRET;
  if (!secret) return record({ status: "SKIPPED", error: "GESTLOG_CAISSE_SECRET non configuré" });

  const payload = await buildCaissePayload(deliveryId);
  if (payload.lines.length === 0) {
    return record({ status: "SKIPPED", error: "Aucune ligne avec EAN valide" });
  }

  const MAX_ATTEMPTS = 3;
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(CAISSE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gestlog-Secret": secret },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });

      // Succès
      if (res.status === 201) {
        const d = await res.json().catch(() => ({}));
        return record({ status: "SENT", matched: Number(d.matched) || 0, unmatchedEans: d.unmatchedEans || [] });
      }
      if (res.status === 200) {
        const d = await res.json().catch(() => ({}));
        if (d.alreadyProcessed) return record({ status: "ALREADY" });
        return record({ status: "SENT", matched: Number(d.matched) || 0, unmatchedEans: d.unmatchedEans || [] });
      }
      // Secret invalide → inutile de réessayer
      if (res.status === 401) {
        return record({ status: "FAILED", error: "Secret invalide (401)" });
      }
      // 5xx → transitoire, on réessaie
      if (res.status >= 500) {
        lastError = `HTTP ${res.status}`;
        if (attempt < MAX_ATTEMPTS) { await new Promise((r) => setTimeout(r, attempt * 1000)); continue; }
        return record({ status: "FAILED", error: `${lastError} (à réessayer)` });
      }
      // autre 4xx (payload invalide…) → échec sans retry
      const txt = await res.text().catch(() => "");
      return record({ status: "FAILED", error: `HTTP ${res.status} ${txt}`.slice(0, 300) });
    } catch (e) {
      // erreur réseau / timeout → transitoire
      lastError = e instanceof Error ? e.message : String(e);
      if (attempt < MAX_ATTEMPTS) { await new Promise((r) => setTimeout(r, attempt * 1000)); continue; }
      return record({ status: "FAILED", error: `${lastError} (à réessayer)` });
    }
  }
  return record({ status: "FAILED", error: lastError || "échec inconnu" });
}

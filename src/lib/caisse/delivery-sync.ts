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
  matched?: number; // EAN reconnus (ancien contrat) ou lignes appliquées (nouveau)
  unmatchedEans?: unknown[]; // EAN inconnus / lignes manquant d'infos (needsData)
  createdProducts?: number; // produits créés côté caisse (nouveau contrat)
  error?: string;
}

// Objet produit envoyé pour permettre la création d'un produit vendable côté caisse.
interface CaisseProduct {
  name?: string;
  price?: number; // prix de vente public
  sku?: string;
  color?: string;
  size?: string;
  colorCode?: string;
  category?: string;
  taxRate?: number;
  costPrice?: number;
}
interface CaisseLine { ean: string; quantity: number; product?: CaisseProduct }

const isEan13 = (s: string) => /^\d{13}$/.test(s);
const TAX_RATE = 0.2; // TVA standard FR (non disponible dans TIO)

// Construit le corps : une ligne par EAN-13 valide, avec quantité agrégée ET l'objet
// `product` (nom + prix de vente public + SKU/couleur/taille…) pour création caisse.
// `missing` = (réf, coloris, taille) sans EAN dans le référentiel — à logger.
export async function buildCaissePayload(deliveryId: string): Promise<{
  deliveryId: string;
  supplier?: string;
  storeId?: string;
  lines: CaisseLine[];
  missing: string[];
}> {
  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: { lines: { include: { product: true } } },
  });
  if (!delivery) throw new Error("Livraison introuvable");

  // par EAN : quantité cumulée + l'objet produit (cohérent par EAN = réf/couleur/taille)
  const byEan = new Map<string, CaisseLine>();
  const missing: string[] = [];

  const clean = <T extends object>(o: T): T =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "")) as T;

  for (const line of delivery.lines) {
    const p = line.product;
    const quantities = parseSizeQuantities(line.quantitiesBySize);
    for (const [size, qty] of Object.entries(quantities)) {
      const q = Number(qty) || 0;
      if (q <= 0) continue;
      const rec = await prisma.productSizeEan.findUnique({
        where: { reference_color_size: { reference: p.reference, color: p.color, size } },
      });
      if (!rec || !isEan13(rec.ean)) {
        missing.push(`${p.reference}/${p.color}/${size}`);
        continue;
      }
      const existing = byEan.get(rec.ean);
      if (existing) {
        existing.quantity += q;
      } else {
        const product = clean<CaisseProduct>({
          name: p.label ?? undefined,
          price: p.salePrice ?? undefined, // prix de vente public (catalogue 209)
          sku: p.reference,
          color: p.colorLabel ?? p.color, // NOM de la couleur (repli sur le code si inconnu)
          size,
          colorCode: p.colorCode ?? p.color, // CODE de la couleur
          category: p.category ?? undefined,
          taxRate: TAX_RATE,
          costPrice: p.costPrice ?? undefined,
        });
        byEan.set(rec.ean, { ean: rec.ean, quantity: q, product });
      }
    }
  }

  const storeId = process.env.CAISSE_STORE_ID || undefined;
  return {
    deliveryId: delivery.id, // id cuid = identifiant unique ET stable
    supplier: "MCS",
    ...(storeId ? { storeId } : {}),
    lines: [...byEan.values()],
    missing,
  };
}

// Envoie la livraison à la caisse, gère les réponses, enregistre le résultat sur
// la Delivery. Réessaie en interne sur 5xx / erreur réseau (transitoires).
export async function sendDeliveryToCaisse(deliveryId: string): Promise<CaisseSyncResult> {
  const record = async (r: CaisseSyncResult) => {
    let info: string | null = null;
    if (r.error) info = r.error;
    else if (r.createdProducts || (r.unmatchedEans && r.unmatchedEans.length)) {
      info = JSON.stringify({
        createdProducts: r.createdProducts,
        needsData: r.unmatchedEans?.length ? r.unmatchedEans : undefined,
      });
    }
    await prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        caisseSyncStatus: r.status,
        caisseSyncAt: new Date(),
        caisseSyncMatched: r.matched ?? null,
        caisseSyncInfo: info,
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

      // Succès — gère l'ancien contrat (matched/unmatchedEans) ET le nouveau
      // (applied/createdProducts/needsData).
      const parseOk = (d: Record<string, unknown>): CaisseSyncResult => ({
        status: "SENT",
        matched: Number(d.applied ?? d.matched) || 0,
        createdProducts: d.createdProducts != null ? Number(d.createdProducts) : undefined,
        unmatchedEans: (d.needsData ?? d.unmatchedEans ?? []) as unknown[],
      });
      if (res.status === 201) {
        return record(parseOk(await res.json().catch(() => ({}))));
      }
      if (res.status === 200) {
        const d = await res.json().catch(() => ({}));
        if (d.alreadyProcessed) return record({ status: "ALREADY" });
        return record(parseOk(d));
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

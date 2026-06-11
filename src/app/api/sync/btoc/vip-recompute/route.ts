import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import {
  isBrevoConfigured,
  markCustomerAsVip,
  type VipCustomer,
} from "@/lib/brevo";

export const maxDuration = 60;

// Seuil (en €) à partir duquel un client devient VIP. Configurable via .env.
const VIP_THRESHOLD = Number(process.env.BREVO_VIP_THRESHOLD) || 500;

// ─── Recalcul de la base VIP ─────────────────────────────────────────────
// L'API WooCommerce REST "Get Customers" renvoie total_spent=0 / orders_count=0
// (Woo ne calcule pas ces agrégats à la volée), donc la sync customers ne peut
// pas détecter les VIP. On recalcule ici les vrais totaux depuis BtocOrder,
// agrégés par LOWER(customerEmail) (cf. /api/btoc/export/top-clients), en
// excluant les commandes annulées / remboursées / échouées.
//
// À appeler par n8n APRÈS la sync des commandes.
//
// Garde anti-doublon : le scénario Brevo "client_vip" n'est déclenché que pour
// les clients qui passent isVip=false → total ≥ seuil. isVip est posé en base
// uniquement après notification Brevo réussie, ce qui permet un retry naturel
// au run suivant si Brevo échoue.
//
// Mode backfill (premier run) : POST avec { "silent": true } met à jour les
// totaux ET pose isVip sur tous les VIP actuels SANS appeler Brevo — évite de
// noyer les 14253 clients existants sous une vague d'emails d'automatisation.
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("x-api-key");
    if (authHeader !== process.env.SYNC_API_KEY) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const silent = body?.silent === true;

    const errors: string[] = [];

    // 1) Recalcule totalSpent / ordersCount sur BtocCustomer depuis les vraies
    //    commandes (jointure par email, insensible à la casse). Un seul UPDATE.
    const updatedCount = await prisma.$executeRawUnsafe(
      `UPDATE "BtocCustomer" c
       SET "totalSpent" = agg.total_spent,
           "ordersCount" = agg.orders_count,
           "updatedAt" = NOW()
       FROM (
         SELECT
           LOWER(o."customerEmail") AS email_key,
           SUM(o.total)             AS total_spent,
           COUNT(*)::int            AS orders_count
         FROM "BtocOrder" o
         WHERE o."customerEmail" IS NOT NULL AND o."customerEmail" != ''
           AND o.status NOT IN ('cancelled', 'refunded', 'failed')
         GROUP BY LOWER(o."customerEmail")
       ) agg
       WHERE LOWER(c.email) = agg.email_key
         AND (c."totalSpent" IS DISTINCT FROM agg.total_spent
              OR c."ordersCount" IS DISTINCT FROM agg.orders_count)`
    );

    // 2) Liste les clients qui FRANCHISSENT le seuil : pas encore VIP mais
    //    total recalculé ≥ seuil. C'est cette liste qui déclenche Brevo.
    const candidates = await prisma.$queryRawUnsafe<
      {
        email: string;
        firstName: string;
        lastName: string;
        totalSpent: number;
        ordersCount: number;
      }[]
    >(
      `SELECT email, "firstName", "lastName", "totalSpent", "ordersCount"
       FROM "BtocCustomer"
       WHERE "isVip" = false AND "totalSpent" >= $1
       ORDER BY "totalSpent" DESC`,
      VIP_THRESHOLD
    );

    let vipNotified = 0;

    if (silent) {
      // Backfill : marque tous les VIP actuels sans rien envoyer.
      const promoted = await prisma.$executeRawUnsafe(
        `UPDATE "BtocCustomer"
         SET "isVip" = true, "vipSince" = NOW(), "updatedAt" = NOW()
         WHERE "isVip" = false AND "totalSpent" >= $1`,
        VIP_THRESHOLD
      );

      await prisma.btocSyncLog.create({
        data: {
          syncType: "VIP",
          itemCount: Number(promoted),
          errorCount: 0,
        },
      });

      return NextResponse.json({
        success: true,
        data: {
          mode: "backfill",
          customersUpdated: Number(updatedCount),
          vipBackfilled: Number(promoted),
          vipNotified: 0,
        },
      });
    }

    // 3) Run normal : notifie Brevo puis pose isVip seulement en cas de succès
    //    (un échec laisse isVip=false → nouvelle tentative au prochain run).
    const brevoReady = isBrevoConfigured();
    for (const c of candidates) {
      const vip: VipCustomer = {
        email: c.email,
        firstName: c.firstName,
        lastName: c.lastName,
        totalSpent: c.totalSpent,
        ordersCount: c.ordersCount,
      };

      if (brevoReady) {
        try {
          await markCustomerAsVip(vip);
          vipNotified++;
        } catch (e) {
          errors.push(`Brevo VIP ${c.email}: ${String(e)}`);
          continue; // on ne pose pas isVip : retry au prochain run
        }
      }

      await prisma.$executeRawUnsafe(
        `UPDATE "BtocCustomer"
         SET "isVip" = true, "vipSince" = NOW(), "updatedAt" = NOW()
         WHERE LOWER(email) = LOWER($1) AND "isVip" = false`,
        c.email
      );
    }

    await prisma.btocSyncLog.create({
      data: {
        syncType: "VIP",
        itemCount: vipNotified,
        errorCount: errors.length,
        errors: errors.length > 0 ? JSON.stringify(errors.slice(0, 50)) : null,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        mode: "live",
        customersUpdated: Number(updatedCount),
        vipCandidates: candidates.length,
        vipNotified,
        errors: errors.slice(0, 20),
      },
    });
  } catch (e) {
    return handleApiError(e, "api/sync/btoc/vip-recompute");
  }
}

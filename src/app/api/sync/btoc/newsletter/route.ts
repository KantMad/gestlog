import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { isBrevoConfigured, listAllContacts } from "@/lib/brevo";
import { dedupeRows, newsletterListIds, toNewsletterRow } from "@/lib/btoc-newsletter";

export const maxDuration = 120;

// ─── Synchro des contacts Brevo → BtocNewsletterContact ──────────────────
// Appelée par n8n (fin du workflow « GestLog — Sync BtoC WooCommerce »), sans corps :
// GestLog lit lui-même TOUS les contacts Brevo (≈ 21 pages de 1000, ~10 s).
//
// • upsert par e-mail normalisé ;
// • unsubscribedAt posé au passage inscrit → désinscrit (date = modifiedAt Brevo,
//   à défaut NOW()), remis à NULL si le contact se réinscrit ;
// • un contact absent de Brevo n'est PAS supprimé : subscribed=false + removedAt.
// Sécurité : si Brevo renvoie une liste anormalement courte (< 50 % de la base
// connue), on n'applique PAS le marquage « disparu » (évite de désinscrire tout le
// monde sur une réponse partielle).
export async function POST(request: NextRequest) {
  const started = Date.now();
  try {
    if (request.headers.get("x-api-key") !== process.env.SYNC_API_KEY) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }
    if (!isBrevoConfigured()) {
      return NextResponse.json({ error: "Brevo non configuré" }, { status: 503 });
    }

    const syncStart = new Date();
    const nlIds = newsletterListIds();
    const raw = await listAllContacts();
    const rows = dedupeRows(raw.map((c) => toNewsletterRow(c, nlIds)).filter((r) => r !== null));

    const BATCH = 1000;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      await prisma.$executeRawUnsafe(
        `INSERT INTO "BtocNewsletterContact" AS t
           (id, email, "brevoId", "firstName", "lastName", phone, "listIds", "unsubscribedListIds",
            blacklisted, "inNewsletterList", subscribed, "subscribedAt", "brevoModifiedAt",
            "unsubscribedAt", "removedAt", "lastSeenAt", "createdAt", "updatedAt")
         SELECT 'nl_' || md5(r.email), r.email, r."brevoId", r."firstName", r."lastName", r.phone,
                COALESCE(ARRAY(SELECT jsonb_array_elements_text(r."listIds")::int), '{}'),
                COALESCE(ARRAY(SELECT jsonb_array_elements_text(r."unsubscribedListIds")::int), '{}'),
                r.blacklisted, r."inNewsletterList", r.subscribed,
                r."subscribedAt"::timestamp, r."brevoModifiedAt"::timestamp,
                CASE WHEN r.subscribed OR NOT r."inNewsletterList" THEN NULL
                     ELSE COALESCE(r."brevoModifiedAt"::timestamp, $2) END,
                NULL, $2, $2, $2
           FROM jsonb_to_recordset($1::jsonb) AS r(
                email text, "brevoId" int, "firstName" text, "lastName" text, phone text,
                "listIds" jsonb, "unsubscribedListIds" jsonb, blacklisted boolean,
                "inNewsletterList" boolean, subscribed boolean,
                "subscribedAt" text, "brevoModifiedAt" text)
         ON CONFLICT (email) DO UPDATE SET
           "brevoId" = EXCLUDED."brevoId",
           "firstName" = EXCLUDED."firstName",
           "lastName" = EXCLUDED."lastName",
           phone = EXCLUDED.phone,
           "listIds" = EXCLUDED."listIds",
           "unsubscribedListIds" = EXCLUDED."unsubscribedListIds",
           blacklisted = EXCLUDED.blacklisted,
           "inNewsletterList" = EXCLUDED."inNewsletterList" OR t."inNewsletterList",
           subscribed = EXCLUDED.subscribed,
           "subscribedAt" = COALESCE(EXCLUDED."subscribedAt", t."subscribedAt"),
           "brevoModifiedAt" = EXCLUDED."brevoModifiedAt",
           "unsubscribedAt" = CASE
             WHEN EXCLUDED.subscribed THEN NULL
             WHEN t.subscribed THEN COALESCE(EXCLUDED."brevoModifiedAt", $2)
             WHEN t."unsubscribedAt" IS NULL AND (EXCLUDED."inNewsletterList" OR t."inNewsletterList")
               THEN COALESCE(EXCLUDED."brevoModifiedAt", $2)
             ELSE t."unsubscribedAt" END,
           "removedAt" = NULL,
           "lastSeenAt" = $2,
           "updatedAt" = $2`,
        JSON.stringify(chunk),
        syncStart,
      );
    }

    // Contacts disparus de Brevo (supprimés là-bas).
    const known = await prisma.btocNewsletterContact.count({ where: { removedAt: null } });
    let removed = 0;
    let removalSkipped = false;
    if (rows.length >= known * 0.5) {
      removed = await prisma.$executeRawUnsafe(
        `UPDATE "BtocNewsletterContact"
            SET "removedAt" = $1,
                "unsubscribedAt" = CASE WHEN subscribed THEN $1 ELSE "unsubscribedAt" END,
                subscribed = false, "updatedAt" = $1
          WHERE "lastSeenAt" < $1 AND "removedAt" IS NULL`,
        syncStart,
      );
    } else {
      removalSkipped = true;
    }

    const subscribed = await prisma.btocNewsletterContact.count({ where: { subscribed: true } });
    await prisma.btocSyncLog.create({
      data: {
        syncType: "NEWSLETTER",
        itemCount: rows.length,
        errorCount: removalSkipped ? 1 : 0,
        errors: removalSkipped
          ? JSON.stringify([`Réponse Brevo courte (${rows.length} vs ${known} connus) : marquage « disparu » ignoré`])
          : null,
        duration: Date.now() - started,
      },
    });

    return NextResponse.json({
      success: true,
      data: { brevoContacts: raw.length, synced: rows.length, subscribed, removed, removalSkipped, ms: Date.now() - started },
    });
  } catch (e) {
    return handleApiError(e, "api/sync/btoc/newsletter");
  }
}

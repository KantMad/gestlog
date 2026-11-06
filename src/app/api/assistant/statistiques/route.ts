import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { cleAssistantValide } from "@/lib/assistant-cle";
import { prisma } from "@/lib/prisma";
import { parisRangeToUtc } from "@/lib/btoc-dates";
import {
  anPrecedent,
  joursEntre,
  jourValide,
  totauxB2b,
  totauxSite,
  ventesParCategorie,
  type LigneVenteProduit,
  type TotauxB2bRow,
  type TotauxSiteRow,
} from "@/lib/assistant-clients";

// GET — Statistiques générales, en LECTURE SEULE pour l'assistant IA.
//   ?debut=YYYY-MM-DD&fin=YYYY-MM-DD   jours de Paris inclus, 366 jours au plus
// Site (copie WooCommerce synchronisée par n8n) et B2B (commandes TIO), avec la même période de
// l'an dernier. Règles : cf. src/lib/assistant-clients.ts.

const SITE_COMPTE = `o.status NOT IN ('cancelled', 'refunded', 'failed')`;
// HT estimé : la part remboursée est retirée au prorata du total TTC de la commande.
const HT_NET = `(o.total - COALESCE(o."totalTax", 0)) * CASE WHEN o.total > 0 THEN 1 - COALESCE(o."totalRefunded", 0) / o.total ELSE 1 END`;

export async function GET(request: NextRequest) {
  try {
    if (!cleAssistantValide(request.headers.get("x-api-key"))) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }
    const debut = request.nextUrl.searchParams.get("debut");
    const fin = request.nextUrl.searchParams.get("fin");
    if (!jourValide(debut) || !jourValide(fin) || debut > fin || joursEntre(debut, fin) > 366) {
      return NextResponse.json({ error: "Paramètres debut et fin attendus (YYYY-MM-DD, 366 jours au plus)" }, { status: 400 });
    }
    const { gte, lt } = parisRangeToUtc(debut, fin);
    const avant = parisRangeToUtc(anPrecedent(debut), anPrecedent(fin));

    const totalSite = (de: Date, a: Date) =>
      prisma.$queryRawUnsafe<TotauxSiteRow[]>(
        `SELECT COUNT(*) AS commandes, SUM(o.total - COALESCE(o."totalRefunded", 0)) AS "caTtc", SUM(${HT_NET}) AS "caHt",
                SUM(o."itemCount") AS articles, COUNT(DISTINCT LOWER(o."customerEmail")) AS clients
         FROM "BtocOrder" o WHERE ${SITE_COMPTE} AND o."orderDate" >= $1 AND o."orderDate" < $2`,
        de, a
      );
    const totalB2b = (de: Date, a: Date) =>
      prisma.$queryRawUnsafe<TotauxB2bRow[]>(
        `SELECT COUNT(*) AS commandes, SUM(o."totalAmount") AS montant, COUNT(DISTINCT o."clientId") AS clients,
                COUNT(*) FILTER (WHERE o."totalAmount" IS NULL) AS "sansMontant"
         FROM "ClientOrder" o
         WHERE o.source = 'TIO' AND o.status <> 'ANNULEE' AND o."orderDate" >= $1 AND o."orderDate" < $2`,
        de, a
      );

    const [site, siteAvant, b2b, b2bAvant, pays, ventes, remboursees, meilleursSite, meilleursB2b, nouveaux] = await Promise.all([
      totalSite(gte!, lt!),
      totalSite(avant.gte!, avant.lt!),
      totalB2b(gte!, lt!),
      totalB2b(avant.gte!, avant.lt!),
      prisma.$queryRawUnsafe<{ pays: string | null; commandes: bigint; caTtc: number }[]>(
        `SELECT COALESCE(NULLIF(o."shippingCountry", ''), o."billingCountry") AS pays, COUNT(*) AS commandes,
                SUM(o.total - COALESCE(o."totalRefunded", 0)) AS "caTtc"
         FROM "BtocOrder" o WHERE ${SITE_COMPTE} AND o."orderDate" >= $1 AND o."orderDate" < $2
         GROUP BY 1 ORDER BY 3 DESC LIMIT 5`,
        gte, lt
      ),
      prisma.$queryRawUnsafe<LigneVenteProduit[]>(
        `SELECT ol.name, SUM(ol.quantity) AS quantity, SUM(ol.total) AS total
         FROM "BtocOrderLine" ol JOIN "BtocOrder" o ON o.id = ol."orderId"
         WHERE ${SITE_COMPTE} AND o."orderDate" >= $1 AND o."orderDate" < $2
         GROUP BY ol.name`,
        gte, lt
      ),
      prisma.$queryRawUnsafe<LigneVenteProduit[]>(
        `SELECT COALESCE(rl.name, '') AS name, SUM(rl.quantity) AS quantity, SUM(rl.total) AS total
         FROM "BtocRefundLine" rl JOIN "BtocOrder" o ON o."wooId" = rl."orderWooId"
         WHERE ${SITE_COMPTE} AND o."orderDate" >= $1 AND o."orderDate" < $2
         GROUP BY 1`,
        gte, lt
      ),
      prisma.$queryRawUnsafe<{ nom: string | null; ville: string | null; commandes: bigint; caTtc: number }[]>(
        `SELECT MAX(COALESCE(NULLIF(TRIM(o."customerName"), ''), CONCAT_WS(' ', o."billingFirstName", o."billingLastName"))) AS nom,
                MAX(COALESCE(o."shippingCity", o."billingCity")) AS ville, COUNT(*) AS commandes,
                SUM(o.total - COALESCE(o."totalRefunded", 0)) AS "caTtc"
         FROM "BtocOrder" o
         WHERE ${SITE_COMPTE} AND o."orderDate" >= $1 AND o."orderDate" < $2 AND COALESCE(o."customerEmail", '') <> ''
         GROUP BY LOWER(o."customerEmail") ORDER BY 4 DESC LIMIT 5`,
        gte, lt
      ),
      prisma.$queryRawUnsafe<{ nom: string; commandes: bigint; montant: number | null }[]>(
        `SELECT c.name AS nom, COUNT(*) AS commandes, SUM(o."totalAmount") AS montant
         FROM "ClientOrder" o JOIN "Client" c ON c.id = o."clientId"
         WHERE o.source = 'TIO' AND o.status <> 'ANNULEE' AND o."orderDate" >= $1 AND o."orderDate" < $2
         GROUP BY c.id, c.name ORDER BY 3 DESC NULLS LAST LIMIT 5`,
        gte, lt
      ),
      // Nouveaux clients : première commande (site actuel ou ancien site) dans la période.
      prisma.$queryRawUnsafe<{ nouveaux: bigint }[]>(
        `SELECT COUNT(*) FILTER (WHERE premiere >= $1 AND premiere < $2) AS nouveaux FROM (
           SELECT LOWER(email) AS cle, MIN(d) AS premiere FROM (
             SELECT o."customerEmail" AS email, o."orderDate" AS d FROM "BtocOrder" o WHERE ${SITE_COMPTE}
             UNION ALL SELECT h."customerEmail", h."orderDate" FROM "HistOrder" h
           ) t WHERE COALESCE(email, '') <> '' GROUP BY 1
         ) p`,
        gte, lt
      ),
    ]);

    const n = (v: unknown) => Number(v ?? 0) || 0;
    return NextResponse.json({
      debut,
      fin,
      anDernier: { debut: anPrecedent(debut), fin: anPrecedent(fin) },
      site: {
        ...totauxSite(site[0]),
        nouveauxClients: n(nouveaux[0]?.nouveaux),
        anDernier: totauxSite(siteAvant[0]),
        parPays: pays.map((p) => ({ pays: p.pays ?? "inconnu", commandes: n(p.commandes), caTtc: Math.round(n(p.caTtc) * 100) / 100 })),
        parCategorie: ventesParCategorie(ventes, remboursees).slice(0, 6),
        meilleursClients: meilleursSite.map((c) => ({ nom: c.nom?.trim() || "sans nom", ville: c.ville, commandes: n(c.commandes), caTtc: Math.round(n(c.caTtc) * 100) / 100 })),
      },
      b2b: {
        ...totauxB2b(b2b[0]),
        anDernier: totauxB2b(b2bAvant[0]),
        meilleursClients: meilleursB2b.map((c) => ({ nom: c.nom, commandes: n(c.commandes), montant: Math.round(n(c.montant) * 100) / 100 })),
      },
    });
  } catch (e) {
    return handleApiError(e, "api/assistant/statistiques");
  }
}

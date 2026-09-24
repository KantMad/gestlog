import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { resolveOrderSource } from "@/lib/order-source";
import {
  buildComparison,
  totauxComparaison,
  type SourceAgg,
} from "@/lib/source-comparison";

export const maxDuration = 60;

// GET — Commandes clients importées : TIO (archive) contre TEXAS (ERP).
// ?seasonId (requis)
//
// 🔴 C'est le SEUL endroit qui lit les deux sources à la fois. Partout ailleurs,
// `resolveOrderSource` n'en retient qu'une — l'autre devient invisible.
//
// ⚠️ `orderType='COMMANDE'` des deux côtés (hors VSS), comme les autres écrans B2B, pour
// que la comparaison porte sur des périmètres équivalents.
export async function GET(request: NextRequest) {
  try {
    const seasonId = request.nextUrl.searchParams.get("seasonId");
    if (!seasonId) {
      return NextResponse.json({ error: "Saison requise" }, { status: 400 });
    }

    // Agrégats par boutique et par catalogue, calculés en SQL : ramener les
    // 18 556 lignes d'AH26 pour les regrouper en mémoire n'apporterait rien.
    const agg = async (dimension: "client" | "catalog") => {
      const idCol = dimension === "client" ? `cl.id` : `COALESCE(cat.id, '—')`;
      const labelCol =
        dimension === "client"
          ? `COALESCE(cl.name, cl.code, '—')`
          : `COALESCE(cat.name, 'Sans catalogue')`;
      return prisma.$queryRawUnsafe<
        { source: string; id: string; label: string; orders: bigint; lines: bigint; pieces: bigint; amount: number }[]
      >(
        `SELECT co.source AS source,
                ${idCol} AS id,
                ${labelCol} AS label,
                COUNT(DISTINCT co.id)::bigint AS orders,
                COUNT(col.id)::bigint AS lines,
                COALESCE(SUM(col."totalQuantity"), 0)::bigint AS pieces,
                COALESCE(SUM(col.amount), 0)::float8 AS amount
           FROM "ClientOrder" co
           JOIN "ClientOrderLine" col ON col."clientOrderId" = co.id
           JOIN "Client" cl ON cl.id = co."clientId"
           LEFT JOIN "Catalog" cat ON cat.id = co."catalogId"
          WHERE co."seasonId" = $1 AND co."orderType" = 'COMMANDE'
          GROUP BY 1, 2, 3`,
        seasonId
      );
    };

    const [parClient, parCatalogue, numeros, source] = await Promise.all([
      agg("client"),
      agg("catalog"),
      // Rapprochement des commandes : les NUMÉROS ne se recoupent pas d'une source à
      // l'autre (0 commun sur AH26), c'est `tioOrderNumber` qui fait le lien.
      prisma.clientOrder.findMany({
        where: { seasonId, orderType: "COMMANDE" },
        select: { source: true, tioOrderNumber: true },
      }),
      resolveOrderSource(seasonId),
    ]);

    const toAgg = (rows: Awaited<ReturnType<typeof agg>>): SourceAgg[] =>
      rows.map((r) => ({
        source: r.source === "TEXAS" ? "TEXAS" : "TIO",
        id: r.id,
        label: r.label,
        orders: Number(r.orders),
        lines: Number(r.lines),
        pieces: Number(r.pieces),
        amount: Number(r.amount),
      }));

    const boutiques = buildComparison(toAgg(parClient));
    const catalogues = buildComparison(toAgg(parCatalogue));
    const totaux = totauxComparaison(boutiques);

    const numTio = new Set(
      numeros.filter((o) => o.source === "TIO" && o.tioOrderNumber).map((o) => o.tioOrderNumber!)
    );
    const numTexas = new Set(
      numeros.filter((o) => o.source === "TEXAS" && o.tioOrderNumber).map((o) => o.tioOrderNumber!)
    );
    const communs = [...numTio].filter((n) => numTexas.has(n)).length;

    return NextResponse.json({
      totaux,
      boutiques,
      catalogues,
      meta: {
        sourceActive: source,
        // Une saison sans commandes Texas ne se compare à rien : l'écran le dit.
        lesDeuxSources: totaux.tio.orders > 0 && totaux.texas.orders > 0,
        // Fiches boutique en double : la même enseigne sous deux `Client` distincts
        // selon la source. Compté en PAIRES, pas en lignes.
        fichesEnDouble: boutiques.filter((b) => b.ressemble).length / 2,
        fichesEnDoubleExactes: boutiques.filter((b) => b.ressembleExact).length / 2,
        commandes: {
          tioAvecNumero: numTio.size,
          texasAvecNumero: numTexas.size,
          communs,
          tioSeulement: numTio.size - communs,
          texasSeulement: numTexas.size - communs,
          sansNumero: numeros.filter((o) => !o.tioOrderNumber).length,
        },
      },
    });
  } catch (e) {
    return handleApiError(e, "api/statistics/source-comparison");
  }
}

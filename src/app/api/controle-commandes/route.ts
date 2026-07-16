import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { resolveOrderSource } from "@/lib/order-source";

// GET — Détecte les « sélections » : lignes de commande où le client n'a commandé
// qu'UNE SEULE taille pour un produit/couleur, alors que le produit en propose plusieurs.
// But métier : repérer ces lignes pour les supprimer dans TIO.
// Les produits en taille unique (grille à 1 taille, ex. TU) sont EXCLUS : une seule taille
// y est normale, ce n'est pas une sélection.
export async function GET(request: NextRequest) {
  try {
    const seasonId = request.nextUrl.searchParams.get("seasonId");
    if (!seasonId) return NextResponse.json({ error: "seasonId requis" }, { status: 400 });

    // Une seule source B2B par saison (Texas prioritaire, repli TIO).
    const source = await resolveOrderSource(seasonId);

    const rows = await prisma.$queryRawUnsafe<
      {
        orderId: string;
        orderNumber: string;
        clientCode: string;
        clientName: string;
        reference: string;
        color: string;
        colorLabel: string | null;
        productLabel: string | null;
        sizeScale: string;
        quantitiesBySize: string;
        totalQuantity: number;
      }[]
    >(
      `SELECT co.id AS "orderId", co."orderNumber",
              cl.code AS "clientCode", cl.name AS "clientName",
              p.reference, p.color, p."colorLabel", p.label AS "productLabel",
              p."sizeScale", col."quantitiesBySize", col."totalQuantity"
       FROM "ClientOrderLine" col
       JOIN "ClientOrder" co ON co.id = col."clientOrderId"
       JOIN "Client" cl ON cl.id = co."clientId"
       JOIN "Product" p ON p.id = col."productId"
       WHERE co."seasonId" = $1
         AND co.source = $2
         -- exactement UNE taille avec une quantité > 0
         AND (SELECT count(*) FROM jsonb_each_text(col."quantitiesBySize"::jsonb) kv
              WHERE (kv.value)::numeric > 0) = 1
         -- ... mais le produit propose au moins 2 tailles DISTINCTES (sinon : taille unique
         -- = normal). Distinct obligatoire : certaines grilles sont dupliquées ("TU,TU").
         AND (SELECT count(DISTINCT btrim(s))
              FROM unnest(string_to_array(COALESCE(p."sizeScale", ''), ',')) AS s
              WHERE btrim(s) <> '') > 1
       ORDER BY cl.name, co."orderNumber", p.reference, p.color`,
      seasonId,
      source
    );

    // Extrait la taille unique commandée + sa quantité.
    const data = rows.map((r) => {
      let size = "";
      let qty = 0;
      try {
        const q = JSON.parse(r.quantitiesBySize) as Record<string, number>;
        const entry = Object.entries(q).find(([, v]) => Number(v) > 0);
        if (entry) {
          size = entry[0];
          qty = Number(entry[1]);
        }
      } catch {
        /* JSON invalide → ligne renvoyée sans taille */
      }
      return {
        orderId: r.orderId,
        orderNumber: r.orderNumber,
        clientCode: r.clientCode,
        clientName: r.clientName,
        reference: r.reference,
        color: r.color,
        colorLabel: r.colorLabel,
        productLabel: r.productLabel,
        // Grille dédoublonnée pour l'affichage (certaines arrivent en "TU,TU").
        sizeScale: [
          ...new Set((r.sizeScale || "").split(",").map((s) => s.trim()).filter(Boolean)),
        ].join(","),
        sizeCount: new Set(
          (r.sizeScale || "").split(",").map((s) => s.trim()).filter(Boolean)
        ).size,
        size,
        quantity: qty,
        totalQuantity: Number(r.totalQuantity),
      };
    });

    const orders = new Set(data.map((d) => d.orderNumber));
    const clients = new Set(data.map((d) => d.clientCode));

    return NextResponse.json({
      data,
      source,
      summary: {
        lines: data.length,
        orders: orders.size,
        clients: clients.size,
        pieces: data.reduce((s, d) => s + d.quantity, 0),
      },
    });
  } catch (e) {
    return handleApiError(e, "api/controle-commandes");
  }
}

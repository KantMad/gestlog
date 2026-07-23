import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api";

export const maxDuration = 60;

// POST — Backfill léger des ADRESSES (facturation + livraison) des commandes BtoC.
// Body : { orders: [{ wooId, billing: {...}, shipping: {...} }] } (ou tableau direct).
//
// Met à jour uniquement les colonnes d'adresse — **ne retouche NI les lignes NI les
// montants** (contrairement à la sync complète, qui supprime/réinsère les BtocOrderLine).
// Sert à peupler l'historique après l'ajout de ces colonnes (export « Ventes détaillées »).
// Idempotent : une valeur vide n'écrase jamais une valeur déjà présente.

interface WooAddress {
  first_name?: string;
  last_name?: string;
  address_1?: string;
  postcode?: string;
  city?: string;
  country?: string;
}

const s = (v: unknown) => String(v ?? "").trim();

export async function POST(request: NextRequest) {
  try {
    if (request.headers.get("x-api-key") !== process.env.SYNC_API_KEY) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const body = await request.json();
    const list: { wooId: number; billing?: WooAddress; shipping?: WooAddress }[] = Array.isArray(body)
      ? body
      : body.orders || [];

    // Dédoublonne par wooId (dernière occurrence gagne).
    const byWoo = new Map<number, (string | number)[]>();
    for (const o of list) {
      const wooId = Number(o.wooId);
      if (!Number.isFinite(wooId)) continue;
      const b = o.billing || {};
      const sh = o.shipping || {};
      byWoo.set(wooId, [
        wooId,
        s(b.first_name),
        s(b.last_name),
        s(b.address_1),
        s(b.postcode),
        s(b.city),
        s(b.country).toUpperCase(),
        s(sh.first_name),
        s(sh.last_name),
        s(sh.address_1),
        s(sh.postcode),
        s(sh.city),
        s(sh.country).toUpperCase(),
      ]);
    }
    const rows = [...byWoo.values()];

    const CHUNK = 200; // 13 params/ligne → 2600 params max par requête
    let updated = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const flat: unknown[] = [];
      const values = slice.map((vals) => {
        const ph = vals.map((v, idx) => {
          flat.push(v);
          return idx === 0 ? `$${flat.length}::int` : `$${flat.length}::text`;
        });
        return `(${ph.join(",")})`;
      });
      const res = await prisma.$executeRawUnsafe(
        `UPDATE "BtocOrder" o SET
           "billingFirstName"  = COALESCE(NULLIF(v.b_first, ''),   o."billingFirstName"),
           "billingLastName"   = COALESCE(NULLIF(v.b_last, ''),    o."billingLastName"),
           "billingAddress1"   = COALESCE(NULLIF(v.b_addr, ''),    o."billingAddress1"),
           "billingPostcode"   = COALESCE(NULLIF(v.b_post, ''),    o."billingPostcode"),
           "billingCity"       = COALESCE(NULLIF(v.b_city, ''),    o."billingCity"),
           "billingCountry"    = COALESCE(NULLIF(v.b_country, ''), o."billingCountry"),
           "shippingFirstName" = COALESCE(NULLIF(v.s_first, ''),   o."shippingFirstName"),
           "shippingLastName"  = COALESCE(NULLIF(v.s_last, ''),    o."shippingLastName"),
           "shippingAddress1"  = COALESCE(NULLIF(v.s_addr, ''),    o."shippingAddress1"),
           "shippingPostcode"  = COALESCE(NULLIF(v.s_post, ''),    o."shippingPostcode"),
           "shippingCity"      = COALESCE(NULLIF(v.s_city, ''),    o."shippingCity"),
           "shippingCountry"   = COALESCE(NULLIF(v.s_country, ''), o."shippingCountry"),
           "updatedAt" = NOW()
         FROM (VALUES ${values.join(",")}) AS v(
           woo_id, b_first, b_last, b_addr, b_post, b_city, b_country,
           s_first, s_last, s_addr, s_post, s_city, s_country
         )
         WHERE o."wooId" = v.woo_id`,
        ...flat
      );
      updated += res;
    }

    return NextResponse.json({
      success: true,
      data: { received: list.length, updated },
    });
  } catch (e) {
    return handleApiError(e, "api/sync/btoc/order-addresses");
  }
}

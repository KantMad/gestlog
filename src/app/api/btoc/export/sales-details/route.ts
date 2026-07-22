import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parisRangeToUtc } from "@/lib/btoc-dates";

// ─── Export « Ventes détaillées » ───────────────────────────────
// Une ligne PAR COMMANDE, avec les coordonnées de FACTURATION et de LIVRAISON
// (nom, prénom, adresse, code postal, ville, pays) et le MOYEN DE PAIEMENT
// (Monetico, PayPal…). Filtre par plage de dates (bornes Paris, cf. btoc-dates)
// et par statuts (multi-sélection ; défaut « ventes » = hors annulées/remboursées/échouées).
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const { gte, lt } = parisRangeToUtc(params.get("dateFrom"), params.get("dateTo"));
    const statuses = (params.get("statuses") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const where: {
      orderDate?: { gte?: Date; lt?: Date };
      status?: { in: string[] } | { notIn: string[] };
    } = {};
    if (gte || lt) where.orderDate = { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) };
    where.status =
      statuses.length > 0
        ? { in: statuses }
        : { notIn: ["cancelled", "refunded", "failed"] };

    const orders = await prisma.btocOrder.findMany({
      where,
      orderBy: { orderDate: "desc" },
      select: {
        orderNumber: true,
        orderDate: true,
        status: true,
        total: true,
        totalTax: true,
        shippingTotal: true,
        totalRefunded: true,
        currency: true,
        paymentMethod: true,
        paymentTitle: true,
        customerEmail: true,
        billingFirstName: true,
        billingLastName: true,
        billingAddress1: true,
        billingPostcode: true,
        billingCity: true,
        billingCountry: true,
        shippingFirstName: true,
        shippingLastName: true,
        shippingAddress1: true,
        shippingPostcode: true,
        shippingCity: true,
        shippingCountry: true,
      },
    });

    const rows = orders.map((o) => {
      // Livraison vide (Woo « expédier à l'adresse de facturation ») → on retombe sur la
      // facturation pour que les colonnes de livraison ne soient pas vides.
      const hasShipping = Boolean(
        o.shippingFirstName ||
          o.shippingLastName ||
          o.shippingAddress1 ||
          o.shippingPostcode ||
          o.shippingCity ||
          o.shippingCountry
      );
      return {
        orderNumber: o.orderNumber,
        orderDate: o.orderDate ? o.orderDate.toISOString() : "",
        status: o.status,
        total: o.total ?? 0,
        totalTax: o.totalTax ?? 0,
        shippingTotal: o.shippingTotal ?? 0,
        totalRefunded: o.totalRefunded ?? 0,
        currency: o.currency || "EUR",
        // Libellé lisible (PayPal, Monetico…) en priorité, sinon le code interne.
        paymentTitle: o.paymentTitle || o.paymentMethod || "",
        paymentMethod: o.paymentMethod || "",
        customerEmail: o.customerEmail || "",
        billingFirstName: o.billingFirstName || "",
        billingLastName: o.billingLastName || "",
        billingAddress1: o.billingAddress1 || "",
        billingPostcode: o.billingPostcode || "",
        billingCity: o.billingCity || "",
        billingCountry: o.billingCountry || "",
        shippingFirstName: (hasShipping ? o.shippingFirstName : o.billingFirstName) || "",
        shippingLastName: (hasShipping ? o.shippingLastName : o.billingLastName) || "",
        shippingAddress1: (hasShipping ? o.shippingAddress1 : o.billingAddress1) || "",
        shippingPostcode: (hasShipping ? o.shippingPostcode : o.billingPostcode) || "",
        shippingCity: (hasShipping ? o.shippingCity : o.billingCity) || "",
        shippingCountry: (hasShipping ? o.shippingCountry : o.billingCountry) || "",
        shippingSameAsBilling: !hasShipping,
      };
    });

    return NextResponse.json({ orders: rows, total: rows.length });
  } catch (e) {
    return handleApiError(e, "api/btoc/export/sales-details");
  }
}

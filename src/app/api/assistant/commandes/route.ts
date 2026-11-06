import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { cleAssistantValide } from "@/lib/assistant-cle";
import { prisma } from "@/lib/prisma";
import { parisRangeToUtc } from "@/lib/btoc-dates";
import { jourValide, STATUTS_EXCLUS } from "@/lib/assistant-clients";

// GET — Commandes, en LECTURE SEULE pour l'assistant IA.
//   ?numero=12345      une commande précise : B2B (n° Gestlog ou TIO), site ou ancien site, avec ses lignes
//   ?jour=YYYY-MM-DD   les commandes du site de ce jour de Paris (les B2B du jour : /api/assistant/recap)
export async function GET(request: NextRequest) {
  try {
    if (!cleAssistantValide(request.headers.get("x-api-key"))) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }
    const p = request.nextUrl.searchParams;
    const numero = (p.get("numero") ?? "").trim().replace(/^#/, "");
    const jour = p.get("jour");
    if (numero && numero.length <= 40) return NextResponse.json({ commandes: await parNumero(numero) });
    if (jourValide(jour)) return NextResponse.json({ jour, commandes: await duJour(jour) });
    return NextResponse.json({ error: "Paramètre numero ou jour (YYYY-MM-DD) attendu" }, { status: 400 });
  } catch (e) {
    return handleApiError(e, "api/assistant/commandes");
  }
}

async function parNumero(numero: string) {
  const [b2b, site, ancien] = await Promise.all([
    prisma.clientOrder.findMany({
      where: { OR: [{ orderNumber: numero }, { tioOrderNumber: numero }] },
      take: 3,
      include: {
        client: { select: { name: true, code: true } },
        season: { select: { name: true } },
        lines: { include: { product: { select: { reference: true, label: true, colorLabel: true, color: true } } } },
      },
    }),
    prisma.btocOrder.findMany({
      where: { OR: [{ orderNumber: numero }, ...(/^\d{1,9}$/.test(numero) ? [{ wooId: Number(numero) }] : [])] },
      take: 3,
      include: { lines: true },
    }),
    prisma.histOrder.findMany({ where: { orderNumber: numero }, take: 3, include: { lines: true } }),
  ]);
  return [
    ...b2b.map((o) => ({
      canal: "b2b",
      numero: o.orderNumber,
      numeroTio: o.tioOrderNumber,
      date: o.orderDate,
      client: `${o.client.name} (${o.client.code})`,
      saison: o.season.name,
      type: o.orderType,
      statut: o.status,
      paiement: o.paymentStatus,
      livraison: o.deliveryWindow,
      montant: o.totalAmount,
      lignes: o.lines.map((l) => ({
        produit: `${l.product.label ?? l.product.reference} (${l.product.reference}, ${l.product.colorLabel ?? l.product.color})`,
        quantite: l.totalQuantity,
        annulees: l.cancelledTotal,
        montant: l.amount,
      })),
    })),
    ...site.map((o) => ({
      canal: "site",
      numero: o.orderNumber,
      date: o.orderDate,
      client: o.customerName || [o.billingFirstName, o.billingLastName].filter(Boolean).join(" ") || o.customerEmail,
      statut: o.status,
      montantTtc: o.total,
      rembourse: o.totalRefunded,
      livraisonTtc: o.shippingTotal,
      remise: o.discountTotal,
      paiement: o.paymentTitle,
      codesPromo: o.couponCodes ? (JSON.parse(o.couponCodes) as string[]) : [],
      ville: o.shippingCity ?? o.billingCity,
      pays: o.shippingCountry ?? o.billingCountry,
      lignes: o.lines.map((l) => ({ produit: l.name, sku: l.sku, taille: l.size, couleur: l.color, quantite: l.quantity, montantHt: l.total })),
    })),
    ...ancien.map((o) => ({
      canal: "ancien site",
      numero: o.orderNumber,
      date: o.orderDate,
      client: [o.firstName, o.lastName].filter(Boolean).join(" ") || o.customerEmail,
      montantTtc: o.total,
      pays: o.country,
      lignes: o.lines.map((l) => ({ produit: l.productName, sku: l.sku, quantite: l.quantity, montant: l.lineTotal })),
    })),
  ];
}

async function duJour(jour: string) {
  const { gte, lt } = parisRangeToUtc(jour, jour);
  const commandes = await prisma.btocOrder.findMany({
    where: { orderDate: { gte: gte!, lt: lt! } },
    orderBy: { orderDate: "desc" },
    take: 50,
    select: {
      orderNumber: true, orderDate: true, status: true, total: true, totalRefunded: true, itemCount: true,
      customerName: true, billingFirstName: true, billingLastName: true, shippingCity: true, billingCity: true,
    },
  });
  return commandes.map((o) => ({
    numero: o.orderNumber,
    date: o.orderDate,
    client: o.customerName || [o.billingFirstName, o.billingLastName].filter(Boolean).join(" ") || null,
    ville: o.shippingCity ?? o.billingCity,
    statut: o.status,
    compte: !STATUTS_EXCLUS.includes(o.status),
    montantTtc: o.total - o.totalRefunded,
    articles: o.itemCount,
  }));
}

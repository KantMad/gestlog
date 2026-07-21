import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/session";
import { stringifySizeQuantities, sumQuantities } from "@/lib/utils";

// Résolution produit (réf + code couleur), tolérante au zéro initial du code.
async function findProduct(reference: string, color: string) {
  const cands = new Set<string>([color]);
  if (/^\d+$/.test(color)) {
    cands.add(color.padStart(3, "0"));
    cands.add(String(parseInt(color, 10)));
  }
  for (const c of cands) {
    const p = await prisma.product.findUnique({ where: { reference_color: { reference, color: c } } });
    if (p) return p;
  }
  return null;
}

function parseQty(raw: string): Record<string, number> {
  try {
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

// GET — Détail d'une réception (lignes + couleurs disponibles par référence pour l'édition).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const rec = await prisma.supplierReception.findUnique({
      where: { id },
      select: {
        id: true,
        receptionNumber: true,
        receptionDate: true,
        lastEditedBy: true,
        lastEditedAt: true,
        supplierOrder: { select: { orderNumber: true, seasonId: true } },
        supplier: { select: { name: true, code: true } },
        lines: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            totalQuantity: true,
            quantitiesBySize: true,
            product: {
              select: { id: true, reference: true, color: true, colorCode: true, colorLabel: true, sizeScale: true },
            },
          },
        },
      },
    });
    if (!rec) return NextResponse.json({ error: "Réception introuvable" }, { status: 404 });

    const lines = rec.lines.map((l) => ({
      id: l.id,
      productId: l.product.id,
      reference: l.product.reference,
      color: l.product.color,
      colorCode: l.product.colorCode,
      colorLabel: l.product.colorLabel,
      sizeScale: l.product.sizeScale,
      quantities: parseQty(l.quantitiesBySize),
      totalQuantity: l.totalQuantity,
    }));

    // Couleurs disponibles par référence (pour permuter la couleur d'une ligne).
    const refs = [...new Set(lines.map((l) => l.reference))];
    const products = await prisma.product.findMany({
      where: { reference: { in: refs } },
      select: { reference: true, color: true, colorCode: true, colorLabel: true, sizeScale: true },
      orderBy: { color: "asc" },
    });
    const colorsByReference: Record<string, typeof products> = {};
    for (const p of products) (colorsByReference[p.reference] ||= []).push(p);

    return NextResponse.json({
      data: {
        id: rec.id,
        receptionNumber: rec.receptionNumber,
        receptionDate: rec.receptionDate,
        orderNumber: rec.supplierOrder.orderNumber,
        supplierName: rec.supplier.name,
        supplierCode: rec.supplier.code,
        lastEditedBy: rec.lastEditedBy,
        lastEditedAt: rec.lastEditedAt,
        lines,
        colorsByReference,
      },
    });
  } catch (e) {
    return handleApiError(e, "api/import/receptions/[id]#GET");
  }
}

interface PatchLine {
  reference: string;
  color: string;
  quantities: Record<string, number>;
}

// PATCH — Remplace les lignes de la réception (correction manuelle). Chaque ligne est
// résolue vers un produit du référentiel (réf + code couleur). Journalise qui/quand.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const rec = await prisma.supplierReception.findUnique({ where: { id }, select: { id: true } });
    if (!rec) return NextResponse.json({ error: "Réception introuvable" }, { status: 404 });

    const body = (await request.json()) as { lines?: PatchLine[] };
    const inputLines = Array.isArray(body.lines) ? body.lines : [];

    // Résolution + nettoyage : quantités > 0 uniquement, produit reconnu.
    // Deux lignes qui retombent sur le MÊME produit sont FUSIONNÉES (quantités additionnées
    // par taille) : le fichier source peut légitimement porter un produit sur plusieurs colis,
    // et une réception ne stocke qu'une ligne par produit.
    const byProduct = new Map<string, Record<string, number>>();
    const notFound: string[] = [];
    for (const l of inputLines) {
      const reference = String(l.reference || "").trim();
      const color = String(l.color || "").trim();
      if (!reference || !color) continue;
      const quantities: Record<string, number> = {};
      for (const [size, q] of Object.entries(l.quantities || {})) {
        const n = Number(q);
        if (Number.isFinite(n) && n > 0) quantities[size] = Math.round(n);
      }
      if (Object.keys(quantities).length === 0) continue; // ligne vide → ignorée
      const product = await findProduct(reference, color);
      if (!product) {
        notFound.push(`${reference} / ${color}`);
        continue;
      }
      const merged = byProduct.get(product.id) ?? {};
      for (const [size, n] of Object.entries(quantities)) {
        merged[size] = (merged[size] || 0) + n;
      }
      byProduct.set(product.id, merged);
    }
    const resolved = [...byProduct.entries()].map(([productId, quantities]) => ({
      productId,
      quantities,
      total: sumQuantities(quantities),
    }));

    if (notFound.length > 0) {
      return NextResponse.json(
        { error: `Produit(s) introuvable(s) au référentiel : ${notFound.join(", ")}` },
        { status: 400 }
      );
    }
    if (resolved.length === 0) {
      return NextResponse.json(
        { error: "Aucune ligne valide (au moins une ligne avec des quantités > 0 est requise)." },
        { status: 400 }
      );
    }

    // Utilisateur courant (audit).
    const session = await verifySession(request.cookies.get("gestlog_session")?.value);
    let editor = "inconnu";
    if (session?.uid) {
      const u = await prisma.user.findUnique({ where: { id: session.uid }, select: { name: true } });
      editor = u?.name || session.uid;
    }

    await prisma.$transaction([
      prisma.receptionLine.deleteMany({ where: { supplierReceptionId: id } }),
      prisma.receptionLine.createMany({
        data: resolved.map((r) => ({
          supplierReceptionId: id,
          productId: r.productId,
          quantitiesBySize: stringifySizeQuantities(r.quantities),
          totalQuantity: r.total,
        })),
      }),
      prisma.supplierReception.update({
        where: { id },
        data: { lastEditedBy: editor, lastEditedAt: new Date() },
      }),
    ]);

    return NextResponse.json({ data: { ok: true, lineCount: resolved.length, lastEditedBy: editor } });
  } catch (e) {
    return handleApiError(e, "api/import/receptions/[id]#PATCH");
  }
}

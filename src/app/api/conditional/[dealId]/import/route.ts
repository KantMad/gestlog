import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/session";
import {
  parseConditionalFile, normReference, normColor, normSize, lineKey,
} from "@/lib/conditional";

export const maxDuration = 60;

const TYPES = new Set(["LIVRAISON", "VENTE", "RETOUR"]);

// POST — Importe un fichier dans une opération (multipart : file, type, movementDate?).
//
// Résolution produit : **EAN d'abord** (ProductSizeEan → référence/couleur/taille), puis
// repli sur référence + couleur + taille. Une ligne non résolue est CONSERVÉE (on ne perd
// aucune quantité) avec `productId = null`, et signalée en anomalie.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await params;
    const deal = await prisma.conditionalDeal.findUnique({ where: { id: dealId } });
    if (!deal) return NextResponse.json({ error: "Opération introuvable" }, { status: 404 });

    const form = await request.formData();
    const file = form.get("file") as File | null;
    const type = String(form.get("type") || "");
    if (!file) return NextResponse.json({ error: "Fichier requis" }, { status: 400 });
    if (!TYPES.has(type)) {
      return NextResponse.json({ error: "Type de mouvement invalide" }, { status: 400 });
    }

    const rows = parseConditionalFile(await file.arrayBuffer());
    if (rows.length === 0) {
      return NextResponse.json(
        {
          error:
            "Aucune ligne exploitable. Le fichier doit contenir une colonne quantité et un identifiant produit (EAN, ou référence + couleur + taille).",
        },
        { status: 400 }
      );
    }

    // ── Résolution des produits ────────────────────────────────────────────────
    const eans = [...new Set(rows.map((r) => r.ean).filter(Boolean))];
    const eanRows = eans.length
      ? await prisma.productSizeEan.findMany({ where: { ean: { in: eans } } })
      : [];
    const byEan = new Map(eanRows.map((e) => [e.ean, e]));

    // Produits candidats : ceux des EAN trouvés + ceux nommés dans le fichier.
    const refs = [
      ...new Set([
        ...rows.map((r) => normReference(r.reference)).filter(Boolean),
        ...eanRows.map((e) => normReference(e.reference)),
      ]),
    ];
    const products = refs.length
      ? await prisma.product.findMany({
          where: { reference: { in: refs } },
          select: { id: true, reference: true, color: true },
        })
      : [];
    const byRefColor = new Map(
      products.map((p) => [`${normReference(p.reference)}__${normColor(p.color)}`, p.id])
    );

    // ── Construction des lignes ────────────────────────────────────────────────
    // Agrégées par clé : un même produit/taille peut apparaître plusieurs fois dans un
    // même fichier (plusieurs colis, plusieurs jours de vente…).
    const agg = new Map<
      string,
      { productId: string | null; ean: string | null; reference: string; color: string; size: string; quantity: number }
    >();
    const unknown: { reference: string; color: string; size: string; ean: string; pieces: number }[] = [];

    for (const r of rows) {
      let reference = normReference(r.reference);
      let color = normColor(r.color);
      let size = normSize(r.size);

      // L'EAN fait autorité : il porte à lui seul référence + couleur + taille.
      const hit = r.ean ? byEan.get(r.ean) : undefined;
      if (hit) {
        reference = normReference(hit.reference);
        color = normColor(hit.color);
        size = normSize(hit.size);
      }
      if (!reference) continue; // ni EAN connu ni référence → inexploitable

      const productId = byRefColor.get(`${reference}__${color}`) ?? null;
      const k = lineKey(reference, color, size);
      const cur = agg.get(k);
      if (cur) cur.quantity += r.quantity;
      else agg.set(k, { productId, ean: r.ean || hit?.ean || null, reference, color, size, quantity: r.quantity });

      if (!productId) {
        const u = unknown.find((x) => x.reference === reference && x.color === color && x.size === size);
        if (u) u.pieces += r.quantity;
        else unknown.push({ reference, color, size, ean: r.ean || "", pieces: r.quantity });
      }
    }

    const lines = [...agg.values()];
    if (lines.length === 0) {
      return NextResponse.json({ error: "Aucune ligne exploitable dans ce fichier." }, { status: 400 });
    }

    // Utilisateur courant (audit).
    const session = await verifySession(request.cookies.get("gestlog_session")?.value);
    let importedBy: string | null = null;
    if (session?.uid) {
      const u = await prisma.user.findUnique({ where: { id: session.uid }, select: { name: true } });
      importedBy = u?.name ?? null;
    }

    const movementDateRaw = String(form.get("movementDate") || "");
    const movementDate = movementDateRaw ? new Date(movementDateRaw) : new Date();

    const movement = await prisma.conditionalMovement.create({
      data: {
        dealId,
        type,
        fileName: file.name,
        importedBy,
        movementDate: isNaN(movementDate.getTime()) ? new Date() : movementDate,
        lines: { create: lines },
      },
      include: { lines: true },
    });

    // ── Alertes ───────────────────────────────────────────────────────────────
    // 1) Produits inconnus du référentiel (ni EAN, ni référence+couleur).
    // 2) Pour VENTE/RETOUR : produits jamais LIVRÉS dans cette opération.
    const warnings: string[] = [];
    if (unknown.length > 0) {
      warnings.push(
        `${unknown.length} produit(s) inconnu(s) du référentiel (${unknown.reduce((s, u) => s + u.pieces, 0)} pièce(s)) — importés mais non valorisés : ${unknown.slice(0, 5).map((u) => `${u.reference}/${u.color}/${u.size}`).join(", ")}${unknown.length > 5 ? "…" : ""}`
      );
    }

    let notDelivered: { reference: string; color: string; size: string; pieces: number }[] = [];
    if (type !== "LIVRAISON") {
      const delivered = await prisma.conditionalMovementLine.findMany({
        where: { movement: { dealId, type: "LIVRAISON" } },
        select: { reference: true, color: true, size: true },
      });
      const deliveredKeys = new Set(delivered.map((d) => lineKey(d.reference, d.color, d.size)));
      notDelivered = lines
        .filter((l) => !deliveredKeys.has(lineKey(l.reference, l.color, l.size)))
        .map((l) => ({ reference: l.reference, color: l.color, size: l.size, pieces: l.quantity }));
      if (notDelivered.length > 0) {
        warnings.push(
          `${notDelivered.length} ligne(s) portent des produits JAMAIS LIVRÉS dans cette opération (${notDelivered.reduce((s, x) => s + x.pieces, 0)} pièce(s)) : ${notDelivered.slice(0, 5).map((x) => `${x.reference}/${x.color}/${x.size}`).join(", ")}${notDelivered.length > 5 ? "…" : ""}`
        );
      }
    }

    return NextResponse.json({
      data: {
        movementId: movement.id,
        type,
        lines: movement.lines.length,
        pieces: movement.lines.reduce((s, l) => s + l.quantity, 0),
        unknownProducts: unknown,
        notDelivered,
        warnings,
      },
    });
  } catch (e) {
    return handleApiError(e, "api/conditional/[dealId]/import");
  }
}

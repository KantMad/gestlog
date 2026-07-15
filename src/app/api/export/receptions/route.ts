import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parseSizeQuantities } from "@/lib/utils";

// GET — Export CSV des réceptions fournisseur d'une saison GestLog.
// Une valeur par ligne (colonne unique), concaténée SANS espace :
//   [saison 3c][n° commande 11c gauche-0][EAN 13c][quantité 1-6c]
//   ex. W2600000110023 <ean13> 12
// - saison : code LU DANS LE FICHIER commande fournisseur (SupplierOrder.tioSeason),
//   PAS la saison GestLog (qui ne sert qu'à cadrer la sélection).
// - quantités agrégées par (commande, EAN) ; toute quantité 0 est retirée.
export async function GET(request: NextRequest) {
  try {
    const seasonId = request.nextUrl.searchParams.get("seasonId");
    if (!seasonId) return NextResponse.json({ error: "seasonId requis" }, { status: 400 });
    // Sélection facultative de réceptions précises (sinon toutes celles de la saison).
    const receptionIds = (request.nextUrl.searchParams.get("receptionIds") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const season = await prisma.season.findUnique({ where: { id: seasonId }, select: { name: true } });

    const receptions = await prisma.supplierReception.findMany({
      where: {
        supplierOrder: { seasonId },
        ...(receptionIds.length > 0 ? { id: { in: receptionIds } } : {}),
      },
      select: {
        supplierOrder: { select: { orderNumber: true, tioSeason: true } },
        lines: {
          select: {
            quantitiesBySize: true,
            product: { select: { reference: true, color: true } },
          },
        },
      },
    });

    // Agrégation par (commande, référence, couleur, taille) → quantité reçue totale.
    type Agg = { orderNumber: string; tioSeason: string | null; reference: string; color: string; size: string; qty: number };
    const agg = new Map<string, Agg>();
    for (const rec of receptions) {
      const orderNumber = rec.supplierOrder.orderNumber;
      const tioSeason = rec.supplierOrder.tioSeason;
      for (const line of rec.lines) {
        const q = parseSizeQuantities(line.quantitiesBySize);
        for (const [size, qty] of Object.entries(q)) {
          if (!qty || qty <= 0) continue;
          const key = `${orderNumber}|${line.product.reference}|${line.product.color}|${size}`;
          const cur = agg.get(key);
          if (cur) cur.qty += qty;
          else
            agg.set(key, {
              orderNumber,
              tioSeason,
              reference: line.product.reference,
              color: line.product.color,
              size,
              qty,
            });
        }
      }
    }

    // Résolution des EAN (réf + couleur + taille).
    const refs = [...new Set([...agg.values()].map((a) => a.reference))];
    const eanRows = refs.length
      ? await prisma.productSizeEan.findMany({
          where: { reference: { in: refs } },
          select: { reference: true, color: true, size: true, ean: true },
        })
      : [];
    const eanByKey = new Map<string, string>();
    for (const e of eanRows) eanByKey.set(`${e.reference}|${e.color}|${e.size}`, e.ean);

    const lines: string[] = [];
    let skippedNoSeason = 0;
    let skippedNoEan = 0;
    for (const a of agg.values()) {
      if (a.qty <= 0) continue; // sécurité : aucune quantité 0
      if (!a.tioSeason) {
        skippedNoSeason++;
        continue;
      }
      const ean = eanByKey.get(`${a.reference}|${a.color}|${a.size}`);
      if (!ean) {
        skippedNoEan++;
        continue;
      }
      const saison = a.tioSeason.toUpperCase().slice(0, 3);
      const cmd = a.orderNumber.padStart(11, "0");
      const ean13 = ean.padStart(13, "0").slice(0, 13);
      lines.push(`${saison}${cmd}${ean13}${a.qty}`);
    }

    // Tri stable pour un fichier reproductible.
    lines.sort();

    const csv = lines.join("\r\n");
    const fileName = `receptions_${season?.name || seasonId}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        // Diagnostics (non bloquants) sur les lignes écartées.
        "X-Rows": String(lines.length),
        "X-Skipped-No-Season": String(skippedNoSeason),
        "X-Skipped-No-Ean": String(skippedNoEan),
      },
    });
  } catch (e) {
    return handleApiError(e, "api/export/receptions");
  }
}

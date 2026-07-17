import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
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
//
// ?groupBy=supplier → un fichier PAR FOURNISSEUR, livrés dans un .zip (un navigateur
// bloque les téléchargements en rafale, le zip est donc le seul envoi fiable).
// Sinon → un seul .csv regroupant toutes les réceptions sélectionnées.
export async function GET(request: NextRequest) {
  try {
    const seasonId = request.nextUrl.searchParams.get("seasonId");
    if (!seasonId) return NextResponse.json({ error: "seasonId requis" }, { status: 400 });
    const perSupplier = request.nextUrl.searchParams.get("groupBy") === "supplier";
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
        supplier: { select: { id: true, code: true, name: true } },
        supplierOrder: { select: { orderNumber: true, tioSeason: true } },
        lines: {
          select: {
            quantitiesBySize: true,
            product: { select: { reference: true, color: true } },
          },
        },
      },
    });

    // Agrégation par (fournisseur, commande, référence, couleur, taille) → quantité reçue.
    type Agg = {
      supplierId: string;
      supplierCode: string;
      orderNumber: string;
      tioSeason: string | null;
      reference: string;
      color: string;
      size: string;
      qty: number;
    };
    const agg = new Map<string, Agg>();
    for (const rec of receptions) {
      const orderNumber = rec.supplierOrder.orderNumber;
      const tioSeason = rec.supplierOrder.tioSeason;
      for (const line of rec.lines) {
        const q = parseSizeQuantities(line.quantitiesBySize);
        for (const [size, qty] of Object.entries(q)) {
          if (!qty || qty <= 0) continue;
          const key = `${rec.supplier.id}|${orderNumber}|${line.product.reference}|${line.product.color}|${size}`;
          const cur = agg.get(key);
          if (cur) cur.qty += qty;
          else
            agg.set(key, {
              supplierId: rec.supplier.id,
              supplierCode: rec.supplier.code || rec.supplier.name,
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

    // Lignes du fichier, regroupées par fournisseur (le mode « fichier unique » les
    // reconcatène ensuite — le contenu total est strictement le même dans les deux modes).
    const bySupplier = new Map<string, { code: string; lines: string[] }>();
    let total = 0;
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
      const entry = bySupplier.get(a.supplierId) || { code: a.supplierCode, lines: [] };
      entry.lines.push(`${saison}${cmd}${ean13}${a.qty}`);
      bySupplier.set(a.supplierId, entry);
      total++;
    }

    const seasonLabel = season?.name || seasonId;
    // Diagnostics (non bloquants) sur les lignes écartées — lus par l'écran Export.
    const diag = {
      "X-Rows": String(total),
      "X-Files": String(perSupplier ? bySupplier.size : total > 0 ? 1 : 0),
      "X-Skipped-No-Season": String(skippedNoSeason),
      "X-Skipped-No-Ean": String(skippedNoEan),
    };

    if (!perSupplier) {
      const lines = [...bySupplier.values()].flatMap((e) => e.lines);
      lines.sort(); // tri stable → fichier reproductible
      return new NextResponse(lines.join("\r\n"), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="receptions_${seasonLabel}.csv"`,
          ...diag,
        },
      });
    }

    // Un fichier par fournisseur, dans un zip.
    const zip = new JSZip();
    const used = new Set<string>();
    for (const { code, lines } of bySupplier.values()) {
      lines.sort();
      // Nom de fichier sûr (le code fournisseur vient de l'import) et unique.
      const safe = (code || "FOURNISSEUR").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 40);
      let name = `receptions_${seasonLabel}_${safe}.csv`;
      let i = 2;
      while (used.has(name)) name = `receptions_${seasonLabel}_${safe}_${i++}.csv`;
      used.add(name);
      zip.file(name, lines.join("\r\n"));
    }
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="receptions_${seasonLabel}_par_fournisseur.zip"`,
        ...diag,
      },
    });
  } catch (e) {
    return handleApiError(e, "api/export/receptions");
  }
}

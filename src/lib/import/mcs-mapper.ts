import { prisma } from "@/lib/prisma";
import { stringifySizeQuantities, sumQuantities } from "@/lib/utils";
import { parseMcsStatgen, parseMcsPackingList } from "./mcs-format";

export interface ImportResult {
  imported: number;
  errors: string[];
}

// Recherche un produit du référentiel par (référence, code couleur), avec tolérance
// sur le zéro initial du code (la PL lit "001" comme nombre 1 ; le référentiel garde "001").
async function findProduct(reference: string, colorCode: string) {
  const candidates = new Set<string>([colorCode]);
  if (/^\d+$/.test(colorCode)) {
    candidates.add(colorCode.padStart(3, "0"));
    candidates.add(String(parseInt(colorCode, 10)));
  }
  for (const color of candidates) {
    const p = await prisma.product.findUnique({
      where: { reference_color: { reference, color } },
    });
    if (p) return p;
  }
  return null;
}

// ----------------------------------------------- Commande fournisseur (StatGen)
export async function importMcsSupplierOrders(
  buffer: ArrayBuffer,
  seasonId: string
): Promise<ImportResult> {
  const lines = parseMcsStatgen(buffer);
  const errors: string[] = [];
  let imported = 0;
  if (lines.length === 0) {
    return { imported, errors: ["Aucune ligne détectée (format commande fournisseur MCS)."] };
  }

  // groupe par numéro de commande (un fichier peut en contenir plusieurs)
  const byOrder = new Map<string, typeof lines>();
  for (const l of lines) {
    if (!byOrder.has(l.orderNumber)) byOrder.set(l.orderNumber, []);
    byOrder.get(l.orderNumber)!.push(l);
  }

  for (const [orderNumber, rows] of byOrder) {
    const supplierCode = rows[0].supplierCode || "INCONNU";
    const supplier = await prisma.supplier.upsert({
      where: { code: supplierCode },
      update: {},
      create: { code: supplierCode, name: supplierCode },
    });
    const supplierOrder = await prisma.supplierOrder.upsert({
      where: { orderNumber_seasonId: { orderNumber, seasonId } },
      update: {},
      create: { orderNumber, seasonId, supplierId: supplier.id },
    });

    const keptProductIds: string[] = [];
    for (const row of rows) {
      const product = await findProduct(row.reference, row.colorCode);
      if (!product) {
        errors.push(
          `Cmd ${orderNumber} : produit introuvable ${row.reference} / ${row.colorCode}` +
            (row.colorName ? ` (${row.colorName})` : "")
        );
        continue;
      }
      // décodage des positions Q.N → tailles via la grille du produit
      const scale = product.sizeScale
        ? product.sizeScale.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      const quantities: Record<string, number> = {};
      for (let i = 0; i < scale.length && i < row.quantities.length; i++) {
        if (row.quantities[i] > 0) quantities[scale[i]] = row.quantities[i];
      }
      if (Object.keys(quantities).length === 0) continue;

      await prisma.supplierOrderLine.upsert({
        where: {
          supplierOrderId_productId: { supplierOrderId: supplierOrder.id, productId: product.id },
        },
        update: {
          quantitiesBySize: stringifySizeQuantities(quantities),
          totalQuantity: sumQuantities(quantities),
        },
        create: {
          supplierOrderId: supplierOrder.id,
          productId: product.id,
          quantitiesBySize: stringifySizeQuantities(quantities),
          totalQuantity: sumQuantities(quantities),
        },
      });
      keptProductIds.push(product.id);
      imported++;
    }

    // purge des lignes périmées (produits absents du fichier ré-importé)
    if (keptProductIds.length > 0) {
      await prisma.supplierOrderLine.deleteMany({
        where: { supplierOrderId: supplierOrder.id, productId: { notIn: keptProductIds } },
      });
    }
  }

  return { imported, errors };
}

// ----------------------------------------------- Réception (Packing List)
export async function importMcsReceptions(
  buffer: ArrayBuffer,
  seasonId: string,
  supplierOrderNumber: string,
  receptionNumber: string
): Promise<ImportResult> {
  const errors: string[] = [];
  let imported = 0;

  const orderNum = (supplierOrderNumber || "").trim();
  if (!orderNum) return { imported, errors: ["N° de commande fournisseur requis pour la réception."] };

  const lines = parseMcsPackingList(buffer);
  if (lines.length === 0) {
    return { imported, errors: ["Aucune ligne détectée (format liste de colisage MCS)."] };
  }

  const supplierOrder = await prisma.supplierOrder.findUnique({
    where: { orderNumber_seasonId: { orderNumber: orderNum, seasonId } },
  });
  if (!supplierOrder) {
    return {
      imported,
      errors: [
        `Commande fournisseur ${orderNum} introuvable pour cette saison — importez-la d'abord.`,
      ],
    };
  }

  const reception = await prisma.supplierReception.create({
    data: {
      receptionNumber,
      supplierOrderId: supplierOrder.id,
      supplierId: supplierOrder.supplierId,
    },
  });

  for (const line of lines) {
    const product = await findProduct(line.reference, line.colorCode);
    if (!product) {
      errors.push(`Réception : produit introuvable ${line.reference} / ${line.colorCode}`);
      continue;
    }
    const quantities: Record<string, number> = {};
    for (const [size, q] of Object.entries(line.sizes)) if (q > 0) quantities[size] = q;
    if (Object.keys(quantities).length === 0) continue;

    await prisma.receptionLine.create({
      data: {
        supplierReceptionId: reception.id,
        productId: product.id,
        quantitiesBySize: stringifySizeQuantities(quantities),
        totalQuantity: sumQuantities(quantities),
      },
    });
    imported++;
  }

  await prisma.supplierOrder.update({
    where: { id: supplierOrder.id },
    data: { status: "PARTIEL" },
  });

  return { imported, errors };
}

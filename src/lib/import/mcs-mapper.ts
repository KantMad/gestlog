import { prisma } from "@/lib/prisma";
import { stringifySizeQuantities, sumQuantities } from "@/lib/utils";
import { parseMcsStatgen, parseMcsPackingList, parseMcsClientOrders } from "./mcs-format";

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
    // Cloisonnement saison : une commande fournisseur ne peut exister que sur UNE
    // saison. Si ce n° existe déjà dans une AUTRE saison, on refuse (pas de doublon
    // inter-saison) — il faut d'abord la supprimer de l'autre saison.
    const elsewhere = await prisma.supplierOrder.findFirst({
      where: { orderNumber, seasonId: { not: seasonId } },
      include: { season: { select: { name: true } } },
    });
    if (elsewhere) {
      errors.push(
        `Commande ${orderNumber} déjà présente en saison « ${elsewhere.season.name} » — une commande ne peut être que sur une saison (import ignoré pour cette commande).`
      );
      continue;
    }

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

// ----------------------------------------------- Commande client (StatGen)
// Optimisé pour les gros fichiers (milliers de lignes / centaines de commandes) :
// produits préchargés en 1 requête, écriture groupée par commande (deleteMany +
// createMany dans une transaction). Préserve les annulations (soldes) au ré-import.
export async function importMcsClientOrders(
  buffer: ArrayBuffer,
  seasonId: string
): Promise<ImportResult> {
  const lines = parseMcsClientOrders(buffer);
  const errors: string[] = [];
  let imported = 0;
  if (lines.length === 0) {
    return { imported, errors: ["Aucune ligne détectée (format commande client MCS)."] };
  }

  // Préchargement de TOUS les produits référencés (1 requête) → map (réf|couleur).
  const refs = [...new Set(lines.map((l) => l.reference))];
  const products = await prisma.product.findMany({
    where: { reference: { in: refs } },
    select: { id: true, reference: true, color: true, sizeScale: true },
  });
  const pmap = new Map<string, { id: string; sizeScale: string | null }>();
  for (const p of products) pmap.set(`${p.reference}__${p.color}`, p);
  const lookup = (ref: string, code: string) => {
    const cands = [code];
    if (/^\d+$/.test(code)) cands.push(code.padStart(3, "0"), String(parseInt(code, 10)));
    for (const c of cands) {
      const p = pmap.get(`${ref}__${c}`);
      if (p) return p;
    }
    return null;
  };

  // Upsert des clients distincts (1 fois chacun) + ClientSeason.
  const distinctClients = new Map<string, string>(); // code → nom
  for (const l of lines) {
    if (l.clientCode && !distinctClients.has(l.clientCode)) {
      distinctClients.set(l.clientCode, l.clientName || l.clientCode);
    }
  }
  const clientIdByCode = new Map<string, string>();
  for (const [code, name] of distinctClients) {
    const client = await prisma.client.upsert({
      where: { code },
      update: { name },
      create: { code, name },
    });
    clientIdByCode.set(code, client.id);
    await prisma.clientSeason.upsert({
      where: { clientId_seasonId: { clientId: client.id, seasonId } },
      update: {},
      create: { clientId: client.id, seasonId },
    });
  }

  // Groupe par commande.
  const byOrder = new Map<string, typeof lines>();
  for (const l of lines) {
    if (!byOrder.has(l.orderNumber)) byOrder.set(l.orderNumber, []);
    byOrder.get(l.orderNumber)!.push(l);
  }

  const missing = new Map<string, number>(); // combos réf/couleur introuvables (dédupliqués)

  for (const [orderNumber, rows] of byOrder) {
    const clientCode = rows[0].clientCode || "INCONNU";
    let clientId = clientIdByCode.get(clientCode);
    if (!clientId) {
      const c = await prisma.client.upsert({
        where: { code: clientCode },
        update: {},
        create: { code: clientCode, name: clientCode },
      });
      clientId = c.id;
      clientIdByCode.set(clientCode, clientId);
    }
    const clientOrder = await prisma.clientOrder.upsert({
      where: { orderNumber_seasonId: { orderNumber, seasonId } },
      update: {},
      create: { orderNumber, seasonId, clientId },
    });

    // Agrège par produit (Q.N → tailles via la grille du produit ; somme si répété).
    const byProduct = new Map<string, Record<string, number>>();
    for (const row of rows) {
      const product = lookup(row.reference, row.colorCode);
      if (!product) {
        const k = `${row.reference} / ${row.colorCode}${row.colorName ? ` (${row.colorName})` : ""}`;
        missing.set(k, (missing.get(k) || 0) + 1);
        continue;
      }
      const scale = product.sizeScale
        ? product.sizeScale.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      let acc = byProduct.get(product.id);
      if (!acc) {
        acc = {};
        byProduct.set(product.id, acc);
      }
      for (let i = 0; i < scale.length && i < row.quantities.length; i++) {
        if (row.quantities[i] > 0) acc[scale[i]] = (acc[scale[i]] || 0) + row.quantities[i];
      }
    }

    // Préserve les annulations (soldes) déjà saisies sur ces lignes (ré-import).
    const existing = await prisma.clientOrderLine.findMany({
      where: { clientOrderId: clientOrder.id },
      select: { productId: true, cancelledBySize: true, cancelledTotal: true, cancelledAt: true, cancelledBy: true },
    });
    const cancMap = new Map(existing.map((e) => [e.productId, e]));

    const data = [...byProduct.entries()]
      .filter(([, q]) => Object.keys(q).length > 0)
      .map(([productId, q]) => {
        const c = cancMap.get(productId);
        return {
          clientOrderId: clientOrder.id,
          productId,
          quantitiesBySize: stringifySizeQuantities(q),
          totalQuantity: sumQuantities(q),
          cancelledBySize: c?.cancelledBySize ?? "{}",
          cancelledTotal: c?.cancelledTotal ?? 0,
          cancelledAt: c?.cancelledAt ?? null,
          cancelledBy: c?.cancelledBy ?? null,
        };
      });

    // Remplace les lignes de la commande (idempotent) en une transaction.
    await prisma.$transaction([
      prisma.clientOrderLine.deleteMany({ where: { clientOrderId: clientOrder.id } }),
      ...(data.length ? [prisma.clientOrderLine.createMany({ data })] : []),
    ]);
    imported += data.length;
  }

  // Erreurs = produits introuvables, dédupliqués (ex. ZZZ_LOGO), avec compte.
  const miss = [...missing.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, c] of miss.slice(0, 50)) errors.push(`Produit introuvable : ${k} (${c} ligne${c > 1 ? "s" : ""})`);
  if (miss.length > 50) errors.push(`… et ${miss.length - 50} autres produits introuvables`);

  return { imported, errors };
}

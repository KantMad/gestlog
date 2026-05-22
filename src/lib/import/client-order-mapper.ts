import { prisma } from "@/lib/prisma";
import { stringifySizeQuantities, sumQuantities, parseSeasonFromCatalog } from "@/lib/utils";
import { detectSizeColumns, extractSizeQuantities, type ParsedSheet } from "./parser";

export interface ColumnMapping {
  orderNumber: string;
  clientCode: string;
  clientName: string;
  reference: string;
  color: string;
  colorCode?: string;
  catalog?: string;
  orderType?: string;
  status?: string;
  deliveryWindow?: string;
  category?: string;
  sizeTypeCode?: string;
}

export async function importClientOrders(
  sheet: ParsedSheet,
  mapping: ColumnMapping,
  seasonId: string
) {
  const sizeColumns = detectSizeColumns(sheet.headers);
  const errors: string[] = [];
  let imported = 0;

  // Pre-load size type mappings for resolving size correspondences
  const sizeTypes = await prisma.sizeType.findMany({
    include: { mappings: { orderBy: { position: "asc" } } },
  });
  const sizeTypeMap = new Map(
    sizeTypes.map((st) => [st.code, st.mappings.map((m) => m.sizeName)])
  );

  const orderGroups = new Map<string, typeof sheet.rows>();
  for (const row of sheet.rows) {
    const orderNum = String(row[mapping.orderNumber] || "").trim();
    if (!orderNum) continue;
    if (!orderGroups.has(orderNum)) orderGroups.set(orderNum, []);
    orderGroups.get(orderNum)!.push(row);
  }

  for (const [orderNumber, rows] of orderGroups) {
    try {
      const firstRow = rows[0];
      const clientCode = String(firstRow[mapping.clientCode] || "").trim();
      const clientName = String(firstRow[mapping.clientName] || clientCode).trim();

      if (!clientCode) {
        errors.push(`Commande ${orderNumber}: code client manquant`);
        continue;
      }

      const client = await prisma.client.upsert({
        where: { code: clientCode },
        update: { name: clientName },
        create: { code: clientCode, name: clientName },
      });

      await prisma.clientSeason.upsert({
        where: { clientId_seasonId: { clientId: client.id, seasonId } },
        update: {},
        create: { clientId: client.id, seasonId },
      });

      const orderType = mapping.orderType
        ? String(firstRow[mapping.orderType] || "COMMANDE").trim()
        : "COMMANDE";

      // Catalog: find or create from label
      let catalogId: string | null = null;
      if (mapping.catalog) {
        const catalogLabel = String(firstRow[mapping.catalog] || "").trim();
        if (catalogLabel) {
          let catalog = await prisma.catalog.findUnique({
            where: { name: catalogLabel },
          });
          if (!catalog) {
            try {
              catalog = await prisma.catalog.create({
                data: { name: catalogLabel, seasonId },
              });
            } catch {
              catalog = await prisma.catalog.findUnique({
                where: { name: catalogLabel },
              });
            }
          }
          catalogId = catalog?.id || null;
        }
      }

      // New fields: status & delivery window
      const status = mapping.status
        ? String(firstRow[mapping.status] || "EN_COURS").trim().toUpperCase()
        : "EN_COURS";

      const deliveryWindow = mapping.deliveryWindow
        ? String(firstRow[mapping.deliveryWindow] || "").trim() || null
        : null;

      const validStatus = ["EN_COURS", "VALIDEE", "SOLDEE", "ANNULEE"].includes(status)
        ? status
        : "EN_COURS";

      const clientOrder = await prisma.clientOrder.upsert({
        where: { orderNumber_seasonId: { orderNumber, seasonId } },
        update: {
          status: validStatus,
          deliveryWindow,
          catalogId: catalogId || undefined,
        },
        create: {
          orderNumber,
          seasonId,
          clientId: client.id,
          orderType: orderType === "VSS" ? "VSS" : "COMMANDE",
          status: validStatus,
          deliveryWindow,
          catalogId: catalogId || undefined,
        },
      });

      for (const row of rows) {
        const reference = String(row[mapping.reference] || "").trim();
        const color = String(row[mapping.color] || "").trim();
        if (!reference || !color) {
          errors.push(`Commande ${orderNumber}: référence ou couleur manquante`);
          continue;
        }

        // Category and size type code
        const category = mapping.category
          ? String(row[mapping.category] || "").trim() || null
          : null;
        const sizeTypeCode = mapping.sizeTypeCode
          ? String(row[mapping.sizeTypeCode] || "").trim() || null
          : null;

        // Extract quantities - if we have a sizeTypeCode, resolve the real size names
        let quantities = extractSizeQuantities(row, sizeColumns);
        let resolvedSizeScale = sizeColumns.join(",");

        if (sizeTypeCode && sizeTypeMap.has(sizeTypeCode)) {
          const realSizes = sizeTypeMap.get(sizeTypeCode)!;
          // Map numbered columns (1, 2, 3...) to real sizes (XS, S, M...)
          const resolvedQuantities: Record<string, number> = {};
          const sortedCols = [...sizeColumns].sort((a, b) => {
            const numA = parseInt(a);
            const numB = parseInt(b);
            if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
            return a.localeCompare(b);
          });

          for (let i = 0; i < sortedCols.length && i < realSizes.length; i++) {
            const val = row[sortedCols[i]];
            const qty = typeof val === "number" ? val : parseInt(String(val || "0"), 10);
            if (!isNaN(qty) && qty > 0) {
              resolvedQuantities[realSizes[i]] = qty;
            }
          }

          if (Object.keys(resolvedQuantities).length > 0) {
            quantities = resolvedQuantities;
            resolvedSizeScale = realSizes.join(",");
          }
        }

        if (Object.keys(quantities).length === 0) continue;

        const product = await prisma.product.upsert({
          where: { reference_color: { reference, color } },
          update: {},
          create: {
            reference,
            color,
            colorCode: mapping.colorCode ? String(row[mapping.colorCode] || "") : undefined,
            sizeScale: resolvedSizeScale,
          },
        });

        await prisma.clientOrderLine.upsert({
          where: {
            clientOrderId_productId: {
              clientOrderId: clientOrder.id,
              productId: product.id,
            },
          },
          update: {
            quantitiesBySize: stringifySizeQuantities(quantities),
            totalQuantity: sumQuantities(quantities),
            category,
            sizeTypeCode,
          },
          create: {
            clientOrderId: clientOrder.id,
            productId: product.id,
            quantitiesBySize: stringifySizeQuantities(quantities),
            totalQuantity: sumQuantities(quantities),
            category,
            sizeTypeCode,
          },
        });

        imported++;
      }
    } catch (e) {
      errors.push(`Commande ${orderNumber}: ${String(e)}`);
    }
  }

  return { imported, errors };
}

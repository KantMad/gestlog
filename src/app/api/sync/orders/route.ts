import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseSeasonFromCatalog } from "@/lib/utils";

// Allow up to 60s for sync operations
export const maxDuration = 60;

// POST — Receive client orders from n8n
// Expects JSON array of orders with their lines
export async function POST(request: NextRequest) {
  try {
    // Simple API key auth
    const authHeader = request.headers.get("x-api-key");
    if (authHeader !== process.env.SYNC_API_KEY) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const body = await request.json();
    const orders = Array.isArray(body) ? body : body.orders || [body];

    const errors: string[] = [];
    let imported = 0;

    // Cache for seasons and catalogs to avoid repeated DB queries
    const seasonCache = new Map<string, { id: string }>();
    const catalogCache = new Map<string, { id: string }>();

    for (const order of orders) {
      try {
        const {
          orderNumber,
          clientCode,
          clientName,
          clientEmail,
          seasonName, // catalog label from B2B (e.g. "MCS Homme W26")
          status,
          deliveryWindowStart,
          deliveryWindowEnd,
          orderType,
          lines,
        } = order;

        if (!orderNumber || !seasonName) {
          errors.push(`Commande ${orderNumber || "?"}: donnees manquantes (orderNumber ou seasonName)`);
          continue;
        }

        // Use clientCode or derive from orderNumber if missing
        const effectiveClientCode = clientCode || `UNKNOWN_${orderNumber}`;
        const effectiveClientName = clientName || effectiveClientCode;

        // Parse season from catalog label (W26 → AH 2026, S26 → PE 2026, H26 → AH 2026)
        const parsed = parseSeasonFromCatalog(seasonName);
        const seasonType = parsed?.type || "AH";
        const seasonYear = parsed?.year || new Date().getFullYear();
        const canonicalName = parsed?.canonicalName || `AH${String(seasonYear).slice(-2)}`;
        const seasonKey = `${seasonYear}_${seasonType}`;

        // Find or auto-create season (cached)
        let season = seasonCache.get(seasonKey) || null;
        if (!season) {
          let dbSeason = await prisma.season.findFirst({
            where: { year: seasonYear, type: seasonType },
          });
          if (!dbSeason) {
            try {
              dbSeason = await prisma.season.create({
                data: { name: canonicalName, year: seasonYear, type: seasonType, isActive: true },
              });
            } catch {
              dbSeason = await prisma.season.findFirst({
                where: { year: seasonYear, type: seasonType },
              });
              if (!dbSeason) {
                errors.push(`Commande ${orderNumber}: saison "${seasonName}" impossible a creer`);
                continue;
              }
            }
          }
          season = { id: dbSeason.id };
          seasonCache.set(seasonKey, season);
        }

        // Find or auto-create catalog (cached)
        const catalogName = String(seasonName).trim();
        let catalog = catalogCache.get(catalogName) || null;
        if (!catalog) {
          let dbCatalog = await prisma.catalog.findUnique({
            where: { name: catalogName },
          });
          if (!dbCatalog) {
            try {
              dbCatalog = await prisma.catalog.create({
                data: { name: catalogName, seasonId: season.id },
              });
            } catch {
              dbCatalog = await prisma.catalog.findUnique({
                where: { name: catalogName },
              });
            }
          }
          if (dbCatalog) {
            catalog = { id: dbCatalog.id };
            catalogCache.set(catalogName, catalog);
          }
        }

        // Upsert client
        const client = await prisma.client.upsert({
          where: { code: effectiveClientCode },
          update: { name: effectiveClientName, email: clientEmail || undefined },
          create: { code: effectiveClientCode, name: effectiveClientName, email: clientEmail || undefined },
        });

        // Upsert client season
        await prisma.clientSeason.upsert({
          where: { clientId_seasonId: { clientId: client.id, seasonId: season.id } },
          update: {},
          create: { clientId: client.id, seasonId: season.id },
        });

        // Build delivery window string
        const deliveryWindow = deliveryWindowStart && deliveryWindowEnd
          ? `${deliveryWindowStart} - ${deliveryWindowEnd}`
          : deliveryWindowStart || deliveryWindowEnd || null;

        // Map status
        const statusMap: Record<string, string> = {
          "Confirmer": "VALIDEE",
          "Confirmed": "VALIDEE",
          "En cours": "EN_COURS",
          "Pending": "EN_COURS",
          "Solder": "SOLDEE",
          "Annuler": "ANNULEE",
          "Cancelled": "ANNULEE",
        };
        const mappedStatus = statusMap[status] || "EN_COURS";

        // Upsert order with catalog
        const clientOrder = await prisma.clientOrder.upsert({
          where: { orderNumber_seasonId: { orderNumber: String(orderNumber), seasonId: season.id } },
          update: {
            status: mappedStatus,
            deliveryWindow,
            orderType: orderType === "VSS" ? "VSS" : "COMMANDE",
            catalogId: catalog?.id || undefined,
          },
          create: {
            orderNumber: String(orderNumber),
            seasonId: season.id,
            clientId: client.id,
            catalogId: catalog?.id || undefined,
            status: mappedStatus,
            deliveryWindow,
            orderType: orderType === "VSS" ? "VSS" : "COMMANDE",
          },
        });

        // Process lines
        if (Array.isArray(lines)) {
          for (const line of lines) {
            const { reference, color, colorLabel, quantities, category, sizeTypeCode } = line;
            if (!reference || !color) continue;

            const sizeScale = quantities ? Object.keys(quantities).join(",") : "";

            const product = await prisma.product.upsert({
              where: { reference_color: { reference: String(reference), color: String(color) } },
              update: {},
              create: {
                reference: String(reference),
                color: String(color),
                colorCode: colorLabel || undefined,
                sizeScale,
              },
            });

            const quantitiesBySize = quantities ? JSON.stringify(quantities) : "{}";
            const totalQuantity = quantities
              ? Object.values(quantities as Record<string, number>).reduce((s, v) => s + (Number(v) || 0), 0)
              : 0;

            await prisma.clientOrderLine.upsert({
              where: {
                clientOrderId_productId: {
                  clientOrderId: clientOrder.id,
                  productId: product.id,
                },
              },
              update: { quantitiesBySize, totalQuantity, category: category || null, sizeTypeCode: sizeTypeCode || null },
              create: {
                clientOrderId: clientOrder.id,
                productId: product.id,
                quantitiesBySize,
                totalQuantity,
                category: category || null,
                sizeTypeCode: sizeTypeCode || null,
              },
            });
          }
        }

        imported++;
      } catch (e) {
        errors.push(`Commande ${order.orderNumber || "?"}: ${String(e)}`);
      }
    }

    return NextResponse.json({
      success: true,
      data: { imported, errors, total: orders.length },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur sync: ${String(e)}` },
      { status: 500 }
    );
  }
}

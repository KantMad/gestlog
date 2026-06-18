import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
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
    let removed = 0; // commandes annulées/supprimées dans TIO, retirées de gestlog

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
          orderDate,    // date_crea TIO (date de commande) — ISO ou "YYYY-MM-DD HH:mm:ss"
          totalAmount,  // total_price TIO (CA net de la commande)
          deleted,      // true = commande annulée/supprimée dans TIO → à retirer de gestlog
          lines,
        } = order;

        // Auto-nettoyage : une commande annulée/supprimée dans TIO est retirée de
        // gestlog (cascade sur ses lignes) → pas de quantités/CA fantômes.
        if (deleted) {
          if (orderNumber) {
            const r = await prisma.clientOrder.deleteMany({ where: { orderNumber: String(orderNumber) } });
            if (r.count > 0) removed += r.count;
          }
          continue;
        }

        // Date de commande (date_crea) — parsée si fournie et valide.
        const parsedOrderDate = (() => {
          if (!orderDate) return null;
          const d = new Date(String(orderDate).replace(" ", "T"));
          return isNaN(d.getTime()) ? null : d;
        })();
        const orderAmount =
          totalAmount != null && !isNaN(Number(totalAmount)) ? Number(totalAmount) : null;

        if (!orderNumber || !seasonName) {
          errors.push(`Commande ${orderNumber || "?"}: donnees manquantes (orderNumber ou seasonName)`);
          continue;
        }

        // Use clientCode or derive from orderNumber if missing
        const effectiveClientCode = clientCode || `UNKNOWN_${orderNumber}`;
        const effectiveClientName = clientName || effectiveClientCode;

        // Les catalogues réassort (Réassort, Réassort hiver, Réassort femme) sont
        // regroupés dans UNE saison dédiée "Réassort" (sentinelle year=0/type=REASSORT),
        // indépendamment de l'année. Sinon, parse normal (W26 → AH 2026, S26 → PE 2026).
        const isReassort = /r[ée]assort/i.test(String(seasonName));
        const parsed = isReassort ? null : parseSeasonFromCatalog(seasonName);
        const seasonType = isReassort ? "REASSORT" : parsed?.type || "AH";
        const seasonYear = isReassort ? 0 : parsed?.year || new Date().getFullYear();
        const canonicalName = isReassort
          ? "Réassort"
          : parsed?.canonicalName || `AH${String(seasonYear).slice(-2)}`;
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
            tioOrderNumber: String(orderNumber),
            ...(parsedOrderDate ? { orderDate: parsedOrderDate } : {}),
            ...(orderAmount != null ? { totalAmount: orderAmount } : {}),
          },
          create: {
            orderNumber: String(orderNumber),
            seasonId: season.id,
            clientId: client.id,
            catalogId: catalog?.id || undefined,
            status: mappedStatus,
            deliveryWindow,
            orderType: orderType === "VSS" ? "VSS" : "COMMANDE",
            tioOrderNumber: String(orderNumber),
            orderDate: parsedOrderDate,
            totalAmount: orderAmount,
          },
        });

        // Process lines
        if (Array.isArray(lines)) {
          const keptProductIds: string[] = []; // produits présents dans la commande ACTUELLE
          for (const line of lines) {
            const { reference, color, colorLabel, quantities, category, sizeTypeCode, externalId, amount } = line;
            const lineAmount = amount != null && !isNaN(Number(amount)) ? Number(amount) : 0;

            let product = null;

            // Strategy 1: resolve by externalId (B2B product_id_color_id)
            if (externalId) {
              product = await prisma.product.findUnique({
                where: { externalId: String(externalId) },
              });
            }

            // Strategy 2: resolve by reference + color (fallback or direct import)
            if (!product && reference && color) {
              const sizeScale = quantities ? Object.keys(quantities).join(",") : "";
              product = await prisma.product.upsert({
                where: { reference_color: { reference: String(reference), color: String(color) } },
                update: {},
                create: {
                  reference: String(reference),
                  color: String(color),
                  colorCode: colorLabel || undefined,
                  sizeScale,
                },
              });
            }

            if (!product) {
              errors.push(`Commande ${orderNumber}, ligne externalId=${externalId || "?"} ref=${reference || "?"}: produit introuvable`);
              continue;
            }

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
              update: { quantitiesBySize, totalQuantity, amount: lineAmount, category: category || null, sizeTypeCode: sizeTypeCode || null },
              create: {
                clientOrderId: clientOrder.id,
                productId: product.id,
                quantitiesBySize,
                totalQuantity,
                amount: lineAmount,
                category: category || null,
                sizeTypeCode: sizeTypeCode || null,
              },
            });
            keptProductIds.push(product.id);
          }

          // Supprime les lignes PÉRIMÉES : produits présents en base mais plus dans la
          // commande TIO actuelle (commande rééditée → lignes retirées/mises à 0).
          // Sans ça, le sync upsert n'efface jamais ces lignes → sur-comptage des quantités.
          // Garde-fou : si AUCUNE ligne n'a résolu (lines>0 mais produits non synchronisés),
          // on ne touche à rien — on évite d'effacer des données sur un sync incomplet.
          if (keptProductIds.length > 0) {
            await prisma.clientOrderLine.deleteMany({
              where: { clientOrderId: clientOrder.id, productId: { notIn: keptProductIds } },
            });
          } else if (lines.length === 0) {
            // commande réellement vidée dans TIO
            await prisma.clientOrderLine.deleteMany({ where: { clientOrderId: clientOrder.id } });
          }
        }

        imported++;
      } catch (e) {
        errors.push(`Commande ${order.orderNumber || "?"}: ${String(e)}`);
      }
    }

    return NextResponse.json({
      success: true,
      data: { imported, removed, errors, total: orders.length },
    });
  } catch (e) {
    return handleApiError(e, "api/sync/orders");
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Allow up to 60s for sync operations
export const maxDuration = 60;

// Generate a cuid-like ID
function genId() {
  return `sync_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// POST — Receive products + EANs from n8n (batched)
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("x-api-key");
    if (authHeader !== process.env.SYNC_API_KEY) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const body = await request.json();
    const products = Array.isArray(body) ? body : body.products || [body];

    const errors: string[] = [];
    let imported = 0;

    for (const prod of products) {
      try {
        const {
          reference,
          color,
          colorCode,
          sizeTypeCode,
          variations,
        } = prod;

        if (!reference) {
          errors.push("Produit ignore: reference manquante");
          continue;
        }

        const colorStr = color || "UNIQUE";
        const sizeScale = variations
          ? (variations as { size: string }[]).map((v) => v.size).join(",")
          : "";
        const extId = prod.externalId ? String(prod.externalId) : null;

        // Raw SQL upsert — bypasses PrismaPg adapter bug
        await prisma.$executeRawUnsafe(
          `INSERT INTO "Product" (id, reference, color, "colorCode", "sizeScale", "externalId", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
           ON CONFLICT (reference, color)
           DO UPDATE SET
             "colorCode" = COALESCE(NULLIF($4, ''), "Product"."colorCode"),
             "sizeScale" = COALESCE(NULLIF($5, ''), "Product"."sizeScale"),
             "externalId" = COALESCE($6, "Product"."externalId"),
             "updatedAt" = NOW()`,
          genId(),
          String(reference),
          colorStr,
          colorCode || null,
          sizeScale || null,
          extId
        );

        // Upsert EAN entries via raw SQL
        if (Array.isArray(variations)) {
          for (const v of variations) {
            if (v.ean && v.size) {
              try {
                await prisma.$executeRawUnsafe(
                  `INSERT INTO "ProductSizeEan" (id, reference, color, size, ean)
                   VALUES ($1, $2, $3, $4, $5)
                   ON CONFLICT (ean)
                   DO UPDATE SET reference = $2, color = $3, size = $4`,
                  genId(),
                  String(reference),
                  colorStr,
                  String(v.size),
                  String(v.ean)
                );
              } catch {
                // Constraint error — skip
              }
            }
          }
        }

        // Save stock from variations (if stock data present)
        if (Array.isArray(variations)) {
          const stockBySize: Record<string, number> = {};
          let hasStock = false;
          for (const v of variations) {
            if (v.size && v.stock !== undefined && v.stock !== null) {
              const qty = Number(v.stock) || 0;
              stockBySize[String(v.size)] = qty;
              hasStock = true;
            }
          }
          if (hasStock) {
            // Find productId
            const prodRows = await prisma.$queryRawUnsafe<{ id: string }[]>(
              `SELECT id FROM "Product" WHERE reference = $1 AND color = $2 LIMIT 1`,
              String(reference),
              colorStr
            );
            if (prodRows.length > 0) {
              const pid = prodRows[0].id;
              const totalStock = Object.values(stockBySize).reduce((s, v) => s + v, 0);
              // Replace stock entry
              await prisma.$executeRawUnsafe(
                `DELETE FROM "StockEntry" WHERE "productId" = $1`,
                pid
              );
              await prisma.$executeRawUnsafe(
                `INSERT INTO "StockEntry" (id, "productId", "quantitiesBySize", "totalQuantity", "importDate", "createdAt")
                 VALUES ($1, $2, $3, $4, NOW(), NOW())`,
                genId(),
                pid,
                JSON.stringify(stockBySize),
                totalStock
              );
            }
          }
        }

        // Upsert size type + mappings via raw SQL
        if (sizeTypeCode && Array.isArray(variations) && variations.length > 0) {
          try {
            const stId = genId();
            await prisma.$executeRawUnsafe(
              `INSERT INTO "SizeType" (id, code, "createdAt", "updatedAt")
               VALUES ($1, $2, NOW(), NOW())
               ON CONFLICT (code) DO NOTHING`,
              stId,
              String(sizeTypeCode)
            );

            // Get the actual sizeType id
            const stRows = await prisma.$queryRawUnsafe<{ id: string }[]>(
              `SELECT id FROM "SizeType" WHERE code = $1`,
              String(sizeTypeCode)
            );

            if (stRows.length > 0) {
              const sizeTypeId = stRows[0].id;
              for (let i = 0; i < variations.length; i++) {
                const v = variations[i];
                if (v.size) {
                  try {
                    await prisma.$executeRawUnsafe(
                      `INSERT INTO "SizeTypeMapping" (id, "sizeTypeId", position, "sizeName")
                       VALUES ($1, $2, $3, $4)
                       ON CONFLICT ("sizeTypeId", position)
                       DO UPDATE SET "sizeName" = $4`,
                      genId(),
                      sizeTypeId,
                      i + 1,
                      String(v.size)
                    );
                  } catch {
                    // Duplicate sizeName — skip
                  }
                }
              }
            }
          } catch {
            // SizeType error — non-blocking
          }
        }

        imported++;
      } catch (e) {
        errors.push(`Produit ${prod.reference || "?"}: ${String(e)}`);
      }
    }

    return NextResponse.json({
      success: true,
      data: { imported, errors, total: products.length },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur sync: ${String(e)}` },
      { status: 500 }
    );
  }
}

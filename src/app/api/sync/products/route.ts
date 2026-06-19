import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
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
          category,
          subCategory,
          label,      // désignation (label_fr)
          salePrice,  // prix de vente public (retail, catalogue 209)
          costPrice,  // prix de gros / coût
          variations,
        } = prod;
        const saleP = salePrice != null && !isNaN(Number(salePrice)) ? Number(salePrice) : null;
        const costP = costPrice != null && !isNaN(Number(costPrice)) ? Number(costPrice) : null;

        if (!reference) {
          errors.push("Produit ignore: reference manquante");
          continue;
        }

        const colorStr = color || "UNIQUE";
        const sizeScale = variations
          ? (variations as { size: string }[]).map((v) => v.size).join(",")
          : "";
        const extId = prod.externalId ? String(prod.externalId) : null;

        // 1) Upsert Product (RETURNING id → évite un SELECT plus loin)
        const prodUpsert = await prisma.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO "Product" (id, reference, color, "colorCode", "sizeScale", "externalId", category, "subCategory", label, "salePrice", "costPrice", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
           ON CONFLICT (reference, color)
           DO UPDATE SET
             "colorCode" = COALESCE(NULLIF($4, ''), "Product"."colorCode"),
             "sizeScale" = COALESCE(NULLIF($5, ''), "Product"."sizeScale"),
             "externalId" = COALESCE($6, "Product"."externalId"),
             category = COALESCE(NULLIF($7, ''), "Product".category),
             "subCategory" = COALESCE(NULLIF($8, ''), "Product"."subCategory"),
             label = COALESCE(NULLIF($9, ''), "Product".label),
             "salePrice" = COALESCE($10, "Product"."salePrice"),
             "costPrice" = COALESCE($11, "Product"."costPrice"),
             "updatedAt" = NOW()
           RETURNING id`,
          genId(),
          String(reference),
          colorStr,
          colorCode || null,
          sizeScale || null,
          extId,
          category || null,
          subCategory || null,
          label || null,
          saleP,
          costP
        );
        const pid = prodUpsert[0]?.id;

        const vars: { size?: string; ean?: string; stock?: unknown }[] = Array.isArray(variations)
          ? variations
          : [];

        // 2) EANs — un seul INSERT multi-row (dédoublonné par ean pour éviter
        //    l'erreur "ON CONFLICT cannot affect row a second time").
        const eanByEan = new Map<string, [string, string, string, string, string]>();
        for (const v of vars) {
          if (v.ean && v.size) {
            eanByEan.set(String(v.ean), [
              genId(),
              String(reference),
              colorStr,
              String(v.size),
              String(v.ean),
            ]);
          }
        }
        if (eanByEan.size > 0) {
          const flat: unknown[] = [];
          const tuples = [...eanByEan.values()].map((vals) => {
            const ph = vals.map((x) => {
              flat.push(x);
              return `$${flat.length}`;
            });
            return `(${ph.join(",")})`;
          });
          await prisma.$executeRawUnsafe(
            `INSERT INTO "ProductSizeEan" (id, reference, color, size, ean) VALUES ${tuples.join(",")}
             ON CONFLICT (ean) DO UPDATE SET reference = EXCLUDED.reference, color = EXCLUDED.color, size = EXCLUDED.size`,
            ...flat
          );
        }

        // 3) Stock — DELETE + INSERT (replace), via le pid retourné (plus de SELECT)
        if (pid) {
          const stockBySize: Record<string, number> = {};
          let hasStock = false;
          for (const v of vars) {
            if (v.size && v.stock !== undefined && v.stock !== null) {
              stockBySize[String(v.size)] = Number(v.stock) || 0;
              hasStock = true;
            }
          }
          if (hasStock) {
            const totalStock = Object.values(stockBySize).reduce((s, v) => s + v, 0);
            await prisma.$executeRawUnsafe(`DELETE FROM "StockEntry" WHERE "productId" = $1`, pid);
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

        // 4) SizeType + mappings — upsert RETURNING id puis mappings en bulk
        if (sizeTypeCode && vars.length > 0) {
          try {
            const stUpsert = await prisma.$queryRawUnsafe<{ id: string }[]>(
              `INSERT INTO "SizeType" (id, code, "createdAt", "updatedAt")
               VALUES ($1, $2, NOW(), NOW())
               ON CONFLICT (code) DO UPDATE SET "updatedAt" = NOW()
               RETURNING id`,
              genId(),
              String(sizeTypeCode)
            );
            const sizeTypeId = stUpsert[0]?.id;
            if (sizeTypeId) {
              const mapRows: [string, string, number, string][] = [];
              for (let i = 0; i < vars.length; i++) {
                if (vars[i].size) {
                  mapRows.push([genId(), sizeTypeId, i + 1, String(vars[i].size)]);
                }
              }
              if (mapRows.length > 0) {
                const flat: unknown[] = [];
                const tuples = mapRows.map((vals) => {
                  const ph = vals.map((x) => {
                    flat.push(x);
                    return `$${flat.length}`;
                  });
                  return `(${ph.join(",")})`;
                });
                await prisma.$executeRawUnsafe(
                  `INSERT INTO "SizeTypeMapping" (id, "sizeTypeId", position, "sizeName") VALUES ${tuples.join(",")}
                   ON CONFLICT ("sizeTypeId", position) DO UPDATE SET "sizeName" = EXCLUDED."sizeName"`,
                  ...flat
                );
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
    return handleApiError(e, "api/sync/products");
  }
}

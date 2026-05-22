import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Allow up to 60s for sync operations
export const maxDuration = 60;

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

    // Process products WITHOUT interactive transaction (PrismaPg adapter bug)
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

        // Build externalId from B2B IDs (product_id + color_id)
        const extId = prod.externalId ? String(prod.externalId) : undefined;

        // Always upsert by reference+color (products may already exist from orders sync)
        // Set externalId in both update and create
        await prisma.product.upsert({
          where: { reference_color: { reference: String(reference), color: colorStr } },
          update: {
            colorCode: colorCode || undefined,
            sizeScale: sizeScale || undefined,
            ...(extId ? { externalId: extId } : {}),
          },
          create: {
            reference: String(reference),
            color: colorStr,
            colorCode: colorCode || undefined,
            sizeScale,
            ...(extId ? { externalId: extId } : {}),
          },
        });

        // Upsert EAN entries
        if (Array.isArray(variations)) {
          for (const v of variations) {
            if (v.ean && v.size) {
              try {
                await prisma.productSizeEan.upsert({
                  where: { ean: String(v.ean) },
                  update: { reference: String(reference), color: colorStr, size: String(v.size) },
                  create: { reference: String(reference), color: colorStr, size: String(v.size), ean: String(v.ean) },
                });
              } catch {
                // Duplicate — skip
              }
            }
          }
        }

        // Upsert size type mappings
        if (sizeTypeCode && Array.isArray(variations) && variations.length > 0) {
          try {
            const sizeType = await prisma.sizeType.upsert({
              where: { code: String(sizeTypeCode) },
              update: {},
              create: { code: String(sizeTypeCode) },
            });

            for (let i = 0; i < variations.length; i++) {
              const v = variations[i];
              if (v.size) {
                try {
                  await prisma.sizeTypeMapping.upsert({
                    where: { sizeTypeId_position: { sizeTypeId: sizeType.id, position: i + 1 } },
                    update: { sizeName: String(v.size) },
                    create: { sizeTypeId: sizeType.id, position: i + 1, sizeName: String(v.size) },
                  });
                } catch {
                  // Duplicate — skip
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

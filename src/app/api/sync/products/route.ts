import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST — Receive products + EANs from n8n
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
          reference, // sku from lng_product
          label,
          color,     // color label
          colorCode, // color code/id
          sizeTypeCode,
          variations, // array of { size, ean, stock }
        } = prod;

        if (!reference) {
          errors.push("Produit ignore: reference manquante");
          continue;
        }

        const colorStr = color || "UNIQUE";
        const sizeScale = variations
          ? (variations as { size: string }[]).map((v) => v.size).join(",")
          : "";

        // Upsert product
        await prisma.product.upsert({
          where: { reference_color: { reference: String(reference), color: colorStr } },
          update: {
            colorCode: colorCode || undefined,
            sizeScale: sizeScale || undefined,
          },
          create: {
            reference: String(reference),
            color: colorStr,
            colorCode: colorCode || undefined,
            sizeScale,
          },
        });

        // Upsert EANs
        if (Array.isArray(variations)) {
          for (const v of variations) {
            if (v.ean && v.size) {
              try {
                await prisma.productSizeEan.upsert({
                  where: {
                    reference_color_size: {
                      reference: String(reference),
                      color: colorStr,
                      size: String(v.size),
                    },
                  },
                  update: { ean: String(v.ean) },
                  create: {
                    reference: String(reference),
                    color: colorStr,
                    size: String(v.size),
                    ean: String(v.ean),
                  },
                });
              } catch {
                // EAN duplicate — skip silently
              }
            }
          }
        }

        // Upsert size type if provided
        if (sizeTypeCode && Array.isArray(variations) && variations.length > 0) {
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
                  where: {
                    sizeTypeId_position: {
                      sizeTypeId: sizeType.id,
                      position: i + 1,
                    },
                  },
                  update: { sizeName: String(v.size) },
                  create: {
                    sizeTypeId: sizeType.id,
                    position: i + 1,
                    sizeName: String(v.size),
                  },
                });
              } catch {
                // Duplicate size name — skip
              }
            }
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

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

        // Upsert product by reference+color — use findUnique + update/create
        // to avoid PrismaPg adapter issues with upsert
        const existing = await prisma.product.findUnique({
          where: { reference_color: { reference: String(reference), color: colorStr } },
        });

        if (existing) {
          await prisma.product.update({
            where: { id: existing.id },
            data: {
              colorCode: colorCode || existing.colorCode,
              sizeScale: sizeScale || existing.sizeScale,
              externalId: extId || existing.externalId,
            },
          });
        } else {
          await prisma.product.create({
            data: {
              reference: String(reference),
              color: colorStr,
              colorCode: colorCode || null,
              sizeScale: sizeScale || "",
              externalId: extId,
            },
          });
        }

        // Upsert EAN entries — use findUnique + update/create
        if (Array.isArray(variations)) {
          for (const v of variations) {
            if (v.ean && v.size) {
              try {
                const existingEan = await prisma.productSizeEan.findUnique({
                  where: { ean: String(v.ean) },
                });

                if (existingEan) {
                  await prisma.productSizeEan.update({
                    where: { id: existingEan.id },
                    data: {
                      reference: String(reference),
                      color: colorStr,
                      size: String(v.size),
                    },
                  });
                } else {
                  await prisma.productSizeEan.create({
                    data: {
                      reference: String(reference),
                      color: colorStr,
                      size: String(v.size),
                      ean: String(v.ean),
                    },
                  });
                }
              } catch {
                // Duplicate or constraint error — skip
              }
            }
          }
        }

        // Upsert size type mappings
        if (sizeTypeCode && Array.isArray(variations) && variations.length > 0) {
          try {
            let sizeType = await prisma.sizeType.findUnique({
              where: { code: String(sizeTypeCode) },
            });

            if (!sizeType) {
              sizeType = await prisma.sizeType.create({
                data: { code: String(sizeTypeCode) },
              });
            }

            for (let i = 0; i < variations.length; i++) {
              const v = variations[i];
              if (v.size) {
                try {
                  const existingMapping = await prisma.sizeTypeMapping.findUnique({
                    where: { sizeTypeId_position: { sizeTypeId: sizeType.id, position: i + 1 } },
                  });

                  if (existingMapping) {
                    if (existingMapping.sizeName !== String(v.size)) {
                      await prisma.sizeTypeMapping.update({
                        where: { id: existingMapping.id },
                        data: { sizeName: String(v.size) },
                      });
                    }
                  } else {
                    await prisma.sizeTypeMapping.create({
                      data: { sizeTypeId: sizeType.id, position: i + 1, sizeName: String(v.size) },
                    });
                  }
                } catch {
                  // Duplicate sizeName for this type — skip
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
      version: "v3-findunique",
      data: { imported, errors, total: products.length },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur sync: ${String(e)}` },
      { status: 500 }
    );
  }
}

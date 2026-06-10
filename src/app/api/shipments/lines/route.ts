import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET — Lignes d'un document entrepôt, avec drapeaux de matching outil
// (référence connue dans Product, EAN connu dans ProductSizeEan).
export async function GET(request: NextRequest) {
  try {
    const documentId = request.nextUrl.searchParams.get("documentId");
    if (!documentId) {
      return NextResponse.json({ error: "documentId requis" }, { status: 400 });
    }

    const lines = await prisma.$queryRawUnsafe<
      {
        id: string;
        lineNo: string | null;
        reference: string | null;
        productLabel: string | null;
        colorCode: string | null;
        colorLabel: string | null;
        size: string | null;
        ean: string | null;
        quantity: number;
        parcelNo: string | null;
        refKnown: boolean;
        eanKnown: boolean;
      }[]
    >(
      `SELECT l.id, l."lineNo", l.reference, l."productLabel", l."colorCode",
              l."colorLabel", l.size, l.ean, l.quantity, l."parcelNo",
              EXISTS (SELECT 1 FROM "Product" p WHERE p.reference = l.reference) AS "refKnown",
              EXISTS (SELECT 1 FROM "ProductSizeEan" e WHERE e.ean = l.ean) AS "eanKnown"
       FROM "WarehouseDocumentLine" l
       WHERE l."documentId" = $1
       ORDER BY NULLIF(l."lineNo", '')::int NULLS LAST, l.reference`,
      documentId
    );

    return NextResponse.json({ lines });
  } catch (e) {
    return NextResponse.json({ error: `Erreur: ${String(e)}` }, { status: 500 });
  }
}

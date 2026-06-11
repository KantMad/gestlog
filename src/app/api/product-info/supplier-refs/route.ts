import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parseExcelBuffer } from "@/lib/import/parser";

// GET — list all supplier-product ref mappings
export async function GET() {
  try {
    const refs = await prisma.supplierProductRef.findMany({
      include: { supplier: { select: { code: true, name: true } } },
      orderBy: { reference: "asc" },
    });
    return NextResponse.json({ data: refs });
  } catch (e) {
    return handleApiError(e, "api/product-info/supplier-refs");
  }
}

// POST — import supplier ↔ reference mapping from CSV/Excel
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const mappingJson = formData.get("mapping") as string | null;

    if (!file) {
      return NextResponse.json({ error: "Fichier requis" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const sheets = parseExcelBuffer(buffer);
    if (sheets.length === 0 || sheets[0].rows.length === 0) {
      return NextResponse.json(
        { error: "Fichier vide ou format invalide" },
        { status: 400 }
      );
    }

    const sheet = sheets[0];
    const mapping = mappingJson ? JSON.parse(mappingJson) : {};

    const errors: string[] = [];
    let imported = 0;

    for (const row of sheet.rows) {
      const supplierCode = String(row[mapping.supplierCode] || "").trim();
      const supplierName = String(row[mapping.supplierName] || supplierCode).trim();
      const reference = String(row[mapping.reference] || "").trim();

      if (!supplierCode || !reference) {
        errors.push(`Ligne ignorée: code fournisseur ou référence manquant`);
        continue;
      }

      try {
        // Upsert supplier
        const supplier = await prisma.supplier.upsert({
          where: { code: supplierCode },
          update: { name: supplierName },
          create: { code: supplierCode, name: supplierName },
        });

        // Upsert the mapping
        await prisma.supplierProductRef.upsert({
          where: {
            supplierId_reference: {
              supplierId: supplier.id,
              reference,
            },
          },
          update: {},
          create: {
            supplierId: supplier.id,
            reference,
          },
        });
        imported++;
      } catch (e) {
        errors.push(`${supplierCode}/${reference}: ${String(e)}`);
      }
    }

    const seasonId = formData.get("seasonId") as string | null;
    if (seasonId) {
      await prisma.importLog.create({
        data: {
          seasonId,
          importType: "SUPPLIER_REF",
          fileName: file.name,
          rowCount: imported,
          errorCount: errors.length,
          errors: errors.length > 0 ? JSON.stringify(errors) : null,
        },
      });
    }

    return NextResponse.json({
      data: { imported, errors },
    });
  } catch (e) {
    return handleApiError(e, "api/product-info/supplier-refs");
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseExcelBuffer, detectSizeColumns, extractSizeQuantities } from "@/lib/import/parser";
import { stringifySizeQuantities, sumQuantities } from "@/lib/utils";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const seasonId = formData.get("seasonId") as string | null;
    const mappingJson = formData.get("mapping") as string | null;

    if (!file || !seasonId || !mappingJson) {
      return NextResponse.json(
        { error: "Fichier, saison et mapping requis" },
        { status: 400 }
      );
    }

    const mapping = JSON.parse(mappingJson);
    const buffer = await file.arrayBuffer();
    const sheets = parseExcelBuffer(buffer);

    if (sheets.length === 0 || sheets[0].rows.length === 0) {
      return NextResponse.json(
        { error: "Fichier vide ou format invalide" },
        { status: 400 }
      );
    }

    const sheet = sheets[0];
    const sizeColumns = detectSizeColumns(sheet.headers);
    const errors: string[] = [];
    let imported = 0;

    for (const row of sheet.rows) {
      const reference = String(row[mapping.reference] || "").trim();
      const color = String(row[mapping.color] || "").trim();
      if (!reference || !color) {
        errors.push(`Ligne ignorée: référence ou couleur manquante`);
        continue;
      }

      const quantities = extractSizeQuantities(row, sizeColumns);
      if (Object.keys(quantities).length === 0) continue;

      const product = await prisma.product.upsert({
        where: { reference_color: { reference, color } },
        update: {},
        create: {
          reference,
          color,
          sizeScale: sizeColumns.join(","),
        },
      });

      await prisma.stockEntry.create({
        data: {
          productId: product.id,
          quantitiesBySize: stringifySizeQuantities(quantities),
          totalQuantity: sumQuantities(quantities),
        },
      });

      imported++;
    }

    await prisma.importLog.create({
      data: {
        seasonId,
        importType: "STOCK",
        fileName: file.name,
        rowCount: imported,
        errorCount: errors.length,
        errors: errors.length > 0 ? JSON.stringify(errors) : null,
      },
    });

    return NextResponse.json({
      data: { imported, errors, fileName: file.name },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur d'import: ${String(e)}` },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseExcelBuffer } from "@/lib/import/parser";

// GET — list all size types
export async function GET() {
  try {
    const sizeTypes = await prisma.sizeType.findMany({
      orderBy: { code: "asc" },
    });
    return NextResponse.json({
      data: sizeTypes.map((st) => ({
        ...st,
        sizes: JSON.parse(st.sizes),
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur: ${String(e)}` },
      { status: 500 }
    );
  }
}

// POST — import size types from CSV/Excel
// Expected columns: code (type de taille), label (optionnel), then size columns (1, 2, 3... or named)
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
    const codeCol = mapping.code || "code";
    const labelCol = mapping.label || "label";

    // All columns that are not code/label are size columns (in order)
    const sizeColumns = sheet.headers.filter(
      (h) => h !== codeCol && h !== labelCol
    );

    const errors: string[] = [];
    let imported = 0;

    for (const row of sheet.rows) {
      const code = String(row[codeCol] || "").trim();
      if (!code) {
        errors.push(`Ligne ignorée: code de type de taille manquant`);
        continue;
      }

      const label = String(row[labelCol] || "").trim() || null;

      // Collect size names from column headers, in order
      // The cell values are the size labels for that type
      const sizes: string[] = [];
      for (const col of sizeColumns) {
        const val = String(row[col] || "").trim();
        if (val) sizes.push(val);
      }

      if (sizes.length === 0) {
        errors.push(`Type ${code}: aucune taille trouvée`);
        continue;
      }

      try {
        await prisma.sizeType.upsert({
          where: { code },
          update: { label, sizes: JSON.stringify(sizes) },
          create: { code, label, sizes: JSON.stringify(sizes) },
        });
        imported++;
      } catch (e) {
        errors.push(`Type ${code}: ${String(e)}`);
      }
    }

    // Log the import
    const seasonId = formData.get("seasonId") as string | null;
    if (seasonId) {
      await prisma.importLog.create({
        data: {
          seasonId,
          importType: "SIZE_TYPE",
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
    return NextResponse.json(
      { error: `Erreur d'import: ${String(e)}` },
      { status: 500 }
    );
  }
}

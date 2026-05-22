import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseExcelBuffer } from "@/lib/import/parser";

// GET — list all size types with their mappings
export async function GET() {
  try {
    const sizeTypes = await prisma.sizeType.findMany({
      include: {
        mappings: { orderBy: { position: "asc" } },
      },
      orderBy: { code: "asc" },
    });
    return NextResponse.json({ data: sizeTypes });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur: ${String(e)}` },
      { status: 500 }
    );
  }
}

// POST — import size type mappings from CSV/Excel
// Expected columns: sizeTypeCode (type de taille), sizeName (valeur taille), position (numéro de taille)
// OR: sizeTypeCode, label, then numbered columns (1, 2, 3...) containing size names
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const mappingJson = formData.get("mapping") as string | null;
    const format = formData.get("format") as string | null; // "rows" or "columns"

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

    if (format === "rows") {
      // Format ligne par ligne: sizeTypeCode | sizeName | position
      for (const row of sheet.rows) {
        const code = String(row[mapping.sizeTypeCode] || "").trim();
        const sizeName = String(row[mapping.sizeName] || "").trim();
        const posStr = String(row[mapping.position] || "").trim();
        const position = parseInt(posStr);
        const label = mapping.label ? String(row[mapping.label] || "").trim() || null : null;

        if (!code || !sizeName || isNaN(position)) {
          errors.push(`Ligne ignorée: code=${code}, taille=${sizeName}, n°=${posStr}`);
          continue;
        }

        try {
          const sizeType = await prisma.sizeType.upsert({
            where: { code },
            update: { ...(label ? { label } : {}) },
            create: { code, label },
          });

          await prisma.sizeTypeMapping.upsert({
            where: {
              sizeTypeId_position: { sizeTypeId: sizeType.id, position },
            },
            update: { sizeName },
            create: { sizeTypeId: sizeType.id, position, sizeName },
          });
          imported++;
        } catch (e) {
          errors.push(`${code}/${position}: ${String(e)}`);
        }
      }
    } else {
      // Format colonnes: code | label | 1 | 2 | 3 | 4 | ...
      // Les colonnes non-mappées contiennent les noms de taille
      const codeCol = mapping.sizeTypeCode || "code";
      const labelCol = mapping.label || "label";

      const sizeColumns = sheet.headers.filter(
        (h) => h !== codeCol && h !== labelCol
      );

      for (const row of sheet.rows) {
        const code = String(row[codeCol] || "").trim();
        if (!code) {
          errors.push("Ligne ignorée: code type de taille manquant");
          continue;
        }

        const label = String(row[labelCol] || "").trim() || null;

        try {
          const sizeType = await prisma.sizeType.upsert({
            where: { code },
            update: { ...(label ? { label } : {}) },
            create: { code, label },
          });

          // Delete existing mappings for this type to replace
          await prisma.sizeTypeMapping.deleteMany({
            where: { sizeTypeId: sizeType.id },
          });

          let position = 1;
          for (const col of sizeColumns) {
            const sizeName = String(row[col] || "").trim();
            if (!sizeName) continue;

            await prisma.sizeTypeMapping.create({
              data: {
                sizeTypeId: sizeType.id,
                position,
                sizeName,
              },
            });
            position++;
          }
          imported++;
        } catch (e) {
          errors.push(`Type ${code}: ${String(e)}`);
        }
      }
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

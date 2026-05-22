import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseExcelBuffer } from "@/lib/import/parser";

// GET — list all EAN entries (paginated)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const search = searchParams.get("search") || "";
    const page = parseInt(searchParams.get("page") || "1");
    const limit = 100;

    const where = search
      ? {
          OR: [
            { reference: { contains: search, mode: "insensitive" as const } },
            { color: { contains: search, mode: "insensitive" as const } },
            { ean: { contains: search } },
          ],
        }
      : {};

    const [eans, total] = await Promise.all([
      prisma.productSizeEan.findMany({
        where,
        orderBy: [{ reference: "asc" }, { color: "asc" }, { size: "asc" }],
        take: limit,
        skip: (page - 1) * limit,
      }),
      prisma.productSizeEan.count({ where }),
    ]);

    return NextResponse.json({ data: eans, total, page, limit });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur: ${String(e)}` },
      { status: 500 }
    );
  }
}

// POST — import EAN from CSV/Excel
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
      const reference = String(row[mapping.reference] || "").trim();
      const color = String(row[mapping.color] || "").trim();
      const size = String(row[mapping.size] || "").trim();
      const ean = String(row[mapping.ean] || "").trim();

      if (!reference || !color || !size || !ean) {
        errors.push(
          `Ligne ignorée: champ manquant (ref=${reference}, couleur=${color}, taille=${size}, ean=${ean})`
        );
        continue;
      }

      try {
        await prisma.productSizeEan.upsert({
          where: {
            reference_color_size: { reference, color, size },
          },
          update: { ean },
          create: { reference, color, size, ean },
        });
        imported++;
      } catch (e) {
        errors.push(`${reference}/${color}/${size}: ${String(e)}`);
      }
    }

    const seasonId = formData.get("seasonId") as string | null;
    if (seasonId) {
      await prisma.importLog.create({
        data: {
          seasonId,
          importType: "EAN",
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

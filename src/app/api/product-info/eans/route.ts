import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseExcelBuffer } from "@/lib/import/parser";

// GET — list all EAN entries (paginated, sorted by size type position)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const search = searchParams.get("search") || "";
    const page = parseInt(searchParams.get("page") || "1");
    const limit = 100;

    // Use raw SQL to sort sizes by their position in product.sizeScale
    const offset = (page - 1) * limit;

    let whereClause = "";
    const params: string[] = [];

    if (search) {
      whereClause = `WHERE (e.reference ILIKE $1 OR e.color ILIKE $1 OR e.ean LIKE $2)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    const countQuery = `SELECT count(*) FROM "ProductSizeEan" e ${whereClause}`;
    const countResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
      countQuery,
      ...params
    );
    const total = Number(countResult[0].count);

    // Main query with size ordering from Product.sizeScale
    const dataQuery = `
      SELECT e.id, e.reference, e.color, e.size, e.ean,
        COALESCE(
          array_position(string_to_array(p."sizeScale", ','), e.size),
          999
        ) as size_pos
      FROM "ProductSizeEan" e
      LEFT JOIN "Product" p ON p.reference = e.reference AND p.color = e.color
      ${whereClause}
      ORDER BY e.reference ASC, e.color ASC, size_pos ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const eans = await prisma.$queryRawUnsafe<
      { id: string; reference: string; color: string; size: string; ean: string; size_pos: number }[]
    >(dataQuery, ...params);

    // Strip internal size_pos from response
    const data = eans.map(({ size_pos, ...rest }) => rest);

    return NextResponse.json({ data, total, page, limit });
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
          where: { ean },
          update: { reference, color, size },
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

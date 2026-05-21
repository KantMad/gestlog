import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseExcelBuffer } from "@/lib/import/parser";
import { importSupplierOrders } from "@/lib/import/supplier-order-mapper";

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

    const result = await importSupplierOrders(sheets[0], mapping, seasonId);

    await prisma.importLog.create({
      data: {
        seasonId,
        importType: "SUPPLIER_ORDER",
        fileName: file.name,
        rowCount: result.imported,
        errorCount: result.errors.length,
        errors: result.errors.length > 0 ? JSON.stringify(result.errors) : null,
      },
    });

    return NextResponse.json({
      data: {
        imported: result.imported,
        errors: result.errors,
        fileName: file.name,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur d'import: ${String(e)}` },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parseExcelBuffer } from "@/lib/import/parser";
import { importSupplierOrders } from "@/lib/import/supplier-order-mapper";
import { detectMcsFormat } from "@/lib/import/mcs-format";
import { importMcsSupplierOrders } from "@/lib/import/mcs-mapper";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const seasonId = formData.get("seasonId") as string | null;
    const mappingJson = formData.get("mapping") as string | null;

    if (!file || !seasonId) {
      return NextResponse.json({ error: "Fichier et saison requis" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();

    let result;
    if (detectMcsFormat(buffer) === "statgen") {
      // Format MCS (StatGen) : parsing dédié, sans mapping de colonnes.
      result = await importMcsSupplierOrders(buffer, seasonId);
    } else {
      // Format générique : mapping de colonnes requis.
      if (!mappingJson) {
        return NextResponse.json({ error: "Mapping des colonnes requis" }, { status: 400 });
      }
      const sheets = parseExcelBuffer(buffer);
      if (sheets.length === 0 || sheets[0].rows.length === 0) {
        return NextResponse.json({ error: "Fichier vide ou format invalide" }, { status: 400 });
      }
      result = await importSupplierOrders(sheets[0], JSON.parse(mappingJson), seasonId);
    }

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
      data: { imported: result.imported, errors: result.errors, fileName: file.name },
    });
  } catch (e) {
    return handleApiError(e, "api/import/supplier-orders");
  }
}

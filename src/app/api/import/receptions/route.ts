import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parseExcelBuffer } from "@/lib/import/parser";
import { importReception } from "@/lib/import/reception-mapper";
import { detectMcsFormat } from "@/lib/import/mcs-format";
import { importMcsReceptions } from "@/lib/import/mcs-mapper";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const seasonId = formData.get("seasonId") as string | null;
    const mappingJson = formData.get("mapping") as string | null;
    const receptionNumber = formData.get("receptionNumber") as string | null;
    // N° de commande fournisseur saisi à l'import (format MCS : absent du fichier).
    const supplierOrderNumber = formData.get("supplierOrderNumber") as string | null;

    if (!file || !seasonId) {
      return NextResponse.json({ error: "Fichier et saison requis" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const recNumber = receptionNumber || `REC-${Date.now()}`;
    const isMcs = detectMcsFormat(buffer) === "packing-list";

    // Validation AVANT la création du log (pas de log orphelin sur erreur 400).
    let sheet;
    if (!isMcs) {
      if (!mappingJson) {
        return NextResponse.json({ error: "Mapping des colonnes requis" }, { status: 400 });
      }
      const sheets = parseExcelBuffer(buffer);
      if (sheets.length === 0 || sheets[0].rows.length === 0) {
        return NextResponse.json({ error: "Fichier vide ou format invalide" }, { status: 400 });
      }
      sheet = sheets[0];
    }

    // Log créé d'abord → son id tague la réception créée (permet de supprimer l'import).
    const log = await prisma.importLog.create({
      data: { seasonId, importType: "RECEPTION", fileName: file.name, rowCount: 0 },
    });

    let result;
    try {
      result = isMcs
        ? await importMcsReceptions(buffer, seasonId, supplierOrderNumber || "", recNumber, log.id)
        : await importReception(sheet!, JSON.parse(mappingJson!), seasonId, recNumber, log.id);
    } catch (e) {
      await prisma.importLog.delete({ where: { id: log.id } }).catch(() => {});
      throw e;
    }

    await prisma.importLog.update({
      where: { id: log.id },
      data: {
        rowCount: result.imported,
        errorCount: result.errors.length,
        errors: result.errors.length > 0 ? JSON.stringify(result.errors) : null,
      },
    });

    return NextResponse.json({
      data: { imported: result.imported, errors: result.errors, fileName: file.name },
    });
  } catch (e) {
    return handleApiError(e, "api/import/receptions");
  }
}

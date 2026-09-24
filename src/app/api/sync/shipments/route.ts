import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import * as XLSX from "xlsx";
import {
  splitWarehouseRows,
  tioOrderFromFileName,
  docTypeFromFileName,
  type Row,
} from "@/lib/warehouse-import";
import { persistWarehouseDoc } from "@/lib/warehouse-persist";

export const maxDuration = 60;

// POST — Reçoit des documents entrepôt (BL / FAC) en xlsx base64 depuis n8n.
// Body : { files: [{ fileName, b64 }] }  (ou un seul { fileName, b64 }).
//
// Le type vient du préfixe du nom de fichier, le n° de commande TIO du nom lui-même
// (`BL_IS-041940245113_137391.xlsx`). Upsert idempotent par (source, docType,
// documentNumber) : réimporter remplace les lignes.
//
// ⚠️ Un fichier peut contenir PLUSIEURS documents : le découpage se fait sur la colonne
// « N° Document » (cf. lib/warehouse-import.ts). L'implémentation d'origine prenait
// l'en-tête sur la première ligne et sommait tout le reste — un export groupé serait
// devenu un seul document géant, sans erreur.
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("x-api-key");
    if (authHeader !== process.env.SYNC_API_KEY) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const body = await request.json();
    const files: { fileName: string; b64: string }[] = Array.isArray(body)
      ? body
      : body.files || [body];

    const results: unknown[] = [];
    const errors: string[] = [];

    for (const f of files) {
      try {
        if (!f.fileName || !f.b64) {
          errors.push("Fichier ignoré: fileName ou b64 manquant");
          continue;
        }
        const wb = XLSX.read(Buffer.from(f.b64, "base64"), { type: "buffer" });
        const rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[wb.SheetNames[0]], {
          defval: null,
        });
        if (rows.length === 0) throw new Error("feuille vide");

        const { documents } = splitWarehouseRows(rows, {
          docType: docTypeFromFileName(f.fileName),
        });
        if (documents.length === 0) throw new Error("aucun « N° Document »");

        const tioOrderNumber = tioOrderFromFileName(f.fileName);
        for (const doc of documents) {
          results.push(await persistWarehouseDoc(doc, { fileName: f.fileName, tioOrderNumber }));
        }
      } catch (e) {
        errors.push(`${f.fileName}: ${String(e)}`);
      }
    }

    return NextResponse.json({
      success: true,
      data: { imported: results.length, results, errors: errors.slice(0, 20), total: files.length },
    });
  } catch (e) {
    return handleApiError(e, "api/sync/shipments");
  }
}

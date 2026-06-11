import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api";

export const maxDuration = 60;

const SOURCE = "warehouse_ftp";

function genId() {
  return `whd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// Parse un nom de fichier PDF : BL_IS-033538061048_131520.pdf
//  → { docType, tioOrderNumber, documentNumber }
function parsePdfName(name: string) {
  const base = name.replace(/\.pdf$/i, "");
  const docType = /^FAC/i.test(base) ? "FAC" : "BL";
  const tioOrderNumber = (base.match(/IS-\d+/) || [])[0] || null;
  const documentNumber = base.split("_").pop() || "";
  return { docType, tioOrderNumber, documentNumber };
}

// POST — Reçoit la liste des noms de fichiers PDF de /in/PDF depuis n8n.
// Body : { files: ["BL_IS-..._131520.pdf", ...] }.
// Lie le PDF aux documents xlsx existants (même docType+documentNumber) et crée
// une référence (sans lignes) pour les documents connus uniquement en PDF.
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("x-api-key");
    if (authHeader !== process.env.SYNC_API_KEY) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const body = await request.json();
    const files: string[] = Array.isArray(body) ? body : body.files || [];

    // Dédoublonne par (docType, documentNumber) — clé du ON CONFLICT.
    const byKey = new Map<
      string,
      { docType: string; tioOrderNumber: string | null; documentNumber: string; pdf: string }
    >();
    for (const f of files) {
      if (typeof f !== "string" || !/\.pdf$/i.test(f)) continue;
      const p = parsePdfName(f);
      if (!p.documentNumber) continue;
      byKey.set(`${p.docType}|${p.documentNumber}`, { ...p, pdf: f });
    }
    const rows = [...byKey.values()];

    const CHUNK = 300;
    let processed = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const flat: unknown[] = [];
      const tuples = slice.map((r) => {
        const vals = [
          genId(),
          SOURCE,
          r.docType,
          r.documentNumber,
          r.tioOrderNumber,
          r.pdf,
        ];
        const ph = vals.map((v) => {
          flat.push(v);
          return `$${flat.length}`;
        });
        // colonnes restantes en littéraux : fileName='', hasLines=false,
        // totalQuantity=0, importedAt=NOW(), updatedAt=NOW().
        return `(${ph.join(",")}, '', false, 0, NOW(), NOW())`;
      });
      await prisma.$executeRawUnsafe(
        `INSERT INTO "WarehouseDocument"
           (id, source, "docType", "documentNumber", "tioOrderNumber", "pdfFileName",
            "fileName", "hasLines", "totalQuantity", "importedAt", "updatedAt")
         VALUES ${tuples.join(",")}
         ON CONFLICT (source, "docType", "documentNumber")
         DO UPDATE SET "pdfFileName" = EXCLUDED."pdfFileName", "updatedAt" = NOW()`,
        ...flat
      );
      processed += slice.length;
    }

    return NextResponse.json({
      success: true,
      data: { received: files.length, upserted: processed },
    });
  } catch (e) {
    return handleApiError(e, "api/sync/shipment-pdfs");
  }
}

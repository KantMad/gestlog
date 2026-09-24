import { prisma } from "@/lib/prisma";
import type { WarehouseDoc } from "@/lib/warehouse-import";

// Écriture des documents entrepôt. Partagé par la synchro FTP (n8n) et l'import manuel,
// pour que les deux chemins produisent exactement les mêmes lignes.
//
// ⚠️ SQL brut avec ON CONFLICT plutôt que `prisma.upsert` — cf. gotcha adapter-pg.
// L'idempotence porte sur (source, docType, documentNumber) : réimporter un document
// remplace ses lignes au lieu de les doubler.

export const WAREHOUSE_SOURCE = "warehouse_ftp";

function genId(p: string) {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface PersistResult {
  docType: string;
  documentNumber: string;
  lines: number;
  totalQuantity: number;
  /** Le document existait déjà : ses lignes ont été remplacées. */
  replaced: boolean;
}

/** Numéros déjà présents en base, parmi ceux proposés. Sert à prévenir AVANT d'écrire. */
export async function existingDocumentNumbers(
  docType: string,
  numbers: string[]
): Promise<Set<string>> {
  if (numbers.length === 0) return new Set();
  const rows = await prisma.warehouseDocument.findMany({
    where: { source: WAREHOUSE_SOURCE, docType, documentNumber: { in: numbers } },
    select: { documentNumber: true },
  });
  return new Set(rows.map((r) => r.documentNumber));
}

export async function persistWarehouseDoc(
  doc: WarehouseDoc,
  { fileName, tioOrderNumber }: { fileName: string; tioOrderNumber: string | null }
): Promise<PersistResult> {
  const deja = await existingDocumentNumbers(doc.docType, [doc.documentNumber]);

  const upserted = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO "WarehouseDocument"
       (id, source, "docType", "documentNumber", "tioOrderNumber", season, "clientCode", "clientName",
        "brandLabel", "documentDate", "secondaryDate", "documentTotal", "fileName",
        "totalQuantity", "importedAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
     ON CONFLICT (source, "docType", "documentNumber")
     DO UPDATE SET
       "tioOrderNumber" = $5, season = $6, "clientCode" = $7, "clientName" = $8, "brandLabel" = $9,
       "documentDate" = $10, "secondaryDate" = $11, "documentTotal" = $12,
       "fileName" = $13, "totalQuantity" = $14, "updatedAt" = NOW()
     RETURNING id`,
    genId("whd"),
    WAREHOUSE_SOURCE,
    doc.docType,
    doc.documentNumber,
    tioOrderNumber,
    doc.season,
    doc.clientCode,
    doc.clientName,
    doc.brandLabel,
    doc.documentDate,
    doc.secondaryDate,
    doc.documentTotal,
    fileName,
    doc.totalQuantity
  );
  const documentId = upserted[0].id;

  await prisma.$executeRawUnsafe(
    `DELETE FROM "WarehouseDocumentLine" WHERE "documentId" = $1`,
    documentId
  );

  const COLS = `(id, "documentId", "lineNo", reference, "productLabel", "colorCode", "colorLabel", size, ean, quantity, "unitPrice", "parcelNo", location, "statFamily", "statSubFamily", "orderRef", "rawData", "createdAt")`;
  // 200 lignes × 17 paramètres = 3 400, bien sous la limite de PostgreSQL.
  const CHUNK = 200;
  for (let i = 0; i < doc.lines.length; i += CHUNK) {
    const slice = doc.lines.slice(i, i + CHUNK);
    const flat: unknown[] = [];
    const tuples = slice.map((l) => {
      const vals = [
        genId("whl"), documentId, l.lineNo, l.reference, l.productLabel, l.colorCode,
        l.colorLabel, l.size, l.ean, l.quantity, l.unitPrice, l.parcelNo, l.location,
        l.statFamily, l.statSubFamily, l.orderRef, JSON.stringify(l.raw),
      ];
      const ph = vals.map((v) => {
        flat.push(v);
        return `$${flat.length}`;
      });
      return `(${ph.join(",")}, NOW())`;
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "WarehouseDocumentLine" ${COLS} VALUES ${tuples.join(",")}`,
      ...flat
    );
  }

  return {
    docType: doc.docType,
    documentNumber: doc.documentNumber,
    lines: doc.lines.length,
    totalQuantity: doc.totalQuantity,
    replaced: deja.has(doc.documentNumber),
  };
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";

export const maxDuration = 60;

// POST — Reçoit des documents entrepôt (BL / FAC) en xlsx base64 depuis n8n.
// Body : { files: [{ fileName, b64 }] }  (ou un seul { fileName, b64 }).
// Parse server-side, détecte le type depuis le préfixe du nom, upsert idempotent
// par (source, docType, documentNumber) — réimporter remplace les lignes.

const SOURCE = "warehouse_ftp";

function genId(p: string) {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// "02/12/2025" → Date (locale). Renvoie null si vide / format inattendu.
function parseFrDate(s: unknown): Date | null {
  if (!s) return null;
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  // UTC minuit pour une date pure (évite le décalage J-1 à l'affichage UTC).
  return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
}

function num(v: unknown): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v);
}

type Row = Record<string, unknown>;

async function importFile(fileName: string, b64: string) {
  const docType = /^FAC/i.test(fileName) ? "FAC" : "BL";
  // n° de commande TIO encodé dans le nom : BL_IS-041940245113_137391.xlsx
  const tioOrderNumber = (fileName.match(/IS-\d+/) || [])[0] || null;
  const buf = Buffer.from(b64, "base64");
  const wb = XLSX.read(buf, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[wb.SheetNames[0]], {
    defval: null,
  });
  if (rows.length === 0) throw new Error(`${fileName}: feuille vide`);

  const h = rows[0];
  const documentNumber = str(h["N° Document"]);
  if (!documentNumber) throw new Error(`${fileName}: N° Document manquant`);

  const documentDate = parseFrDate(
    docType === "FAC" ? h["Date facture"] : h["Date livraison"]
  );
  const secondaryDate = parseFrDate(
    docType === "FAC" ? h["Date valeur"] : h["Date préparation"]
  );
  const totalQuantity = rows.reduce((s, r) => s + (Number(r["Qté"]) || 0), 0);
  // "Prix du Document" est répété sur chaque ligne — on prend le max.
  const documentTotal = Math.max(0, ...rows.map((r) => num(r["Prix du Document"])));

  // Upsert document (SQL brut + ON CONFLICT — cf. gotcha adapter-pg) avec RETURNING id.
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
    SOURCE,
    docType,
    documentNumber,
    tioOrderNumber,
    str(h["Saison Document"]),
    str(h["Code Client"]),
    str(h["Raison sociale Client"]),
    str(h["Libellé marque"]),
    documentDate,
    secondaryDate,
    documentTotal,
    fileName,
    totalQuantity
  );
  const documentId = upserted[0].id;

  // Remplace les lignes
  await prisma.$executeRawUnsafe(
    `DELETE FROM "WarehouseDocumentLine" WHERE "documentId" = $1`,
    documentId
  );

  for (const r of rows) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "WarehouseDocumentLine"
         (id, "documentId", "lineNo", reference, "productLabel", "colorCode", "colorLabel",
          size, ean, quantity, "unitPrice", "parcelNo", location, "statFamily",
          "statSubFamily", "orderRef", "rawData", "createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())`,
      genId("whl"),
      documentId,
      str(r["N° Ligne"]),
      str(r["Code Produit Fini"]),
      str(r["Libellé 1 Produit Fini"]),
      str(r["Code Coloris"]),
      str(r["Libellé Coloris"]),
      str(r["Taille"]),
      str(r["Code Barre"]),
      Number(r["Qté"]) || 0,
      num(r["Prix Unitaire"]),
      str(r["N° Colis"]),
      str(r["Code Emplacement"]),
      str(r["Libellé famille statistique"]),
      str(r["Libellé sous famille statistique"]),
      str(r["Référence Commande"]),
      JSON.stringify(r)
    );
  }

  return { docType, documentNumber, lines: rows.length, totalQuantity };
}

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
        results.push(await importFile(f.fileName, f.b64));
      } catch (e) {
        errors.push(`${f.fileName}: ${String(e)}`);
      }
    }

    return NextResponse.json({
      success: true,
      data: { imported: results.length, results, errors: errors.slice(0, 20), total: files.length },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur sync shipments: ${String(e)}` },
      { status: 500 }
    );
  }
}

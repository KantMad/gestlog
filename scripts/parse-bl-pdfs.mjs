// Parse les documents dépôt PDF en lignes (réf + colorCode + taille + quantité) pour la
// réconciliation : BL (bons de livraison) → quantités LIVRÉES par taille ; FAC (factures)
// → quantités FACTURÉES par coloris (récapitulatif, sans ventilation taille).
// Tourne sur le VPS (accès base + webhook FTP).
// Usage : node scripts/parse-bl-pdfs.mjs [--bl|--fac] [--pe26] [--limit=N]
//   sans --bl/--fac : traite les deux types.
import fs from "fs";
import pg from "pg";
import { parseLines, parseFacLines } from "./bl-parser.mjs";
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

// ── env ──────────────────────────────────────────────
const env = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
const ev = (k) => (env.match(new RegExp("^" + k + "=[\"']?([^\"'\\n]+)", "m")) || [])[1];
const DBURL = ev("DATABASE_URL");
const KEY = ev("SYNC_API_KEY");
const WEBHOOK = "https://centralway.pro/webhook/gestlog-pdf";

async function pdfToLines(buf, docType) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  const items = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    items.push(...tc.items.filter((i) => i.str.trim()).map((i) => ({
      x: Math.round(i.transform[4]),
      y: Math.round(i.transform[5]) - (p - 1) * 2000, // page 1 en premier
      s: i.str.trim(),
    })));
  }
  await doc.destroy();
  return docType === "FAC" ? parseFacLines(items) : parseLines(items);
}

const genId = () => "wdl_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

// ── main ─────────────────────────────────────────────
const onlyPe = process.argv.includes("--pe26");
const onlyBl = process.argv.includes("--bl");
const onlyFac = process.argv.includes("--fac");
const types = onlyBl ? ["BL"] : onlyFac ? ["FAC"] : ["BL", "FAC"];
const limit = parseInt((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || 100000;

const c = new pg.Client({ connectionString: DBURL });
await c.connect();

const docs = (await c.query(
  `SELECT d.id, d."docType", COALESCE(NULLIF(d."pdfFileName",''), d."fileName") AS fn
   FROM "WarehouseDocument" d
   ${onlyPe ? 'JOIN "ClientOrder" co ON co."orderNumber"=d."tioOrderNumber" JOIN "Season" s ON s.id=co."seasonId"' : ""}
   WHERE d."docType" = ANY($1) AND d."hasLines"=false
     AND COALESCE(NULLIF(d."pdfFileName",''), d."fileName") ~ '\\.pdf$'
     ${onlyPe ? "AND s.year=2026 AND s.type='PE'" : ""}
   ORDER BY d.id LIMIT ${limit}`,
  [types]
)).rows;
console.log(`Docs ${types.join("/")} PDF à parser: ${docs.length}`);

let done = 0, empty = 0, errors = 0, totLines = 0;
for (const d of docs) {
  try {
    const res = await fetch(`${WEBHOOK}?key=${encodeURIComponent(KEY)}&file=${encodeURIComponent(d.fn)}`, { signal: AbortSignal.timeout(60000) });
    const j = await res.json();
    if (!j.b64) { errors++; continue; }
    const lines = await pdfToLines(Buffer.from(j.b64, "base64"), d.docType);
    if (lines.length === 0) { empty++; continue; } // laissé hasLines=false (réessayable)
    const flat = []; const tuples = lines.map((l) => {
      const v = [genId(), d.id, l.reference, l.colorCode, l.colorLabel || null, l.size, l.quantity, l.unitPrice || 0, l.amount || 0];
      const ph = v.map((x) => { flat.push(x); return `$${flat.length}`; });
      return `(${ph.join(",")}, NOW())`;
    });
    await c.query("BEGIN");
    await c.query(`DELETE FROM "WarehouseDocumentLine" WHERE "documentId"=$1`, [d.id]);
    await c.query(`INSERT INTO "WarehouseDocumentLine" (id,"documentId",reference,"colorCode","colorLabel",size,quantity,"unitPrice",amount,"createdAt") VALUES ${tuples.join(",")}`, flat);
    const totQ = lines.reduce((s, l) => s + l.quantity, 0);
    await c.query(`UPDATE "WarehouseDocument" SET "hasLines"=true,"totalQuantity"=$1,"updatedAt"=NOW() WHERE id=$2`, [totQ, d.id]);
    await c.query("COMMIT");
    done++; totLines += lines.length;
    if (done % 50 === 0) console.log(`  ${done}/${docs.length} traités (${totLines} lignes, ${empty} vides, ${errors} err)`);
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    errors++;
    if (errors <= 6) console.log(`  ⚠️ ${d.fn}: ${e.message}`);
  }
}
console.log(`\nTerminé : ${done} docs parsés, ${totLines} lignes créées, ${empty} sans lignes, ${errors} erreurs.`);
await c.end();

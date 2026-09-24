import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import * as XLSX from "xlsx";
import { splitWarehouseRows, tioOrderFromFileName, type Row } from "@/lib/warehouse-import";
import { existingDocumentNumbers, persistWarehouseDoc } from "@/lib/warehouse-persist";

export const maxDuration = 300;

// Import MANUEL d'un fichier de livraisons entrepôt (écran Livraisons).
//
// Pourquoi cet écran alors que n8n fait déjà la synchro : le dépôt FTP `/in/EAN` peut
// rester muet — *il ne contient plus un seul fichier neuf depuis le 10/06/2026* — sans
// que rien ne le signale. Ce chemin rend l'exploitant autonome pour rattraper.
//
// ⚠️ Accès : la route est sous `/api/shipments`, donc filtrée par le droit d'écran
// `/shipments` (cf. lib/screens.ts). Elle N'utilise PAS la clé de synchro.
//
// `?dryRun=1` analyse sans rien écrire : c'est ce qui alimente l'aperçu avant import.
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file") as File | null;
    const docType = form.get("docType") === "FAC" ? "FAC" : "BL";
    const dryRun = form.get("dryRun") === "1";
    const treatments = String(form.get("treatments") || "")
      .split(",").map((s) => s.trim()).filter(Boolean);

    if (!file) return NextResponse.json({ error: "Fichier requis" }, { status: 400 });

    const wb = XLSX.read(await file.arrayBuffer(), { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[wb.SheetNames[0]], { defval: null });
    if (rows.length === 0) {
      return NextResponse.json({ error: "Fichier vide ou format non reconnu" }, { status: 400 });
    }

    const { documents, ignored } = splitWarehouseRows(rows, { docType });
    if (documents.length === 0) {
      return NextResponse.json(
        { error: "Aucune colonne « N° Document » exploitable — fichier inattendu" },
        { status: 400 }
      );
    }

    // Filtre par type de traitement (LIV, LIC…) si l'écran en a coché.
    const retenus = treatments.length
      ? documents.filter((d) => treatments.includes(d.treatment || "—"))
      : documents;

    const dejaLa = await existingDocumentNumbers(docType, retenus.map((d) => d.documentNumber));

    // Récapitulatif : toujours calculé, y compris en écriture réelle.
    const parTraitement: Record<string, { documents: number; pieces: number }> = {};
    for (const d of documents) {
      const k = d.treatment || "—";
      const e = (parTraitement[k] ||= { documents: 0, pieces: 0 });
      e.documents++;
      e.pieces += d.totalQuantity;
    }
    const dates = retenus
      .map((d) => d.documentDate)
      .filter((d): d is Date => !!d)
      .sort((a, b) => a.getTime() - b.getTime());

    const apercu = {
      documents: retenus.length,
      documentsFichier: documents.length,
      pieces: retenus.reduce((n, d) => n + d.totalQuantity, 0),
      lignes: retenus.reduce((n, d) => n + d.lines.length, 0),
      lignesIgnorees: ignored,
      clients: new Set(retenus.map((d) => d.clientCode)).size,
      dejaEnBase: [...dejaLa],
      parTraitement,
      du: dates[0]?.toISOString().slice(0, 10) ?? null,
      au: dates[dates.length - 1]?.toISOString().slice(0, 10) ?? null,
      // ⚠️ Un export groupé ne porte aucun « IS- »/« PO- » : le lien BL ↔ commande
      // client restera vide, le rattachement se fera par le seul code client.
      tioOrderNumber: tioOrderFromFileName(file.name),
    };

    if (dryRun) return NextResponse.json({ data: { dryRun: true, ...apercu } });

    const tioOrderNumber = tioOrderFromFileName(file.name);
    const errors: string[] = [];
    let ecrits = 0;
    let remplaces = 0;
    for (const doc of retenus) {
      try {
        const r = await persistWarehouseDoc(doc, { fileName: file.name, tioOrderNumber });
        ecrits++;
        if (r.replaced) remplaces++;
      } catch (e) {
        errors.push(`Document ${doc.documentNumber} : ${String(e)}`);
      }
    }

    return NextResponse.json({
      data: { dryRun: false, ...apercu, ecrits, remplaces, errors: errors.slice(0, 20) },
    });
  } catch (e) {
    return handleApiError(e, "api/shipments/import");
  }
}

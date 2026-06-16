import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import {
  parseLegend,
  extractDataRows,
  pickGrid,
  buildRepartition,
  normalizeSize,
  type Legend,
} from "@/lib/repartition";

// POST — Génère le fichier « répartition magasin » : importe un export commande
// client TIO (mono-onglet) et renvoie un classeur avec UN ONGLET PAR FOURNISSEUR.
// Réponse JSON { report, fileBase64 } pour afficher un récap avant téléchargement.
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Aucun fichier fourni." }, { status: 400 });

    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return NextResponse.json({ error: "Fichier illisible (aucun onglet)." }, { status: 400 });
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });

    const legend = parseLegend(aoa);
    const dataRows = extractDataRows(aoa);
    if (dataRows.length === 0) {
      return NextResponse.json(
        { error: "Aucune ligne de commande détectée (référence + fournisseur)." },
        { status: 400 }
      );
    }

    // sizeScale par référence (la plus longue = grille la plus complète) depuis le catalogue
    const refs = [...new Set(dataRows.map((d) => d.reference))];
    const products = await prisma.product.findMany({
      where: { reference: { in: refs } },
      select: { reference: true, sizeScale: true },
    });
    const scaleByRef = new Map<string, string>();
    for (const p of products) {
      const prev = scaleByRef.get(p.reference);
      if (!prev || (p.sizeScale?.length || 0) > prev.length) scaleByRef.set(p.reference, p.sizeScale || "");
    }

    // grille (libellés ordonnés) par référence : grille légende = plus petit sur-ensemble
    // des tailles du catalogue ; à défaut, repli sur la position Q max utilisée.
    const maxQByRef = new Map<string, number>();
    for (const d of dataRows) {
      let m = 0;
      d.q.forEach((v, i) => { if (v > 0) m = Math.max(m, i + 1); });
      maxQByRef.set(d.reference, Math.max(maxQByRef.get(d.reference) || 0, m));
    }
    const legendByLen = (n: number): string[] | null => {
      const cands = Object.values(legend).filter((l) => l.length >= n).sort((a, b) => a.length - b.length);
      return cands[0] || null;
    };
    const gridByRef: Record<string, string[]> = {};
    const missingRefs: string[] = [];
    for (const ref of refs) {
      const scale = scaleByRef.get(ref);
      if (scale) {
        const sizes = scale.split(",").map((s) => normalizeSize(s)).filter(Boolean);
        gridByRef[ref] = pickGrid(sizes, legend) || sizes;
      } else {
        // référence absente du catalogue → repli sur une grille légende par longueur
        missingRefs.push(ref);
        const n = maxQByRef.get(ref) || 1;
        gridByRef[ref] =
          legendByLen(n) || Array.from({ length: n }, (_, i) => `T${i + 1}`);
      }
    }

    const result = buildRepartition(dataRows, gridByRef);

    // écriture du classeur (un onglet par fournisseur)
    const outWb = XLSX.utils.book_new();
    for (const s of result.sheets) {
      const ws = XLSX.utils.aoa_to_sheet([s.header, ...s.rows]);
      XLSX.utils.book_append_sheet(outWb, ws, s.sheetName);
    }
    const outBuf: Buffer = XLSX.write(outWb, { type: "buffer", bookType: "xlsx" });

    const baseName = (file.name || "commande").replace(/\.[^.]+$/, "");
    return NextResponse.json({
      report: result.report,
      totalLines: result.totalLines,
      totalDropped: result.totalDropped,
      suppliers: result.sheets.length,
      legend: Object.fromEntries(Object.entries(legend).map(([k, v]) => [k, v.join("/")])),
      missingRefs,
      fileName: `${baseName} - repartition.xlsx`,
      fileBase64: outBuf.toString("base64"),
    });
  } catch (e) {
    return handleApiError(e, "api/repartition");
  }
}

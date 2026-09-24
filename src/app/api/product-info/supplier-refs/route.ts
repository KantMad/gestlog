import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parseExcelBuffer } from "@/lib/import/parser";
import { planSupplierRefImport, type SupplierRefRow } from "@/lib/supplier-refs";

// Correspondances fournisseur → référence produit.
//
// ⚠️ Information commercialement sensible (qui fabrique quoi). L'accès est filtré par
// le middleware sur le droit `/product-info` — pages ET API (cf. lib/screens.ts).
// Elle n'est volontairement exposée par aucun autre écran.

export const maxDuration = 60;

// GET — toutes les correspondances connues.
export async function GET() {
  try {
    const refs = await prisma.supplierProductRef.findMany({
      include: { supplier: { select: { code: true, name: true } } },
      orderBy: { reference: "asc" },
    });
    return NextResponse.json({ data: refs });
  } catch (e) {
    return handleApiError(e, "api/product-info/supplier-refs");
  }
}

// POST — import depuis un fichier Excel/CSV.
//
// ⚠️ ÉCRITURES PAR LOTS, et non ligne à ligne. L'implémentation d'origine faisait deux
// `upsert` par ligne : sur un fichier de 3 000 références, cela faisait 6 000
// allers-retours vers Supabase — plusieurs minutes, et un délai d'attente dépassé bien
// avant la fin. Ici : 2 lectures, 2 écritures groupées.
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const mappingJson = formData.get("mapping") as string | null;
    const replace = formData.get("replace") === "true";

    if (!file) {
      return NextResponse.json({ error: "Fichier requis" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const sheets = parseExcelBuffer(buffer);
    if (sheets.length === 0 || sheets[0].rows.length === 0) {
      return NextResponse.json({ error: "Fichier vide ou format invalide" }, { status: 400 });
    }

    const mapping = mappingJson ? JSON.parse(mappingJson) : {};
    if (!mapping.supplierCode || !mapping.reference) {
      return NextResponse.json(
        { error: "Colonnes « code fournisseur » et « référence » requises" },
        { status: 400 }
      );
    }

    const rows: SupplierRefRow[] = sheets[0].rows.map((row) => ({
      supplierCode: String(row[mapping.supplierCode] ?? ""),
      supplierName: mapping.supplierName ? String(row[mapping.supplierName] ?? "") : undefined,
      reference: String(row[mapping.reference] ?? ""),
    }));

    // Les deux seules lectures : fournisseurs connus et références du catalogue.
    const [suppliers, produits] = await Promise.all([
      prisma.supplier.findMany({ select: { code: true, name: true } }),
      prisma.product.findMany({ select: { reference: true }, distinct: ["reference"] }),
    ]);

    const plan = planSupplierRefImport(rows, {
      suppliers,
      catalogueRefs: produits.map((p) => p.reference),
    });

    // Création des fournisseurs réellement absents (le rapprochement insensible à la
    // casse a déjà écarté les faux nouveaux : « Enteks » retrouve « ENTEKS »).
    if (plan.newSuppliers.length > 0) {
      await prisma.supplier.createMany({ data: plan.newSuppliers, skipDuplicates: true });
    }

    const tousFournisseurs = await prisma.supplier.findMany({ select: { id: true, code: true } });
    const idParCode = new Map(tousFournisseurs.map((s) => [s.code, s.id]));

    // ⚠️ Remplacement explicite et jamais par défaut : sans lui, réimporter un fichier
    // corrigé laisse les lignes fautives du premier passage en place, invisibles.
    if (replace) await prisma.supplierProductRef.deleteMany({});

    const data = plan.links
      .map((l) => ({ supplierId: idParCode.get(l.supplierCode), reference: l.reference }))
      .filter((l): l is { supplierId: string; reference: string } => Boolean(l.supplierId));

    // skipDuplicates : réimporter le même fichier ne doit rien casser ni rien doubler.
    const { count } = await prisma.supplierProductRef.createMany({ data, skipDuplicates: true });

    const total = await prisma.supplierProductRef.count();

    const seasonId = formData.get("seasonId") as string | null;
    if (seasonId) {
      const errors = [
        ...plan.ignored.map((i) => `Ligne ${i.line} : ${i.reason}`),
        ...plan.unknownRefs.map((r) => `Référence inconnue au catalogue : ${r}`),
      ];
      await prisma.importLog.create({
        data: {
          seasonId,
          importType: "SUPPLIER_REF",
          fileName: file.name,
          rowCount: count,
          errorCount: errors.length,
          errors: errors.length > 0 ? JSON.stringify(errors.slice(0, 500)) : null,
        },
      });
    }

    return NextResponse.json({
      data: {
        imported: count,
        dejaPresentes: data.length - count,
        total,
        remplace: replace,
        newSuppliers: plan.newSuppliers.map((s) => s.code),
        suspects: plan.suspects,
        rapprochements: plan.rapprochements,
        unknownRefs: plan.unknownRefs,
        multiSupplier: plan.multiSupplier,
        duplicates: plan.duplicates,
        ignored: plan.ignored,
      },
    });
  } catch (e) {
    return handleApiError(e, "api/product-info/supplier-refs");
  }
}

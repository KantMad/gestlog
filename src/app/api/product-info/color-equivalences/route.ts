import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

// GET — Liste des équivalences de code couleur (fichiers ↔ référentiel TIO).
export async function GET() {
  try {
    const data = await prisma.colorEquivalence.findMany({ orderBy: { createdAt: "desc" } });
    return NextResponse.json({ data });
  } catch (e) {
    return handleApiError(e, "api/product-info/color-equivalences#GET");
  }
}

// POST — Crée une équivalence : sourceCode (code des fichiers, AFFICHÉ) → targetCode
// (code du référentiel TIO où trouver EAN/grille). Ex. SSS → 000.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sourceCode = String(body.sourceCode || "").trim().toUpperCase();
    const targetCode = String(body.targetCode || "").trim();
    const label = String(body.label || "").trim() || null;

    if (!sourceCode || !targetCode) {
      return NextResponse.json(
        { error: "Les deux codes couleur sont requis." },
        { status: 400 }
      );
    }
    if (sourceCode === targetCode.toUpperCase()) {
      return NextResponse.json(
        { error: "Les deux codes doivent être différents." },
        { status: 400 }
      );
    }

    const existing = await prisma.colorEquivalence.findUnique({
      where: { sourceCode_targetCode: { sourceCode, targetCode } },
    });
    if (existing) {
      return NextResponse.json({ error: "Cette équivalence existe déjà." }, { status: 409 });
    }

    const data = await prisma.colorEquivalence.create({
      data: { sourceCode, targetCode, label },
    });

    // Combien de produits sont concernés (au référentiel, sous le code cible) ? Info utile :
    // la bascule effective se fera À L'IMPORT, référence par référence.
    const impacted = await prisma.product.count({ where: { color: targetCode } });

    return NextResponse.json({ data, impacted });
  } catch (e) {
    return handleApiError(e, "api/product-info/color-equivalences#POST");
  }
}

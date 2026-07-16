import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

// DELETE — Supprime une équivalence. Les produits DÉJÀ basculés ne sont pas remis en arrière
// (ils restent sous le code des fichiers) : la suppression ne fait qu'arrêter les futures
// bascules. Pour revenir en arrière, créer l'équivalence inverse.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await prisma.colorEquivalence.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Équivalence introuvable" }, { status: 404 });
    }
    await prisma.colorEquivalence.delete({ where: { id } });
    return NextResponse.json({ data: { ok: true } });
  } catch (e) {
    return handleApiError(e, "api/product-info/color-equivalences/[id]#DELETE");
  }
}

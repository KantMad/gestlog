import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateClientSchema } from "@/lib/validators";

// PATCH — réglages GLOBAUX d'une boutique (valables toutes saisons). Les réglages PAR
// SAISON (ranking, seuils…) vivent sur ClientSeason → /api/client-seasons/[id].
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = updateClientSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Données invalides", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { surplusExcludedSizes } = parsed.data;
    const updated = await prisma.client.update({
      where: { id },
      data: {
        // Liste vide → null : « aucune exception » n'est pas la même chose qu'une chaîne vide.
        ...(surplusExcludedSizes !== undefined
          ? { surplusExcludedSizes: surplusExcludedSizes.length ? surplusExcludedSizes.join(",") : null }
          : {}),
      },
    });

    return NextResponse.json({ data: updated });
  } catch {
    return NextResponse.json({ error: "Erreur lors de la mise à jour" }, { status: 500 });
  }
}

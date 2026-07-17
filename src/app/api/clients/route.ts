import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClientSchema } from "@/lib/validators";
import { parseSizeScale } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const seasonId = request.nextUrl.searchParams.get("seasonId");

  if (seasonId) {
    const clientSeasons = await prisma.clientSeason.findMany({
      where: { seasonId },
      include: { client: true },
      orderBy: { ranking: "asc" },
    });

    const data = clientSeasons.map((cs) => ({
      id: cs.client.id,
      code: cs.client.code,
      name: cs.client.name,
      email: cs.client.email,
      // Réglage GLOBAL de la boutique (pas par saison) — cf. modèle Client.
      surplusExcludedSizes: cs.client.surplusExcludedSizes
        ? parseSizeScale(cs.client.surplusExcludedSizes).filter(Boolean)
        : [],
      season: {
        id: cs.id,
        ranking: cs.ranking,
        maxReductionOrder: cs.maxReductionOrder,
        maxReductionLine: cs.maxReductionLine,
        minDeliveryThreshold: cs.minDeliveryThreshold,
        isActive: cs.isActive,
        rotationScore: cs.rotationScore,
      },
    }));

    return NextResponse.json({ data });
  }

  const clients = await prisma.client.findMany({
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ data: clients });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createClientSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Données invalides", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { code, name, email } = parsed.data;

    const existing = await prisma.client.findUnique({ where: { code } });
    if (existing) {
      return NextResponse.json(
        { error: "Ce code client existe déjà" },
        { status: 409 }
      );
    }

    const client = await prisma.client.create({
      data: { code, name, email: email || null },
    });

    return NextResponse.json({ data: client }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Erreur lors de la création du client" },
      { status: 500 }
    );
  }
}

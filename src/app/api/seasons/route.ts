import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSeasonSchema } from "@/lib/validators";

export async function GET() {
  const seasons = await prisma.season.findMany({
    orderBy: [{ year: "desc" }, { type: "asc" }],
    include: {
      _count: {
        select: {
          clientOrders: true,
          supplierOrders: true,
        },
      },
    },
  });
  return NextResponse.json({ data: seasons });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createSeasonSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Données invalides", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { name, year, type } = parsed.data;

    const existing = await prisma.season.findUnique({
      where: { year_type: { year, type } },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Cette saison existe déjà" },
        { status: 409 }
      );
    }

    const season = await prisma.season.create({
      data: { name, year, type },
    });

    return NextResponse.json({ data: season }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Erreur lors de la création de la saison" },
      { status: 500 }
    );
  }
}

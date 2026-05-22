import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET — List catalogs for a season
export async function GET(request: NextRequest) {
  const seasonId = request.nextUrl.searchParams.get("seasonId");

  if (!seasonId) {
    return NextResponse.json({ error: "seasonId requis" }, { status: 400 });
  }

  try {
    const catalogs = await prisma.catalog.findMany({
      where: { seasonId },
      include: {
        _count: { select: { clientOrders: true } },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({
      data: catalogs.map((c) => ({
        id: c.id,
        name: c.name,
        orderCount: c._count.clientOrders,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur: ${String(e)}` },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

// GET — Liste des catalogues de vente. Avec ?seasonId=… : ceux d'une saison.
// Sans seasonId : TOUS les catalogues (pour comparer deux catalogues de saisons
// différentes), avec le nom de leur saison.
export async function GET(request: NextRequest) {
  const seasonId = request.nextUrl.searchParams.get("seasonId");

  try {
    const catalogs = await prisma.catalog.findMany({
      where: seasonId ? { seasonId } : undefined,
      include: {
        _count: { select: { clientOrders: true } },
        ...(seasonId ? {} : { season: { select: { name: true } } }),
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({
      data: catalogs.map((c) => ({
        id: c.id,
        name: c.name,
        orderCount: c._count.clientOrders,
        ...(seasonId ? {} : { seasonName: (c as unknown as { season?: { name: string } }).season?.name || null }),
      })),
    });
  } catch (e) {
    return handleApiError(e, "api/catalogs");
  }
}

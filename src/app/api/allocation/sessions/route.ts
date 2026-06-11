import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const seasonId = request.nextUrl.searchParams.get("seasonId");

  if (!seasonId) {
    return NextResponse.json({ error: "seasonId requis" }, { status: 400 });
  }

  try {
    const sessions = await prisma.allocationSession.findMany({
      where: { seasonId },
      include: {
        _count: { select: { lines: true } },
      },
      orderBy: { sessionDate: "desc" },
    });

    return NextResponse.json({ data: sessions });
  } catch (e) {
    return handleApiError(e, "api/allocation/sessions");
  }
}

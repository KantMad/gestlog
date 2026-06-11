import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

// GET — list all suppliers
export async function GET() {
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true },
    });
    return NextResponse.json({ data: suppliers });
  } catch (e) {
    return handleApiError(e, "api/suppliers");
  }
}

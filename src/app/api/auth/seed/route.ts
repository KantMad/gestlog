import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Bootstrap des comptes initiaux — réservé à l'administration (clé de sync).
// Ne doit JAMAIS être appelable anonymement (sinon recréation d'un ADMIN à code connu).
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("x-api-key");
    if (authHeader !== process.env.SYNC_API_KEY) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const adminExists = await prisma.user.findUnique({ where: { code: "2358" } });
    if (!adminExists) {
      await prisma.user.create({
        data: { name: "Admin", code: "2358", role: "ADMIN" },
      });
    }

    const geraldineExists = await prisma.user.findUnique({ where: { code: "1123" } });
    if (!geraldineExists) {
      await prisma.user.create({
        data: { name: "Géraldine", code: "1123", role: "USER" },
      });
    }

    return NextResponse.json({ success: true, message: "Comptes initiaux créés" });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur: ${String(e)}` },
      { status: 500 }
    );
  }
}

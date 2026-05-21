import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST() {
  try {
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

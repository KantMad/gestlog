import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      code: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ data: users });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  try {
    const { name, code, role } = await request.json();

    if (!name || !code) {
      return NextResponse.json(
        { error: "Nom et code requis" },
        { status: 400 }
      );
    }

    if (code.length < 4) {
      return NextResponse.json(
        { error: "Le code doit faire au moins 4 caractères" },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({ where: { code } });
    if (existing) {
      return NextResponse.json(
        { error: "Ce code est déjà utilisé" },
        { status: 409 }
      );
    }

    const user = await prisma.user.create({
      data: {
        name,
        code,
        role: role === "ADMIN" ? "ADMIN" : "USER",
      },
    });

    return NextResponse.json({
      data: { id: user.id, name: user.name, role: user.role },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur: ${String(e)}` },
      { status: 500 }
    );
  }
}

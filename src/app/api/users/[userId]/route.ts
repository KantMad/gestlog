import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { userId } = await params;

  try {
    const body = await request.json();
    const data: Record<string, unknown> = {};

    if (body.name !== undefined) data.name = body.name;
    if (body.role !== undefined) data.role = body.role === "ADMIN" ? "ADMIN" : "USER";
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.code !== undefined) {
      if (body.code.length < 4) {
        return NextResponse.json(
          { error: "Le code doit faire au moins 4 caractères" },
          { status: 400 }
        );
      }
      const existing = await prisma.user.findFirst({
        where: { code: body.code, id: { not: userId } },
      });
      if (existing) {
        return NextResponse.json(
          { error: "Ce code est déjà utilisé" },
          { status: 409 }
        );
      }
      data.code = body.code;
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data,
    });

    return NextResponse.json({
      data: { id: user.id, name: user.name, role: user.role, isActive: user.isActive },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur: ${String(e)}` },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { userId } = await params;

  if (userId === session.id) {
    return NextResponse.json(
      { error: "Impossible de supprimer votre propre compte" },
      { status: 400 }
    );
  }

  try {
    await prisma.user.delete({ where: { id: userId } });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur: ${String(e)}` },
      { status: 500 }
    );
  }
}

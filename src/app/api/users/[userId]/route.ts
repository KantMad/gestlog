import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { APP_SCREEN_KEYS } from "@/lib/screens";

function normalizeScreenAccess(value: unknown): string | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;
  const valid = value.filter(
    (v): v is string => typeof v === "string" && APP_SCREEN_KEYS.includes(v)
  );
  return JSON.stringify(valid);
}

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
    if (body.screenAccess !== undefined) {
      data.screenAccess = normalizeScreenAccess(body.screenAccess);
    }
    // If promoting to ADMIN, clear any screen restriction (admins see all)
    if (body.role === "ADMIN") data.screenAccess = null;
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
    return handleApiError(e, "api/users/[userId]");
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
    return handleApiError(e, "api/users/[userId]");
  }
}

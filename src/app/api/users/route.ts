import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { parseScreenAccess, APP_SCREEN_KEYS } from "@/lib/screens";

// Validate + normalize a screenAccess payload into a JSON string (or null).
function normalizeScreenAccess(value: unknown): string | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;
  const valid = value.filter(
    (v): v is string => typeof v === "string" && APP_SCREEN_KEYS.includes(v)
  );
  return JSON.stringify(valid);
}

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
      screenAccess: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    data: users.map((u) => ({
      ...u,
      screenAccess: parseScreenAccess(u.screenAccess),
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  try {
    const { name, code, role, screenAccess } = await request.json();

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
        // Admins always have full access — don't persist a restriction for them
        screenAccess:
          role === "ADMIN" ? null : normalizeScreenAccess(screenAccess),
      },
    });

    return NextResponse.json({
      data: { id: user.id, name: user.name, role: user.role },
    });
  } catch (e) {
    return handleApiError(e, "api/users");
  }
}

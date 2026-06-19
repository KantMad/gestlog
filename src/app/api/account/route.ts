import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, parseBody } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Self-service : l'utilisateur CONNECTÉ met à jour SON propre nom et/ou code.
// (À distinguer de /api/users, réservé aux ADMIN pour gérer les autres comptes.)
const AccountUpdateSchema = z.object({
  name: z.string().trim().min(1, "Nom requis").optional(),
  code: z
    .string()
    .regex(/^\d{4}$/, "Le code doit être composé de 4 chiffres")
    .optional(),
});

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  try {
    const parsed = await parseBody(request, AccountUpdateSchema);
    if ("error" in parsed) return parsed.error;
    const body = parsed.data;

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.code !== undefined) {
      // Le code doit rester unique parmi tous les utilisateurs.
      const existing = await prisma.user.findFirst({
        where: { code: body.code, id: { not: session.id } },
      });
      if (existing) {
        return NextResponse.json(
          { error: "Ce code est déjà utilisé par un autre utilisateur" },
          { status: 409 }
        );
      }
      data.code = body.code;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Aucune modification fournie" }, { status: 400 });
    }

    const user = await prisma.user.update({
      where: { id: session.id },
      data,
    });

    return NextResponse.json({
      data: { id: user.id, name: user.name, role: user.role },
    });
  } catch (e) {
    return handleApiError(e, "api/account");
  }
}

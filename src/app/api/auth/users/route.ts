import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

// GET — Liste publique des utilisateurs actifs (id + nom uniquement) pour le menu
// déroulant de la page de connexion. Ne renvoie NI code NI rôle. L'authentification
// reste assurée par le code à 4 chiffres (le code est le secret, pas le nom).
export async function GET() {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ users });
  } catch (e) {
    return handleApiError(e, "api/auth/users");
  }
}

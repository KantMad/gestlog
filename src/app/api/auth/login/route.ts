import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { setSessionCookie } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json();

    if (!code || typeof code !== "string") {
      return NextResponse.json(
        { error: "Code requis" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { code, isActive: true },
    });

    if (!user) {
      return NextResponse.json(
        { error: "Code incorrect" },
        { status: 401 }
      );
    }

    const response = NextResponse.json({
      user: { id: user.id, name: user.name, role: user.role },
    });

    response.cookies.set(setSessionCookie(user.id));
    return response;
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur: ${String(e)}` },
      { status: 500 }
    );
  }
}

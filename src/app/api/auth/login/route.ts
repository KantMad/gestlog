import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { setSessionCookie } from "@/lib/auth";
import { parseScreenAccess } from "@/lib/screens";

const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_FAILED = 10; // tentatives échouées max par IP sur la fenêtre

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0].trim() || "unknown").slice(0, 64);
}

export async function POST(request: NextRequest) {
  try {
    const ip = clientIp(request);

    // Anti-brute-force : compte les échecs récents de cette IP.
    const since = new Date(Date.now() - WINDOW_MS);
    const recentFailures = await prisma.loginAttempt.count({
      where: { ip, success: false, createdAt: { gte: since } },
    });
    if (recentFailures >= MAX_FAILED) {
      return NextResponse.json(
        { error: "Trop de tentatives. Réessayez dans quelques minutes." },
        { status: 429 }
      );
    }

    const { code } = await request.json();

    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "Code requis" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { code, isActive: true },
    });

    if (!user) {
      await prisma.loginAttempt.create({ data: { ip, success: false } });
      return NextResponse.json({ error: "Code incorrect" }, { status: 401 });
    }

    await prisma.loginAttempt.create({ data: { ip, success: true } });

    const response = NextResponse.json({
      user: { id: user.id, name: user.name, role: user.role },
    });

    response.cookies.set(
      await setSessionCookie(user.id, user.role, parseScreenAccess(user.screenAccess))
    );
    return response;
  } catch (e) {
    return handleApiError(e, "api/auth/login");
  }
}

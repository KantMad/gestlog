import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { signSession, verifySession } from "@/lib/session";

const SESSION_COOKIE = "gestlog_session";

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const payload = await verifySession(token);
  if (!payload) return null;

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.uid, isActive: true },
    });
    return user;
  } catch {
    return null;
  }
}

export async function setSessionCookie(
  userId: string,
  role: string,
  screenAccess: string[] | null
) {
  const value = await signSession(userId, role, screenAccess);
  return {
    name: SESSION_COOKIE,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24, // 24h (= durée de vie du jeton, cf. session.ts)
  };
}

export function clearSessionCookie() {
  return {
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
}

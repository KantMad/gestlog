import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { parseScreenAccess } from "@/lib/screens";

export async function GET() {
  const user = await getSession();

  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      screenAccess: parseScreenAccess(user.screenAccess),
    },
  });
}

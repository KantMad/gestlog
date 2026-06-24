import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { parseScreenAccess } from "@/lib/screens";

// Jamais mis en cache : l'identité courante doit TOUJOURS être fraîche (sinon, après
// un changement de compte, l'ancien utilisateur peut rester affiché).
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function GET() {
  const user = await getSession();

  if (!user) {
    return NextResponse.json({ user: null }, { status: 401, headers: NO_STORE });
  }

  return NextResponse.json(
    {
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        screenAccess: parseScreenAccess(user.screenAccess),
      },
    },
    { headers: NO_STORE }
  );
}

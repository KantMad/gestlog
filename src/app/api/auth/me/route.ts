import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession, setSessionCookie, SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/session";
import { parseScreenAccess } from "@/lib/screens";

// Jamais mis en cache : l'identité courante doit TOUJOURS être fraîche (sinon, après
// un changement de compte, l'ancien utilisateur peut rester affiché).
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" };

/** Deux listes d'écrans sont-elles équivalentes ? (null = tous les écrans) */
function sameAccess(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

export async function GET() {
  const user = await getSession();

  if (!user) {
    return NextResponse.json({ user: null }, { status: 401, headers: NO_STORE });
  }

  const screenAccess = parseScreenAccess(user.screenAccess);

  const response = NextResponse.json(
    { user: { id: user.id, name: user.name, role: user.role, screenAccess } },
    { headers: NO_STORE }
  );

  // ⚠️ Les droits sont figés dans le JETON à la connexion, alors que cette route (et donc
  // le menu) les relit en BASE. Quand un admin modifie les accès de quelqu'un déjà
  // connecté, les deux divergent : le nouvel écran APPARAÎT dans son menu, mais le
  // middleware — qui ne lit que le jeton — le refuse et le renvoie sur son 1er écran
  // autorisé. Symptôme vécu : « je clique sur À vendre, je retombe sur le dashboard ».
  // On réémet donc le cookie dès que le jeton est en retard : plus besoin de se
  // reconnecter, un simple chargement de page suffit.
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const payload = await verifySession(token);
    if (payload && (payload.role !== user.role || !sameAccess(payload.scr, screenAccess))) {
      response.cookies.set(await setSessionCookie(user.id, user.role, screenAccess));
    }
  } catch {
    /* le rafraîchissement est un confort : en cas d'échec, la session reste valable */
  }

  return response;
}

import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { brandsOf } from "@/lib/brand";

export async function GET(request: NextRequest) {
  const seasonId = request.nextUrl.searchParams.get("seasonId");

  if (!seasonId) {
    return NextResponse.json({ error: "seasonId requis" }, { status: 400 });
  }

  try {
    const sessions = await prisma.allocationSession.findMany({
      where: { seasonId },
      include: {
        _count: { select: { lines: true } },
      },
      orderBy: { sessionDate: "desc" },
    });

    // Fournisseur(s) concerné(s) par chaque session : via les produits répartis, rattachés
    // aux commandes fournisseur de LA MÊME saison. Une seule requête pour toutes les
    // sessions (le faire session par session ferait N requêtes).
    const rows = await prisma.$queryRaw<{ sessionId: string; name: string }[]>`
      SELECT DISTINCT al."allocationSessionId" AS "sessionId", s.name AS name
      FROM "AllocationLine" al
      JOIN "AllocationSession" a ON a.id = al."allocationSessionId"
      JOIN "SupplierOrderLine" sol ON sol."productId" = al."productId"
      JOIN "SupplierOrder" so ON so.id = sol."supplierOrderId" AND so."seasonId" = a."seasonId"
      JOIN "Supplier" s ON s.id = so."supplierId"
      WHERE a."seasonId" = ${seasonId}
    `;
    // Marque(s) de chaque session : déduites du PRÉFIXE des références réparties
    // (cf. lib/brand). On ne remonte que les préfixes DISTINCTS par session — inutile de
    // rapatrier toutes les références pour n'en lire que les deux premières lettres.
    const brandRows = await prisma.$queryRaw<{ sessionId: string; prefix: string }[]>`
      SELECT DISTINCT al."allocationSessionId" AS "sessionId",
             UPPER(LEFT(p.reference, 2)) AS prefix
      FROM "AllocationLine" al
      JOIN "AllocationSession" a ON a.id = al."allocationSessionId"
      JOIN "Product" p ON p.id = al."productId"
      WHERE a."seasonId" = ${seasonId}
    `;
    const prefixesBySession = new Map<string, string[]>();
    for (const r of brandRows) {
      const l = prefixesBySession.get(r.sessionId) || [];
      l.push(r.prefix);
      prefixesBySession.set(r.sessionId, l);
    }

    const suppliersBySession = new Map<string, string[]>();
    for (const r of rows) {
      const l = suppliersBySession.get(r.sessionId) || [];
      l.push(r.name);
      suppliersBySession.set(r.sessionId, l);
    }

    const data = sessions.map((s) => ({
      ...s,
      suppliers: (suppliersBySession.get(s.id) || []).sort((a, b) =>
        a.localeCompare(b, "fr", { sensitivity: "base" })
      ),
      brands: brandsOf(prefixesBySession.get(s.id) || []),
    }));

    return NextResponse.json({ data });
  } catch (e) {
    return handleApiError(e, "api/allocation/sessions");
  }
}

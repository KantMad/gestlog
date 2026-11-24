import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Anomalies du contrôle marketplaces marquées « traitées » à la main (GESTLOG-15).
// POST { reference, note } : marque (ou met à jour la note) ; DELETE ?reference= : annule.
// Même permission que l'écran BtoC (préfixe /api/btoc).

const Body = z.object({
  reference: z.string().trim().min(1).max(100),
  note: z.string().trim().min(1, "Une note est obligatoire").max(500),
});

export async function POST(request: NextRequest) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Non connecté" }, { status: 401 });
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Format invalide" }, { status: 400 });
    }
    const { reference, note } = parsed.data;
    const by = user.name || "—";
    await prisma.marketplaceResolution.upsert({
      where: { reference },
      create: { reference, note, resolvedBy: by },
      update: { note, resolvedBy: by, resolvedAt: new Date() },
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleApiError(e, "api/btoc/marketplaces/resolutions");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Non connecté" }, { status: 401 });
    const reference = request.nextUrl.searchParams.get("reference")?.trim();
    if (!reference) return NextResponse.json({ error: "reference manquante" }, { status: 400 });
    await prisma.marketplaceResolution.deleteMany({ where: { reference } });
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleApiError(e, "api/btoc/marketplaces/resolutions");
  }
}

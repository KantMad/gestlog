import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";

export const maxDuration = 60;

// GET — Proxy d'affichage d'un PDF entrepôt (/in/PDF). L'accès est protégé par
// le middleware (écran Livraisons) ; on récupère le binaire via le webhook n8n
// (qui seul a l'accès FTP) puis on le renvoie en application/pdf.
export async function GET(request: NextRequest) {
  try {
    const file = request.nextUrl.searchParams.get("file") || "";
    // Anti-traversée de chemin : nom de fichier PDF simple uniquement.
    if (!/^[\w.\-]+\.pdf$/i.test(file)) {
      return NextResponse.json({ error: "Fichier invalide" }, { status: 400 });
    }

    const key = process.env.SYNC_API_KEY || "";
    const url = `https://centralway.pro/webhook/gestlog-pdf?key=${encodeURIComponent(key)}&file=${encodeURIComponent(file)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(55000) });
    if (!res.ok) {
      return NextResponse.json({ error: "PDF introuvable" }, { status: 404 });
    }
    const data = await res.json();
    if (!data?.b64) {
      return NextResponse.json({ error: "PDF introuvable" }, { status: 404 });
    }

    const buffer = Buffer.from(data.b64, "base64");
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${file}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    return handleApiError(e, "api/shipments/pdf");
  }
}

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { handleApiError, parseBody } from "@/lib/api";

// POST — Lit UNE photo (réduite côté navigateur, JPEG base64) avec Claude et dit si c'est
// une étiquette manuscrite ; si oui, renvoie la référence, le code et le nom de couleur.
// Le renommage et le ZIP se font dans le navigateur : les photos en pleine résolution ne
// quittent jamais le poste. Clé : ANTHROPIC_API_KEY (.env du VPS). Absente → 503.

const BodySchema = z.object({
  image: z.string().min(100).max(8_000_000), // base64, ~1600 px max côté navigateur
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
});

const Reading = z.object({
  is_label: z.boolean(),
  reference: z.string(),
  color_code: z.string(),
  color_name: z.string(),
});

const PROMPT = `Tu tries des photos de vêtements prises dans un atelier.
Certaines photos montrent une ÉTIQUETTE cartonnée avec un texte écrit à la main, sur deux lignes :
- ligne 1 : la référence produit (lettres, chiffres, tiret bas), ex. THTMANT_901
- ligne 2 : un code couleur numérique suivi du nom de la couleur, ex. 209 CARAMEL
Les autres photos montrent le vêtement lui-même (une marque cousue sur le vêtement n'est PAS une étiquette manuscrite).

Réponds :
- is_label : true seulement si la photo montre une étiquette manuscrite de ce type.
- reference, color_code, color_name : le texte lu, en majuscules, recopié exactement (attention : 0 et O, 1 et I, 5 et S, 8 et B ; les références mélangent lettres et chiffres). Chaînes vides si ce n'est pas une étiquette ou si la ligne est absente.`;

export async function POST(request: NextRequest) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "Lecture IA non configurée : la clé ANTHROPIC_API_KEY est absente du serveur." },
        { status: 503 }
      );
    }
    const r = await parseBody(request, BodySchema);
    if ("error" in r) return r.error;

    const client = new Anthropic();
    const message = await client.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      output_config: { effort: "low", format: zodOutputFormat(Reading) },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: r.data.mediaType, data: r.data.image } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });

    if (message.stop_reason === "refusal" || !message.parsed_output) {
      return NextResponse.json({ error: "Photo non lue par l'IA." }, { status: 422 });
    }
    const o = message.parsed_output;
    return NextResponse.json({
      isLabel: o.is_label,
      reference: o.is_label ? o.reference.trim().toUpperCase() : "",
      colorCode: o.is_label ? o.color_code.trim().toUpperCase() : "",
      colorName: o.is_label ? o.color_name.trim().toUpperCase() : "",
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "IA saturée, réessayez dans un instant." }, { status: 429 });
    }
    if (e instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "Clé ANTHROPIC_API_KEY refusée." }, { status: 503 });
    }
    return handleApiError(e, "photos-etiquettes");
  }
}

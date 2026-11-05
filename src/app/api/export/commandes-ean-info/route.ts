import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

// POST — Ce que le référentiel GestLog ajoute à un export TIO « commandes EAN ».
// Body : { references: string[], orderNumbers: string[],
//          eanKeys?: [{ reference, color, size }] }
//   → { coloris, prix, eans, clients, conflitsClient }
//
// ⚠️ Ce que le navigateur envoie, et RIEN D'AUTRE : des références produit, des numéros de
// commande, et éventuellement des triplets référence/couleur/taille. Le fichier déposé
// porte le nom, le genre, l'e-mail et l'adresse de facturation des clients (35 colonnes) —
// il ne quitte PAS le poste de l'exploitant. L'export n'en ressort que l'enseigne et le
// code client, les deux seules identifications demandées.
//
// ⚠️ Accès : la route est sous `/api/export`, donc filtrée par le droit d'écran `/export`
// (cf. lib/screens.ts). Prix de gros et codes clients ne sortent pas de ce périmètre.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    const liste = (v: unknown): string[] =>
      Array.isArray(v)
        ? [
            ...new Set(
              (v as unknown[]).map((x) => String(x ?? "").trim()).filter((x) => x.length > 0)
            ),
          ]
        : [];

    const references = liste(body?.references);
    const orderNumbers = liste(body?.orderNumbers);
    if (references.length === 0) {
      return NextResponse.json({ error: "references requis" }, { status: 400 });
    }

    // Triplets dont l'EAN manque au fichier. Plafonnés : au-delà, c'est que le fichier
    // n'est pas un export EAN, et une requête de 50 000 clés ne l'arrangerait pas.
    const eanKeysBrutes: { reference: string; color: string; size: string }[] = Array.isArray(
      body?.eanKeys
    )
      ? (body.eanKeys as unknown[])
          .map((k) => {
            const o = (k ?? {}) as Record<string, unknown>;
            return {
              reference: String(o.reference ?? "").trim(),
              color: String(o.color ?? "").trim(),
              size: String(o.size ?? "").trim(),
            };
          })
          .filter((k) => k.reference && k.size)
      : [];
    const eanKeys = eanKeysBrutes.slice(0, 20000);

    const [coloris, eans, commandes] = await Promise.all([
      // Un coloris par (référence, couleur) : libellé couleur, catégorie, sous-catégorie.
      // Les prix sont portés par le PRODUIT dans TIO, mais stockés sur chaque ligne
      // `Product` (une par coloris) — d'où la lecture séparée ci-dessous.
      prisma.$queryRawUnsafe<
        {
          reference: string;
          colorCode: string | null;
          colorLabel: string | null;
          category: string | null;
          subCategory: string | null;
        }[]
      >(
        `SELECT p."reference"                       AS reference,
                COALESCE(p."colorCode", p."color")  AS "colorCode",
                p."colorLabel"                      AS "colorLabel",
                p."category"                        AS category,
                p."subCategory"                     AS "subCategory"
           FROM "Product" p
          WHERE p."reference" = ANY($1::text[])`,
        references
      ),
      eanKeys.length > 0
        ? prisma.$queryRawUnsafe<{ reference: string; color: string; size: string; ean: string }[]>(
            `SELECT e."reference", e."color", e."size", e."ean"
               FROM "ProductSizeEan" e
               JOIN unnest($1::text[], $2::text[], $3::text[]) AS k(reference, color, size)
                 ON lower(btrim(k.reference)) = lower(btrim(e."reference"))
                AND lower(btrim(k.size))      = lower(btrim(e."size"))
                AND (k.color = '' OR lower(btrim(k.color)) = lower(btrim(e."color")))`,
            eanKeys.map((k) => k.reference),
            eanKeys.map((k) => k.color),
            eanKeys.map((k) => k.size)
          )
        : Promise.resolve([]),
      orderNumbers.length > 0
        ? prisma.$queryRawUnsafe<{ orderNumber: string; code: string; name: string }[]>(
            // La commande est retrouvée par son numéro OU par son numéro TIO : l'export
            // porte « IS-455405299095 », que GestLog range dans les deux champs selon la
            // source (TIO ou Texas).
            `SELECT co."orderNumber" AS "orderNumber", cl."code" AS code, cl."name" AS name
               FROM "ClientOrder" co
               JOIN "Client" cl ON cl.id = co."clientId"
              WHERE co."orderNumber" = ANY($1::text[])
                 OR co."tioOrderNumber" = ANY($1::text[])
              UNION
             SELECT co."tioOrderNumber" AS "orderNumber", cl."code" AS code, cl."name" AS name
               FROM "ClientOrder" co
               JOIN "Client" cl ON cl.id = co."clientId"
              WHERE co."tioOrderNumber" = ANY($1::text[])`,
            orderNumbers
          )
        : Promise.resolve([]),
    ]);

    // Prix catalogue par RÉFÉRENCE : les coloris d'une même référence partagent les prix
    // TIO, mais certains coloris les ont à NULL (2 des 16 références mesurées le
    // 29/09/2026). On retient donc la première valeur renseignée, coloris par coloris.
    const prixParRef = new Map<string, { salePrice: number | null; costPrice: number | null }>();
    const prixRows = await prisma.$queryRawUnsafe<
      { reference: string; salePrice: number | null; costPrice: number | null }[]
    >(
      `SELECT DISTINCT ON (p."reference")
              p."reference" AS reference, p."salePrice" AS "salePrice", p."costPrice" AS "costPrice"
         FROM "Product" p
        WHERE p."reference" = ANY($1::text[])
        ORDER BY p."reference",
                 (p."salePrice" IS NOT NULL) DESC,
                 (p."costPrice" IS NOT NULL) DESC,
                 p."salePrice" DESC NULLS LAST`,
      references
    );
    for (const r of prixRows) prixParRef.set(r.reference, { salePrice: r.salePrice, costPrice: r.costPrice });

    // Un même numéro de commande rattaché à DEUX clients (doublon de saison, fiche
    // boutique dupliquée) : on n'en invente pas un. Le premier par ordre alphabétique est
    // retenu, et le conflit est remonté à l'écran plutôt que tu.
    const parCommande = new Map<string, Set<string>>();
    for (const c of commandes) {
      if (!c.orderNumber) continue;
      const s = parCommande.get(c.orderNumber) ?? new Set<string>();
      s.add(c.code);
      parCommande.set(c.orderNumber, s);
    }
    const clients: { orderNumber: string; code: string }[] = [];
    const conflitsClient: { orderNumber: string; codes: string[] }[] = [];
    for (const [orderNumber, codes] of parCommande) {
      const tries = [...codes].sort();
      clients.push({ orderNumber, code: tries[0] });
      if (tries.length > 1) conflitsClient.push({ orderNumber, codes: tries });
    }

    return NextResponse.json({
      data: {
        coloris,
        prix: [...prixParRef].map(([reference, p]) => ({ reference, ...p })),
        eans,
        clients,
        conflitsClient,
        // Un plafond atteint est dit, jamais déguisé en résultat complet.
        eanKeysIgnorees: Math.max(0, eanKeysBrutes.length - eanKeys.length),
      },
    });
  } catch (e) {
    return handleApiError(e, "api/export/commandes-ean-info");
  }
}

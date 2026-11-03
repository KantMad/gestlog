import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { classifyQuery, sortSizesByScale } from "@/lib/ean-search";

export const maxDuration = 30;

// GET /api/recherche-ean?q=… — recherche produit ↔ code-barres, dans les deux sens.
//
// La saisie est interprétée par `classifyQuery` (testé) : EAN-13 complet, fragment de
// code-barres, ou texte (référence, nom, couleur). Quel que soit le point d'entrée, la
// réponse a la MÊME forme : des groupes (référence × coloris) portant la fiche produit et
// TOUTES leurs tailles avec leur EAN. Scanner un code montre donc aussi les tailles
// voisines — c'est ce qu'on veut en entrepôt.
//
// ⚠️ Un produit SANS aucun EAN reste affiché (tailles vides) : c'est précisément le trou
// qu'on cherche quand un scan ne donne rien.

const MAX_GROUPES = 60;
// 🔴 Plafond de la recherche TEXTE. Un code couleur comme « 752 » (Bleu marine) est porté
// par plus de 500 coloris : on s'arrête là et on le DIT, au lieu de laisser croire que
// 500 est le compte exact.
const PLAFOND = 500;

interface Groupe {
  reference: string;
  color: string;
  colorCode: string | null;
  colorLabel: string | null;
  label: string | null;
  category: string | null;
  subCategory: string | null;
  salePrice: number | null;
  sizeScale: string | null;
  originCountry: string | null;
  tailles: { size: string; ean: string; matched: boolean; stock: number }[];
}

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get("q") || "";
    const parsed = classifyQuery(q);
    if (parsed.kind === "vide") {
      return NextResponse.json({ data: { kind: parsed.kind, groupes: [], totalGroupes: 0, eansTrouves: 0 } });
    }

    // 1) Quels couples (référence, coloris) correspondent, et quels EAN précisément ?
    let paires: { reference: string; color: string }[] = [];
    let eansTrouves: string[] = [];

    if (parsed.kind === "ean" || parsed.kind === "ean-partiel") {
      const motif = parsed.kind === "ean" ? parsed.value : `%${parsed.value}%`;
      const rows = await prisma.$queryRawUnsafe<{ reference: string; color: string; ean: string }[]>(
        `SELECT DISTINCT e."reference", e."color", e."ean"
           FROM "ProductSizeEan" e
          WHERE e."ean" ${parsed.kind === "ean" ? "=" : "LIKE"} $1
          LIMIT ${PLAFOND + 1}`,
        motif
      );
      eansTrouves = rows.map((r) => r.ean);
      paires = dedoublonner(rows);
    } else {
      // Texte : référence, code ou nom de couleur, désignation. Le code couleur « 752 »
      // doit matcher EXACTEMENT, sinon « 752 » ressortirait sur tout EAN le contenant.
      const like = `%${parsed.value}%`;
      const rows = await prisma.$queryRawUnsafe<{ reference: string; color: string }[]>(
        `SELECT DISTINCT p."reference", p."color"
           FROM "Product" p
          WHERE p."reference" ILIKE $1
             OR p."label" ILIKE $1
             OR p."colorLabel" ILIKE $1
             OR p."color" = $2
             OR p."colorCode" = $2
          LIMIT ${PLAFOND + 1}`,
        like,
        parsed.value.trim()
      );
      paires = dedoublonner(rows);
    }

    // Au-delà du plafond on ne connaît plus le compte exact : on le signale.
    const plafondAtteint = paires.length > PLAFOND;
    if (plafondAtteint) paires = paires.slice(0, PLAFOND);
    const totalGroupes = paires.length;
    if (totalGroupes === 0) {
      return NextResponse.json({
        data: { kind: parsed.kind, eanValide: parsed.eanValide, groupes: [], totalGroupes: 0, eansTrouves: 0 },
      });
    }
    const retenues = paires.slice(0, MAX_GROUPES);

    // 2) Fiche produit + TOUTES les tailles de chaque couple retenu.
    const refs = retenues.map((p) => p.reference);
    const cols = retenues.map((p) => p.color);
    const produits = await prisma.$queryRawUnsafe<
      {
        reference: string; color: string; colorCode: string | null; colorLabel: string | null;
        label: string | null; category: string | null; subCategory: string | null;
        salePrice: number | null; sizeScale: string | null; originCountry: string | null;
        size: string | null; ean: string | null; stock: number | null;
      }[]
    >(
      `SELECT p."reference", p."color", p."colorCode", p."colorLabel", p."label",
              p."category", p."subCategory", p."salePrice", p."sizeScale", p."originCountry",
              e."size", e."ean",
              COALESCE((s."quantitiesBySize"::jsonb ->> e."size")::int, 0) AS stock
         FROM "Product" p
         LEFT JOIN "ProductSizeEan" e
                ON e."reference" = p."reference" AND e."color" = p."color"
         LEFT JOIN "StockEntry" s ON s."productId" = p."id"
         -- Deux tableaux parallèles dépliés ENSEMBLE (unnest à deux arguments) plutôt
         -- qu'un « IN (SELECT unnest(), unnest()) » : même résultat ici, mais la forme
         -- jointe est explicite et ne dépend pas de l'évaluation en lockstep des SRF.
         JOIN unnest($1::text[], $2::text[]) AS k(reference, color)
              ON k.reference = p."reference" AND k.color = p."color"`,
      refs,
      cols
    );

    const trouves = new Set(eansTrouves);
    const parCouple = new Map<string, Groupe>();
    for (const r of produits) {
      const cle = `${r.reference}__${r.color}`;
      let g = parCouple.get(cle);
      if (!g) {
        g = {
          reference: r.reference, color: r.color, colorCode: r.colorCode, colorLabel: r.colorLabel,
          label: r.label, category: r.category, subCategory: r.subCategory,
          salePrice: r.salePrice, sizeScale: r.sizeScale, originCountry: r.originCountry,
          tailles: [],
        };
        parCouple.set(cle, g);
      }
      if (r.size && r.ean) {
        g.tailles.push({
          size: r.size, ean: r.ean, matched: trouves.has(r.ean), stock: Number(r.stock) || 0,
        });
      }
    }

    const groupes = [...parCouple.values()].map((g) => ({
      ...g,
      tailles: sortSizesByScale(g.tailles, g.sizeScale),
    }));
    // Les coloris portant l'EAN cherché d'abord : c'est la réponse à la question posée.
    groupes.sort((a, b) => {
      const ma = a.tailles.some((t) => t.matched) ? 0 : 1;
      const mb = b.tailles.some((t) => t.matched) ? 0 : 1;
      if (ma !== mb) return ma - mb;
      if (a.reference !== b.reference) return a.reference.localeCompare(b.reference);
      return a.color.localeCompare(b.color);
    });

    return NextResponse.json({
      data: {
        kind: parsed.kind,
        eanValide: parsed.eanValide,
        totalGroupes,
        plafondAtteint,
        tronque: totalGroupes > MAX_GROUPES,
        eansTrouves: eansTrouves.length,
        groupes,
      },
    });
  } catch (e) {
    return handleApiError(e, "api/recherche-ean");
  }
}

function dedoublonner(rows: { reference: string; color: string }[]) {
  const vus = new Set<string>();
  const out: { reference: string; color: string }[] = [];
  for (const r of rows) {
    const cle = `${r.reference}__${r.color}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    out.push({ reference: r.reference, color: r.color });
  }
  return out;
}

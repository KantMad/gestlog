import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { resolveOrderSource } from "@/lib/order-source";
import {
  buildCommandesProduits,
  prixCommandeExploitable,
  COLONNE_PRIX_CONSEILLE,
  COLONNE_PRIX_WHOLESALE,
  COLONNE_QUANTITE,
  RAISON_PRIX_TEXAS,
  type LigneBase,
} from "@/lib/export-commandes-produits";

export const maxDuration = 120;

// GET — Commandes clients + infos produits et EAN, généré depuis la BASE GestLog.
//
// ?seasonId (requis)  ?catalogId  ?clients=id,id  ?clientMode=include|exclude
// ?orders=IS-123,PO-456  (numéros de commande ; exact sur orderNumber OU tioOrderNumber,
//                         sinon « contient » — pour qu'un numéro recopié sans son préfixe
//                         « IS- » trouve quand même sa commande)
// ?sku=REF1,REF2      ?wholesale=commande|catalogue   ?count=1 (compte seul, sans fichier)
// ?list=orders        (liste des commandes du périmètre, pour le sélecteur de l'écran)
//
// Rend un **classeur xlsx** (une ligne par commande × produit × coloris × taille) ou, avec
// `count=1`, seulement les compteurs — pour que l'écran annonce le volume avant de lancer
// un téléchargement de plusieurs dizaines de milliers de lignes.
//
// ⚠️ Le fichier est construit CÔTÉ SERVEUR. Une saison fait 35 000 à 40 000 lignes de
// sortie : les renvoyer en JSON pour que le navigateur fabrique le classeur ferait passer
// une dizaine de Mo sur le réseau pour rien.
//
// ⚠️ Source des commandes : `resolveOrderSource` (TEXAS dès qu'il existe des commandes
// Texas sur la saison, sinon TIO). Sans ce filtre, AH26 — qui porte 282 commandes TEXAS ET
// 337 commandes TIO — sortirait en DOUBLE.
//
// ⚠️ Quantités COMMANDÉES : les pièces soldées (`cancelledBySize`) ne sont pas déduites, et
// le périmètre est `orderType = COMMANDE` (hors VSS), comme sur les autres écrans B2B.
//
// ⚠️ Accès : route sous `/api/export`, filtrée par le droit d'écran `/export`
// (cf. lib/screens.ts). Prix de gros et codes clients ne sortent pas de ce périmètre.

/** Garde-fou : au-delà, le classeur n'est plus un outil de travail. */
const MAX_LIGNES = 150000;

export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const seasonId = p.get("seasonId");
    if (!seasonId) return NextResponse.json({ error: "Saison requise" }, { status: 400 });

    const catalogId = p.get("catalogId") || null;
    const clientIds = (p.get("clients") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const clientMode = p.get("clientMode") === "exclude" ? "exclude" : "include";
    const skus = (p.get("sku") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    const wholesaleDemande = p.get("wholesale") === "catalogue" ? "catalogue" : "commande";
    const countOnly = p.get("count") === "1";
    const listOrders = p.get("list") === "orders";
    // Numéros saisis OU cochés : les deux arrivent ici, dédoublonnés.
    const orderNumbers = [
      ...new Set(
        (p.get("orders") || "")
          .split(/[,;\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      ),
    ];

    const [season, source] = await Promise.all([
      prisma.season.findUnique({ where: { id: seasonId }, select: { name: true } }),
      resolveOrderSource(seasonId),
    ]);
    if (!season) return NextResponse.json({ error: "Saison introuvable" }, { status: 404 });

    // 🔴 Le prix unitaire reconstruit n'a aucun sens sur une saison servie par TEXAS
    // (cf. lib/export-commandes-produits.ts). Il est refusé, pas corrigé en silence :
    // l'en-tête `X-Wholesale-Forced` et l'onglet Critères le disent.
    const wholesaleForce = wholesaleDemande === "commande" && !prixCommandeExploitable(source);
    const wholesaleSource = wholesaleForce ? "catalogue" : wholesaleDemande;

    // Filtres montés en paramètres numérotés : aucune valeur d'utilisateur n'entre dans le
    // texte SQL.
    const params: unknown[] = [seasonId, source];
    const conds: string[] = [`co."seasonId" = $1`, `co."source" = $2`, `co."orderType" = 'COMMANDE'`];
    if (catalogId) {
      params.push(catalogId);
      conds.push(`co."catalogId" = $${params.length}`);
    }
    if (clientIds.length > 0) {
      params.push(clientIds);
      conds.push(
        clientMode === "exclude"
          ? `co."clientId" <> ALL($${params.length}::text[])`
          : `co."clientId" = ANY($${params.length}::text[])`
      );
    }
    // Périmètre COMMANDE figé ici : le sélecteur de commandes de l'écran doit lister
    // toutes les commandes de la boutique, y compris celles qui ne sont pas (encore)
    // cochées — sinon cocher la première ferait disparaître les autres.
    const condsPerimetre = [...conds];
    const paramsPerimetre = [...params];

    if (listOrders) {
      const rows = await prisma.$queryRawUnsafe<
        {
          orderNumber: string;
          clientName: string | null;
          clientCode: string | null;
          orderDate: Date | null;
          lignes: number;
          pieces: number;
        }[]
      >(
        `SELECT co."orderNumber"                       AS "orderNumber",
                cl."name"                              AS "clientName",
                cl."code"                              AS "clientCode",
                co."orderDate"                         AS "orderDate",
                count(col.id)::int                     AS lignes,
                COALESCE(sum(col."totalQuantity"), 0)::int AS pieces
           FROM "ClientOrder" co
           JOIN "Client" cl ON cl.id = co."clientId"
           LEFT JOIN "ClientOrderLine" col ON col."clientOrderId" = co.id
          WHERE ${condsPerimetre.join(" AND ")}
          GROUP BY co."orderNumber", cl."name", cl."code", co."orderDate"
          HAVING count(col.id) > 0
          ORDER BY cl."name", co."orderNumber"
          LIMIT 3000`,
        ...paramsPerimetre
      );
      // 🔴 « J'ai plusieurs commandes pour cette boutique et je n'en vois qu'une. »
      // L'export est PAR SAISON : les autres commandes de la boutique sont dans d'autres
      // saisons, ou écartées par la source (une saison qui porte TEXAS *et* TIO ne sort
      // qu'en TEXAS, sinon tout compterait deux fois). Le dire est le seul moyen que
      // l'écran ne mente pas par omission. Calculé uniquement quand des boutiques sont
      // explicitement INCLUSES : sans sélection, « 2 287 commandes en Réassort » serait
      // du bruit.
      let autres: { saison: string; source: string; memeSaison: boolean; commandes: number }[] = [];
      if (clientIds.length > 0 && clientMode === "include") {
        autres = await prisma.$queryRawUnsafe<
          { saison: string; source: string; memeSaison: boolean; commandes: number }[]
        >(
          `SELECT s."name" AS saison,
                  co."source" AS source,
                  (co."seasonId" = $1) AS "memeSaison",
                  count(*)::int AS commandes
             FROM "ClientOrder" co
             JOIN "Season" s ON s.id = co."seasonId"
            WHERE co."orderType" = 'COMMANDE'
              AND co."clientId" = ANY($3::text[])
              AND NOT (co."seasonId" = $1 AND co."source" = $2)
              AND EXISTS (SELECT 1 FROM "ClientOrderLine" l WHERE l."clientOrderId" = co.id)
            GROUP BY s."name", co."source", (co."seasonId" = $1)
            ORDER BY count(*) DESC`,
          seasonId,
          source,
          clientIds
        );
      }

      return NextResponse.json({
        data: {
          orders: rows.map((r) => ({
            ...r,
            orderDate: r.orderDate ? r.orderDate.toISOString().slice(0, 10) : null,
          })),
          source,
          seasonName: season.name,
          autres,
        },
      });
    }

    // 🔴 Un numéro de commande est recopié à la main, d'un e-mail ou d'un BL. On accepte
    // donc l'écriture exacte (sur `orderNumber` comme sur `tioOrderNumber`, la casse en
    // moins) ET le « contient » : « 455405299095 » retrouve « IS-455405299095 ». Un numéro
    // qui ne correspond à rien n'est pas ignoré en silence — il est compté et renvoyé.
    if (orderNumbers.length > 0) {
      params.push(orderNumbers);
      const i = params.length;
      conds.push(
        `EXISTS (SELECT 1 FROM unnest($${i}::text[]) AS o(v)
                  WHERE upper(co."orderNumber") = upper(o.v)
                     OR upper(COALESCE(co."tioOrderNumber", '')) = upper(o.v)
                     OR upper(co."orderNumber") LIKE '%' || upper(o.v) || '%'
                     OR upper(COALESCE(co."tioOrderNumber", '')) LIKE '%' || upper(o.v) || '%')`
      );
    }
    // Un SKU saisi vaut pour la référence seule ou pour « RÉFÉRENCE_COLORIS » : les deux
    // écritures circulent dans les fichiers métier.
    if (skus.length > 0) {
      const refs = skus.map((s) => s.split(/[_-]/)[0]);
      params.push(skus);
      const iSku = params.length;
      params.push(refs);
      const iRef = params.length;
      conds.push(
        `(upper(p."reference") = ANY($${iRef}::text[])
          OR upper(p."reference" || '_' || COALESCE(p."colorCode", p."color")) = ANY($${iSku}::text[])
          OR EXISTS (SELECT 1 FROM unnest($${iSku}::text[]) AS s(v)
                      WHERE upper(p."reference") LIKE s.v || '%'))`
      );
    }

    const where = conds.join(" AND ");

    // Numéros saisis sans correspondance : une faute de frappe ne doit pas rendre un
    // fichier vide sans explication.
    const inconnus =
      orderNumbers.length > 0
        ? (
            await prisma.$queryRawUnsafe<{ v: string }[]>(
              `SELECT o.v
                 FROM unnest($${paramsPerimetre.length + 1}::text[]) AS o(v)
                WHERE NOT EXISTS (
                      SELECT 1 FROM "ClientOrder" co
                       WHERE ${condsPerimetre.join(" AND ")}
                         AND (upper(co."orderNumber") = upper(o.v)
                           OR upper(COALESCE(co."tioOrderNumber", '')) = upper(o.v)
                           OR upper(co."orderNumber") LIKE '%' || upper(o.v) || '%'
                           OR upper(COALESCE(co."tioOrderNumber", '')) LIKE '%' || upper(o.v) || '%'))`,
              ...paramsPerimetre,
              orderNumbers
            )
          ).map((r) => r.v)
        : [];

    // Un numéro introuvable DANS le périmètre peut très bien exister ailleurs : autre
    // saison, ou source écartée. « Introuvable » tout court enverrait chercher une faute
    // de frappe qui n'existe pas.
    const ailleurs =
      inconnus.length > 0
        ? await prisma.$queryRawUnsafe<{ numero: string; saison: string; source: string }[]>(
            `SELECT DISTINCT o.v AS numero, s."name" AS saison, co."source" AS source
               FROM unnest($1::text[]) AS o(v)
               JOIN "ClientOrder" co
                 ON upper(co."orderNumber") = upper(o.v)
                 OR upper(COALESCE(co."tioOrderNumber", '')) = upper(o.v)
                 OR upper(co."orderNumber") LIKE '%' || upper(o.v) || '%'
                 OR upper(COALESCE(co."tioOrderNumber", '')) LIKE '%' || upper(o.v) || '%'
               JOIN "Season" s ON s.id = co."seasonId"
              WHERE co."orderType" = 'COMMANDE'
              ORDER BY o.v, s."name"`,
            inconnus
          )
        : [];

    // 🔴 `quantitiesBySize` est un JSON stocké en texte : `{"S":1,"M":2}`. Une ligne de
    // base vaut donc plusieurs lignes d'export, éclatées ici par `jsonb_each`.
    // `#>> '{}'` extrait la valeur en texte qu'elle soit un nombre JSON ou une chaîne.
    const from = `
      FROM "ClientOrderLine" col
      JOIN "ClientOrder" co ON co.id = col."clientOrderId"
      JOIN "Client" cl ON cl.id = co."clientId"
      JOIN "Product" p ON p.id = col."productId"
      CROSS JOIN LATERAL jsonb_each(col."quantitiesBySize"::jsonb) AS kv(key, value)`;
    // L'EAN est joint seulement pour le fichier : le comptage n'en a pas besoin, et la
    // jointure est ce qui coûte.
    const joinEan = `
      LEFT JOIN "ProductSizeEan" e
             ON e."reference" = p."reference"
            AND e."color"     = p."color"
            AND e."size"      = kv.key`;
    // Une taille à 0 n'a pas été commandée : écartée ici, pas plus loin.
    const filtre = `
     WHERE ${where}
       AND COALESCE((kv.value #>> '{}')::numeric, 0) > 0`;

    if (countOnly) {
      const [c] = await prisma.$queryRawUnsafe<
        { lignes: number; pieces: number; commandes: number; references: number }[]
      >(
        `SELECT count(*)::int AS lignes,
                COALESCE(sum((kv.value #>> '{}')::numeric), 0)::int AS pieces,
                count(DISTINCT co."orderNumber")::int AS commandes,
                count(DISTINCT p."reference")::int AS references
         ${from} ${filtre}`,
        ...params
      );
      return NextResponse.json({
        data: {
          ...c,
          source,
          seasonName: season.name,
          plafond: MAX_LIGNES,
          prixCommandeExploitable: prixCommandeExploitable(source),
          raisonPrix: prixCommandeExploitable(source) ? null : RAISON_PRIX_TEXAS,
          numerosInconnus: inconnus,
          numerosAilleurs: ailleurs,
        },
      });
    }

    const rows = await prisma.$queryRawUnsafe<
      (Omit<LigneBase, "quantity" | "unitNet" | "costPrice" | "salePrice"> & {
        quantity: number;
        unitNet: string | number | null;
        costPrice: number | null;
        salePrice: number | null;
      })[]
    >(
      `SELECT co."orderNumber"                      AS "orderNumber",
              cl."code"                             AS "clientCode",
              cl."name"                             AS "clientName",
              p."reference"                         AS reference,
              p."label"                             AS label,
              COALESCE(p."colorCode", p."color")    AS "colorCode",
              p."colorLabel"                        AS "colorLabel",
              p."sizeScale"                         AS "sizeScale",
              kv.key                                AS size,
              ((kv.value #>> '{}')::numeric)::int   AS quantity,
              p."category"                          AS category,
              p."subCategory"                       AS "subCategory",
              CASE WHEN col."totalQuantity" > 0 AND col."amount" > 0
                   THEN round((col."amount" / col."totalQuantity")::numeric, 2) END AS "unitNet",
              p."costPrice"                         AS "costPrice",
              p."salePrice"                         AS "salePrice",
              e."ean"                               AS ean
       ${from} ${joinEan} ${filtre}
       ORDER BY co."orderNumber", p."reference", COALESCE(p."colorCode", p."color")
       LIMIT ${MAX_LIGNES + 1}`,
      ...params
    );

    const plafondAtteint = rows.length > MAX_LIGNES;
    const lignes: LigneBase[] = rows.slice(0, MAX_LIGNES).map((r) => ({
      ...r,
      // `numeric` revient en chaîne du driver : converti ici, sinon « 32.99 » finirait en
      // texte dans une colonne que l'on veut sommable.
      unitNet: r.unitNet === null ? null : Number(r.unitNet),
    }));

    const out = buildCommandesProduits(lignes, { wholesaleSource });

    if (out.rows.length === 0) {
      return NextResponse.json(
        {
          error:
            inconnus.length === 0
              ? "Aucune ligne pour cette sélection"
              : ailleurs.length > 0
                ? `Hors de cette sélection : ${ailleurs
                    .map((a) => `${a.numero} est en ${a.saison} (${a.source})`)
                    .join(", ")}`
                : `Aucune commande ne correspond à : ${inconnus.join(", ")}`,
          data: {
            source,
            seasonName: season.name,
            numerosInconnus: inconnus,
            numerosAilleurs: ailleurs,
          },
        },
        { status: 404 }
      );
    }

    const ws = XLSX.utils.aoa_to_sheet([out.header, ...out.rows]);
    ws["!cols"] = [15, 14, 32, 18, 11, 8, 11, 20, 20, 14, 16, 20, 13, 26].map((wch) => ({ wch }));
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: out.rows.length, c: out.header.length - 1 },
      }),
    };
    // Formats : euros sur les deux prix, entier sur la quantité. L'EAN n'est PAS touché —
    // il reste une chaîne, sinon Excel l'afficherait « 3,66525E+12 ».
    for (let r = 1; r <= out.rows.length; r++) {
      for (const c of [COLONNE_PRIX_WHOLESALE, COLONNE_PRIX_CONSEILLE]) {
        const adr = XLSX.utils.encode_cell({ r, c });
        if (ws[adr] && typeof ws[adr].v === "number") ws[adr].z = '#,##0.00\\ "€"';
      }
      const adrQ = XLSX.utils.encode_cell({ r, c: COLONNE_QUANTITE });
      if (ws[adrQ]) ws[adrQ].z = "#,##0";
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Commandes");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        { Critère: "Saison", Valeur: season.name },
        {
          Critère: "Source des commandes",
          Valeur:
            source === "TEXAS"
              ? "TEXAS (ERP) — les commandes TIO de la saison sont exclues pour ne pas doubler"
              : "TIO (prise de commande)",
        },
        { Critère: "Périmètre", Valeur: "orderType = COMMANDE (hors VSS)" },
        { Critère: "Catalogue", Valeur: catalogId ? catalogId : "tous" },
        {
          Critère: "Boutiques",
          Valeur:
            clientIds.length === 0
              ? "toutes"
              : `${clientIds.length} ${clientMode === "exclude" ? "exclue(s)" : "incluse(s)"}`,
        },
        {
          Critère: "Commandes filtrées",
          Valeur: orderNumbers.length === 0 ? "toutes" : orderNumbers.join(", "),
        },
        ...(inconnus.length > 0
          ? [{ Critère: "Numéros saisis sans correspondance", Valeur: inconnus.join(", ") }]
          : []),
        ...(ailleurs.length > 0
          ? [
              {
                Critère: "Ces numéros existent ailleurs",
                Valeur: ailleurs.map((a) => `${a.numero} → ${a.saison} / ${a.source}`).join(" ; "),
              },
            ]
          : []),
        { Critère: "Références filtrées", Valeur: skus.length === 0 ? "toutes" : skus.join(", ") },
        { Critère: "Lignes", Valeur: out.rows.length },
        { Critère: "Pièces commandées", Valeur: out.pieces },
        {
          Critère: "Quantités",
          Valeur: "COMMANDÉES — les pièces soldées (cancelledBySize) ne sont pas déduites",
        },
        { Critère: "Références distinctes", Valeur: out.references.length },
        { Critère: "Commandes distinctes", Valeur: out.commandes.length },
        { Critère: "Boutiques distinctes", Valeur: out.enseignes.length },
        {
          Critère: "Prix wholesale",
          Valeur:
            wholesaleSource === "commande"
              ? "Prix unitaire net de la commande, reconstruit : ClientOrderLine.amount / totalQuantity"
              : "Product.costPrice — tarif de gros du catalogue, hors remise de commande",
        },
        ...(wholesaleForce
          ? [{ Critère: "Prix de la commande écarté", Valeur: RAISON_PRIX_TEXAS }]
          : []),
        { Critère: "Montant wholesale total", Valeur: out.totalWholesale },
        { Critère: "Prix de vente conseillé", Valeur: "Product.salePrice (TIO, catalogue 209)" },
        { Critère: "Lignes sans prix wholesale", Valeur: out.sansPrixWholesale },
        { Critère: "Lignes sans prix conseillé", Valeur: out.sansPrixConseille },
        { Critère: "Lignes sans EAN", Valeur: out.sansEan },
        { Critère: "EAN", Valeur: "ProductSizeEan (référence × couleur × taille)" },
        { Critère: "Ordre des tailles", Valeur: "grille du produit (Product.sizeScale)" },
        { Critère: "Généré le", Valeur: new Date().toISOString() },
      ]),
      "Critères"
    );

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true });
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="commandes-produits-ean_${season.name}.xlsx"`,
        "Cache-Control": "no-store",
        // Diagnostics lus par l'écran : un fichier correct peut quand même mériter un avertissement.
        "X-Rows": String(out.rows.length),
        "X-Pieces": String(out.pieces),
        "X-Orders": String(out.commandes.length),
        "X-Refs": String(out.references.length),
        "X-Shops": String(out.enseignes.length),
        "X-Total-Wholesale": String(out.totalWholesale),
        "X-No-Ean": String(out.sansEan),
        "X-No-Wholesale": String(out.sansPrixWholesale),
        "X-No-Retail": String(out.sansPrixConseille),
        "X-No-Retail-Refs": String(out.referencesSansPrixConseille.length),
        "X-Source": source,
        "X-Wholesale": wholesaleSource,
        "X-Wholesale-Forced": wholesaleForce ? "1" : "0",
        "X-Unknown-Orders": String(inconnus.length),
        "X-Capped": plafondAtteint ? "1" : "0",
      },
    });
  } catch (e) {
    return handleApiError(e, "api/export/commandes-produits");
  }
}

import { prisma } from "@/lib/prisma";
import { stringifySizeQuantities, sumQuantities } from "@/lib/utils";
import {
  parseMcsStatgen,
  parseMcsPackingList,
  pickReceptionSizes,
  parseMcsClientOrders,
  parseTexasClientOrders,
} from "./mcs-format";
import {
  loadColorEquivalences,
  resolveProductWithEquivalence,
  type EquivIndex,
} from "./color-equivalence";

export interface ImportResult {
  imported: number;
  errors: string[];
  created?: number; // produits créés depuis le fichier (absents du référentiel)
}

// Recherche un produit du référentiel par (référence, code couleur), avec tolérance
// sur le zéro initial du code (la PL lit "001" comme nombre 1 ; le référentiel garde "001")
// PUIS via les équivalences de code couleur (ex. « SSS » des fichiers → « 000 » du
// référentiel, le produit étant alors re-clé en SSS). Cf. color-equivalence.ts.
async function findProduct(reference: string, colorCode: string, equivs: EquivIndex) {
  const { product } = await resolveProductWithEquivalence(reference, colorCode, equivs);
  return product;
}

// ----------------------------------------------- Commande fournisseur (StatGen)
// Le fichier porte OBLIGATOIREMENT le n° de commande et le fournisseur (colonnes
// « N° commande PF fournisseur » et « Fiche/Code fournisseur »). Un fichier peut
// regrouper plusieurs commandes / fournisseurs → on crée UNE commande par n°.
export async function importMcsSupplierOrders(
  buffer: ArrayBuffer,
  seasonId: string,
  importLogId?: string
): Promise<ImportResult> {
  const lines = parseMcsStatgen(buffer);
  const errors: string[] = [];
  const equivs = await loadColorEquivalences();
  let imported = 0;
  let createdProducts = 0;
  if (lines.length === 0) {
    return { imported, errors: ["Aucune ligne détectée (format commande fournisseur MCS)."] };
  }

  // Le n° de commande est requis : sans colonne « N° commande » exploitable, on refuse.
  const withOrder = lines.filter((l) => l.orderNumber);
  if (withOrder.length === 0) {
    return {
      imported,
      errors: [
        "N° de commande introuvable dans le fichier (colonne « N° commande PF fournisseur » attendue).",
      ],
    };
  }
  const skippedNoOrder = lines.length - withOrder.length;
  if (skippedNoOrder > 0) {
    errors.push(`${skippedNoOrder} ligne(s) ignorée(s) : n° de commande vide.`);
  }

  // groupe par numéro de commande (un fichier peut en contenir plusieurs)
  const byOrder = new Map<string, typeof lines>();
  for (const l of withOrder) {
    if (!byOrder.has(l.orderNumber)) byOrder.set(l.orderNumber, []);
    byOrder.get(l.orderNumber)!.push(l);
  }

  for (const [orderNumber, rows] of byOrder) {
    // Cloisonnement saison : une commande fournisseur ne peut exister que sur UNE
    // saison. Si ce n° existe déjà dans une AUTRE saison, on refuse (pas de doublon
    // inter-saison) — il faut d'abord la supprimer de l'autre saison.
    const elsewhere = await prisma.supplierOrder.findFirst({
      where: { orderNumber, seasonId: { not: seasonId } },
      include: { season: { select: { name: true } } },
    });
    if (elsewhere) {
      errors.push(
        `Commande ${orderNumber} déjà présente en saison « ${elsewhere.season.name} » — une commande ne peut être que sur une saison (import ignoré pour cette commande).`
      );
      continue;
    }

    const supplierCode = rows[0].supplierCode || "INCONNU";
    const supplier = await prisma.supplier.upsert({
      where: { code: supplierCode },
      update: {},
      create: { code: supplierCode, name: supplierCode },
    });
    // Code saison porté par le fichier (colonne « Saison ») — pour l'export réceptions.
    const tioSeason = rows.find((r) => r.season)?.season || null;
    const supplierOrder = await prisma.supplierOrder.upsert({
      where: { orderNumber_seasonId: { orderNumber, seasonId } },
      update: { importLogId, ...(tioSeason ? { tioSeason } : {}) },
      create: { orderNumber, seasonId, supplierId: supplier.id, importLogId, tioSeason },
    });

    const keptProductIds: string[] = [];
    for (const row of rows) {
      let product = await findProduct(row.reference, row.colorCode, equivs);
      // Produit absent du référentiel → on le CRÉE depuis la commande fournisseur
      // (le fichier fournit la grille de tailles via la légende « gamme »). La synchro
      // TIO (ON CONFLICT reference,color) l'enrichira ensuite (catégorie, prix, EAN…).
      if (!product) {
        if (!row.sizeScale) {
          errors.push(
            `Cmd ${orderNumber} : produit introuvable et grille de tailles inconnue, non créé ${row.reference} / ${row.colorCode}` +
              (row.colorName ? ` (${row.colorName})` : "")
          );
          continue;
        }
        product = await prisma.product.upsert({
          where: { reference_color: { reference: row.reference, color: row.colorCode } },
          update: {},
          create: {
            reference: row.reference,
            color: row.colorCode,
            colorCode: row.colorCode,
            colorLabel: row.colorName || null,
            sizeScale: row.sizeScale,
          },
        });
        createdProducts++;
      }
      // Quantités par taille : privilégie le décodage DEPUIS le fichier (positions
      // absolues de la gamme, correct même quand le coloris démarre à une taille > 1) ;
      // repli sur la grille du produit (positions Q.N) si le fichier ne fournit rien.
      let quantities: Record<string, number>;
      if (row.sizes) {
        quantities = row.sizes;
      } else {
        const scale = product.sizeScale
          ? product.sizeScale.split(",").map((s) => s.trim()).filter(Boolean)
          : [];
        quantities = {};
        for (let i = 0; i < scale.length && i < row.quantities.length; i++) {
          if (row.quantities[i] > 0) quantities[scale[i]] = row.quantities[i];
        }
      }
      if (Object.keys(quantities).length === 0) continue;

      await prisma.supplierOrderLine.upsert({
        where: {
          supplierOrderId_productId: { supplierOrderId: supplierOrder.id, productId: product.id },
        },
        update: {
          quantitiesBySize: stringifySizeQuantities(quantities),
          totalQuantity: sumQuantities(quantities),
        },
        create: {
          supplierOrderId: supplierOrder.id,
          productId: product.id,
          quantitiesBySize: stringifySizeQuantities(quantities),
          totalQuantity: sumQuantities(quantities),
        },
      });
      keptProductIds.push(product.id);
      imported++;
    }

    // purge des lignes périmées (produits absents du fichier ré-importé)
    if (keptProductIds.length > 0) {
      await prisma.supplierOrderLine.deleteMany({
        where: { supplierOrderId: supplierOrder.id, productId: { notIn: keptProductIds } },
      });
    }
  }

  return { imported, errors, created: createdProducts };
}

// ----------------------------------------------- Réception (Packing List)
export async function importMcsReceptions(
  buffer: ArrayBuffer,
  seasonId: string,
  supplierOrderNumber: string,
  receptionNumber: string,
  importLogId?: string
): Promise<ImportResult> {
  const errors: string[] = [];
  let imported = 0;

  const lines = parseMcsPackingList(buffer);
  if (lines.length === 0) {
    return { imported, errors: ["Aucune ligne détectée (format liste de colisage MCS)."] };
  }
  const equivs = await loadColorEquivalences();

  // Résolution des produits (une seule fois) — sert aussi à l'auto-rattachement.
  const resolved: { productId: string; quantities: Record<string, number> }[] = [];
  // Produits non résolus : on ne se contente pas de « introuvable ». On dit COMBIEN de
  // pièces sont ignorées et POURQUOI, en distinguant les deux cas — sinon l'utilisateur ne
  // peut pas savoir s'il s'agit d'une coquille du fournisseur ou d'un référentiel en retard.
  // (Cas réel FW26 MCS TG LOT1 : RMSWET_C012 livré mais jamais commandé — 251 pièces
  // silencieusement absentes de la réception.)
  const skipped: { reference: string; colorCode: string; colorName: string; pieces: number }[] = [];
  for (const line of lines) {
    const product = await findProduct(line.reference, line.colorCode, equivs);
    if (!product) {
      const pieces = Object.values(line.sizes).reduce((s, n) => s + (n > 0 ? n : 0), 0);
      skipped.push({
        reference: line.reference,
        colorCode: line.colorCode,
        colorName: line.colorName || "",
        pieces,
      });
      continue;
    }
    const quantities: Record<string, number> = {};
    // Fichier ambigu (deux lignes de libellés de tailles sur les mêmes colonnes) → la
    // grille du produit tranche entre lettres et numériques.
    for (const [size, q] of Object.entries(pickReceptionSizes(line, product.sizeScale)))
      if (q > 0) quantities[size] = q;
    if (Object.keys(quantities).length === 0) continue;
    resolved.push({ productId: product.id, quantities });
  }
  // Construit, pour chaque produit non résolu, un message qui dit COMBIEN de pièces sont
  // ignorées et POURQUOI. `orderLabel`/`orderedRefs` ne sont connus qu'une fois la commande
  // fournisseur rattachée → on rappelle la fonction ensuite pour enrichir le diagnostic.
  const describeSkipped = async (
    orderLabel?: string,
    orderedRefs?: Set<string>
  ): Promise<string[]> => {
    if (skipped.length === 0) return [];
    const refs = [...new Set(skipped.map((s) => s.reference))];
    const known = await prisma.product.findMany({
      where: { reference: { in: refs } },
      select: { reference: true, color: true },
    });
    const colorsByRef = new Map<string, string[]>();
    for (const p of known) {
      const l = colorsByRef.get(p.reference) || [];
      l.push(p.color);
      colorsByRef.set(p.reference, l);
    }
    return skipped.map((s) => {
      const who = `${s.reference} / ${s.colorCode}${s.colorName ? ` (${s.colorName})` : ""}`;
      const head = `${s.pieces} pièce(s) NON importée(s) — ${who} : `;
      const colors = colorsByRef.get(s.reference);
      if (colors && colors.length > 0) {
        // La référence existe : c'est la COULEUR qui ne correspond pas.
        return (
          head +
          `cette référence existe au référentiel mais pas en couleur « ${s.colorCode} » ` +
          `(couleurs connues : ${colors.slice(0, 8).join(", ")}${colors.length > 8 ? "…" : ""}). ` +
          `Vérifiez le code couleur du colisage, ou créez une équivalence de couleur (écran Infos produits).`
        );
      }
      // Référence totalement inconnue : le plus souvent une coquille du colisage, ou un
      // produit livré sans avoir été commandé.
      const notOrdered =
        orderedRefs && !orderedRefs.has(s.reference)
          ? ` Cette référence ne figure PAS dans la commande fournisseur ${orderLabel} : soit le fournisseur a livré un produit non commandé, soit la référence du colisage comporte une erreur.`
          : "";
      return (
        head +
        `référence inconnue du référentiel.${notOrdered} ` +
        `Un produit n'est jamais créé depuis une réception : importez d'abord la commande fournisseur qui le contient (elle, crée les produits manquants).`
      );
    });
  };

  if (resolved.length === 0) {
    const why = await describeSkipped();
    return {
      imported,
      errors: [
        ...errors,
        ...why,
        ...(why.length === 0 ? ["Aucun produit reconnu dans la réception."] : []),
      ],
    };
  }

  // Détermination de la commande fournisseur à rattacher :
  //  1. n° saisi à l'import (prioritaire) ;
  //  2. sinon auto-rattachement : la commande de CETTE saison qui contient le plus de
  //     produits reçus (les fichiers de colisage n'ont pas de n° de commande).
  const orderNum = (supplierOrderNumber || "").trim();
  let supplierOrder: { id: string; supplierId: string } | null = null;
  if (orderNum) {
    supplierOrder = await prisma.supplierOrder.findUnique({
      where: { orderNumber_seasonId: { orderNumber: orderNum, seasonId } },
    });
    if (!supplierOrder) {
      return {
        imported,
        errors: [`Commande fournisseur ${orderNum} introuvable pour cette saison — importez-la d'abord.`],
      };
    }
  } else {
    const productIds = resolved.map((r) => r.productId);
    const solLines = await prisma.supplierOrderLine.findMany({
      where: { productId: { in: productIds }, supplierOrder: { seasonId } },
      select: { supplierOrderId: true },
    });
    if (solLines.length === 0) {
      return {
        imported,
        errors: [
          "Impossible de rattacher automatiquement la réception : aucune commande fournisseur de cette saison ne contient ces produits. Saisissez le n° de commande.",
        ],
      };
    }
    const counts = new Map<string, number>();
    for (const s of solLines) counts.set(s.supplierOrderId, (counts.get(s.supplierOrderId) || 0) + 1);
    const bestId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    supplierOrder = await prisma.supplierOrder.findUnique({ where: { id: bestId } });
    if (!supplierOrder) {
      return { imported, errors: ["Commande fournisseur rattachée introuvable (incohérence)."] };
    }
  }

  const reception = await prisma.supplierReception.create({
    data: {
      receptionNumber,
      supplierOrderId: supplierOrder.id,
      supplierId: supplierOrder.supplierId,
      importLogId,
    },
  });

  for (const { productId, quantities } of resolved) {
    await prisma.receptionLine.create({
      data: {
        supplierReceptionId: reception.id,
        productId,
        quantitiesBySize: stringifySizeQuantities(quantities),
        totalQuantity: sumQuantities(quantities),
      },
    });
    imported++;
  }

  await prisma.supplierOrder.update({
    where: { id: supplierOrder.id },
    data: { status: "PARTIEL" },
  });

  // Diagnostic des produits ignorés, enrichi du contexte « est-ce dans la commande ? ».
  if (skipped.length > 0) {
    const order = await prisma.supplierOrder.findUnique({
      where: { id: supplierOrder.id },
      select: { orderNumber: true, lines: { select: { product: { select: { reference: true } } } } },
    });
    const orderedRefs = new Set((order?.lines || []).map((l) => l.product.reference));
    errors.push(...(await describeSkipped(order?.orderNumber, orderedRefs)));
    const lost = skipped.reduce((s, x) => s + x.pieces, 0);
    errors.unshift(
      `⚠ ${skipped.length} produit(s) du colisage n'ont PAS été importés (${lost} pièce(s) au total) — détail ci-dessous. Le reste de la réception a bien été enregistré.`
    );
  }

  return { imported, errors };
}

// ----------------------------------------------- Commande client (StatGen)
// Optimisé pour les gros fichiers (milliers de lignes / centaines de commandes) :
// produits préchargés en 1 requête, écriture groupée par commande (deleteMany +
// createMany dans une transaction). Préserve les annulations (soldes) au ré-import.
export async function importMcsClientOrders(
  buffer: ArrayBuffer,
  seasonId: string,
  importLogId?: string
): Promise<ImportResult> {
  const lines = parseMcsClientOrders(buffer);
  const errors: string[] = [];
  let imported = 0;
  if (lines.length === 0) {
    return { imported, errors: ["Aucune ligne détectée (format commande client MCS)."] };
  }

  // Préchargement de TOUS les produits référencés (1 requête) → map (réf|couleur).
  const refs = [...new Set(lines.map((l) => l.reference))];
  const products = await prisma.product.findMany({
    where: { reference: { in: refs } },
    select: { id: true, reference: true, color: true, sizeScale: true },
  });
  const pmap = new Map<string, { id: string; sizeScale: string | null }>();
  for (const p of products) pmap.set(`${p.reference}__${p.color}`, p);
  const lookup = (ref: string, code: string) => {
    const cands = [code];
    if (/^\d+$/.test(code)) cands.push(code.padStart(3, "0"), String(parseInt(code, 10)));
    for (const c of cands) {
      const p = pmap.get(`${ref}__${c}`);
      if (p) return p;
    }
    return null;
  };

  // Upsert des clients distincts (1 fois chacun) + ClientSeason.
  const distinctClients = new Map<string, string>(); // code → nom
  for (const l of lines) {
    if (l.clientCode && !distinctClients.has(l.clientCode)) {
      distinctClients.set(l.clientCode, l.clientName || l.clientCode);
    }
  }
  const clientIdByCode = new Map<string, string>();
  for (const [code, name] of distinctClients) {
    const client = await prisma.client.upsert({
      where: { code },
      update: { name },
      create: { code, name },
    });
    clientIdByCode.set(code, client.id);
    await prisma.clientSeason.upsert({
      where: { clientId_seasonId: { clientId: client.id, seasonId } },
      update: {},
      create: { clientId: client.id, seasonId },
    });
  }

  // Groupe par commande.
  const byOrder = new Map<string, typeof lines>();
  for (const l of lines) {
    if (!byOrder.has(l.orderNumber)) byOrder.set(l.orderNumber, []);
    byOrder.get(l.orderNumber)!.push(l);
  }

  const missing = new Map<string, number>(); // combos réf/couleur introuvables (dédupliqués)

  // Cloisonnement saison : une commande client ne peut exister que sur UNE saison.
  // On repère en 1 requête les n° déjà présents dans une AUTRE saison → ignorés.
  const conflicts = await prisma.clientOrder.findMany({
    where: { orderNumber: { in: [...byOrder.keys()] }, seasonId: { not: seasonId } },
    select: { orderNumber: true, season: { select: { name: true } } },
  });
  const conflictMap = new Map(conflicts.map((c) => [c.orderNumber, c.season.name]));

  for (const [orderNumber, rows] of byOrder) {
    if (conflictMap.has(orderNumber)) {
      errors.push(
        `Commande ${orderNumber} déjà présente en saison « ${conflictMap.get(orderNumber)} » — une commande ne peut être que sur une saison (import ignoré).`
      );
      continue;
    }
    const clientCode = rows[0].clientCode || "INCONNU";
    let clientId = clientIdByCode.get(clientCode);
    if (!clientId) {
      const c = await prisma.client.upsert({
        where: { code: clientCode },
        update: {},
        create: { code: clientCode, name: clientCode },
      });
      clientId = c.id;
      clientIdByCode.set(clientCode, clientId);
    }
    const clientOrder = await prisma.clientOrder.upsert({
      where: { orderNumber_seasonId: { orderNumber, seasonId } },
      update: { importLogId, source: "TIO" },
      create: { orderNumber, seasonId, clientId, importLogId, source: "TIO" },
    });

    // Agrège par produit (Q.N → tailles via la grille du produit ; somme si répété).
    const byProduct = new Map<string, Record<string, number>>();
    for (const row of rows) {
      const product = lookup(row.reference, row.colorCode);
      if (!product) {
        const k = `${row.reference} / ${row.colorCode}${row.colorName ? ` (${row.colorName})` : ""}`;
        missing.set(k, (missing.get(k) || 0) + 1);
        continue;
      }
      const scale = product.sizeScale
        ? product.sizeScale.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      let acc = byProduct.get(product.id);
      if (!acc) {
        acc = {};
        byProduct.set(product.id, acc);
      }
      for (let i = 0; i < scale.length && i < row.quantities.length; i++) {
        if (row.quantities[i] > 0) acc[scale[i]] = (acc[scale[i]] || 0) + row.quantities[i];
      }
    }

    // Préserve les annulations (soldes) déjà saisies sur ces lignes (ré-import).
    const existing = await prisma.clientOrderLine.findMany({
      where: { clientOrderId: clientOrder.id },
      select: { productId: true, cancelledBySize: true, cancelledTotal: true, cancelledAt: true, cancelledBy: true },
    });
    const cancMap = new Map(existing.map((e) => [e.productId, e]));

    const data = [...byProduct.entries()]
      .filter(([, q]) => Object.keys(q).length > 0)
      .map(([productId, q]) => {
        const c = cancMap.get(productId);
        return {
          clientOrderId: clientOrder.id,
          productId,
          quantitiesBySize: stringifySizeQuantities(q),
          totalQuantity: sumQuantities(q),
          cancelledBySize: c?.cancelledBySize ?? "{}",
          cancelledTotal: c?.cancelledTotal ?? 0,
          cancelledAt: c?.cancelledAt ?? null,
          cancelledBy: c?.cancelledBy ?? null,
        };
      });

    // Remplace les lignes de la commande (idempotent) en une transaction.
    await prisma.$transaction([
      prisma.clientOrderLine.deleteMany({ where: { clientOrderId: clientOrder.id } }),
      ...(data.length ? [prisma.clientOrderLine.createMany({ data })] : []),
    ]);
    imported += data.length;
  }

  // Erreurs = produits introuvables au référentiel (réf + code couleur), dédupliqués avec
  // compte. Causes usuelles : code couleur divergent fichier/référentiel (→ créer une
  // équivalence couleur) ou produit pas encore synchronisé depuis TIO. Ces lignes sont IGNORÉES.
  const miss = [...missing.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, c] of miss.slice(0, 50)) errors.push(`Produit introuvable : ${k} (${c} ligne${c > 1 ? "s" : ""})`);
  if (miss.length > 50) errors.push(`… et ${miss.length - 50} autres produits introuvables`);

  return { imported, errors };
}

// ----------------------------------------------- Commande client TEXAS (ERP)
// Source de VÉRITÉ (source=TEXAS). Client via code (pas de nom → on n'écrase pas le nom
// existant). Quantités décodées par gamme (line.sizes). Montant net réparti au prorata
// des quantités pour alimenter le CA. Idempotent par commande, annulations préservées.
export async function importTexasClientOrders(
  buffer: ArrayBuffer,
  seasonId: string,
  importLogId?: string
): Promise<ImportResult> {
  const lines = parseTexasClientOrders(buffer);
  const errors: string[] = [];
  let imported = 0;
  if (lines.length === 0) {
    return { imported, errors: ["Aucune ligne détectée (format commande client Texas)."] };
  }

  // Préchargement produits (réf|couleur).
  const refs = [...new Set(lines.map((l) => l.reference))];
  const products = await prisma.product.findMany({
    where: { reference: { in: refs } },
    select: { id: true, reference: true, color: true },
  });
  const pmap = new Map<string, string>();
  for (const p of products) pmap.set(`${p.reference}__${p.color}`, p.id);
  const lookup = (ref: string, code: string): string | null => {
    const cands = [code];
    if (/^\d+$/.test(code)) cands.push(code.padStart(3, "0"), String(parseInt(code, 10)));
    for (const c of cands) {
      const id = pmap.get(`${ref}__${c}`);
      if (id) return id;
    }
    return null;
  };

  // Repli par équivalence de code couleur (ex. SSS → 000, puis re-clé du produit en SSS).
  // Uniquement sur les échecs du cache mémoire, avec mémorisation pour ne pas répéter.
  const equivs = await loadColorEquivalences();
  const missCache = new Map<string, string | null>();
  const resolveId = async (ref: string, code: string): Promise<string | null> => {
    const fast = lookup(ref, code);
    if (fast) return fast;
    const k = `${ref}|${code}`;
    if (missCache.has(k)) return missCache.get(k) ?? null;
    const { product } = await resolveProductWithEquivalence(ref, code, equivs);
    const id = product?.id ?? null;
    missCache.set(k, id);
    // Après bascule, le produit vit sous le code du fichier → chemin rapide ensuite.
    if (id) pmap.set(`${ref}__${code}`, id);
    return id;
  };

  // Clients distincts (upsert par code SANS écraser le nom existant) + ClientSeason.
  const clientIdByCode = new Map<string, string>();
  for (const code of new Set(lines.map((l) => l.clientCode).filter(Boolean))) {
    const client = await prisma.client.upsert({
      where: { code },
      update: {},
      create: { code, name: code },
    });
    clientIdByCode.set(code, client.id);
    await prisma.clientSeason.upsert({
      where: { clientId_seasonId: { clientId: client.id, seasonId } },
      update: {},
      create: { clientId: client.id, seasonId },
    });
  }

  // Groupe par commande.
  const byOrder = new Map<string, typeof lines>();
  for (const l of lines) {
    if (!byOrder.has(l.orderNumber)) byOrder.set(l.orderNumber, []);
    byOrder.get(l.orderNumber)!.push(l);
  }

  // Cloisonnement saison (source TEXAS) : une commande = une saison.
  const conflicts = await prisma.clientOrder.findMany({
    where: { orderNumber: { in: [...byOrder.keys()] }, seasonId: { not: seasonId }, source: "TEXAS" },
    select: { orderNumber: true, season: { select: { name: true } } },
  });
  const conflictMap = new Map(conflicts.map((c) => [c.orderNumber, c.season.name]));

  // Catalogue de vente : il n'existe QUE côté TIO (le sync n8n le renseigne ; l'export Texas
  // n'a pas de colonne catalogue). On le récupère via la « Référence commande client », qui
  // porte le n° de commande TIO — les n° Texas et TIO étant, eux, totalement disjoints.
  // Seules les commandes de catalogue (réf PO-…) matchent ; les réassorts (IS-…) n'ont pas
  // de jumelle TIO et restent sans catalogue, ce qui est correct.
  const tioRefs = [...new Set(lines.map((l) => l.tioOrderNumber).filter(Boolean))];
  const tioOrders = tioRefs.length
    ? await prisma.clientOrder.findMany({
        where: { source: "TIO", seasonId, orderNumber: { in: tioRefs } },
        select: { orderNumber: true, catalogId: true },
      })
    : [];
  const catalogByTioRef = new Map(tioOrders.map((o) => [o.orderNumber, o.catalogId]));

  const missing = new Map<string, number>();

  for (const [orderNumber, rows] of byOrder) {
    if (conflictMap.has(orderNumber)) {
      errors.push(
        `Commande ${orderNumber} déjà présente en saison « ${conflictMap.get(orderNumber)} » — une commande ne peut être que sur une saison (import ignoré).`
      );
      continue;
    }
    const clientCode = rows[0].clientCode || "INCONNU";
    let clientId = clientIdByCode.get(clientCode);
    if (!clientId) {
      const c = await prisma.client.upsert({ where: { code: clientCode }, update: {}, create: { code: clientCode, name: clientCode } });
      clientId = c.id;
      clientIdByCode.set(clientCode, clientId);
    }
    const orderAmount = rows[0].amount || 0;
    const sold = rows.some((r) => r.sold);
    const tioOrderNumber = rows[0].tioOrderNumber || null;
    // undefined (et non null) si la jumelle TIO est introuvable : au ré-import, on ne veut
    // pas effacer un catalogue déjà rattaché parce que la synchro TIO a du retard.
    const catalogId = tioOrderNumber ? catalogByTioRef.get(tioOrderNumber) ?? undefined : undefined;
    const clientOrder = await prisma.clientOrder.upsert({
      where: { orderNumber_seasonId: { orderNumber, seasonId } },
      update: {
        clientId,
        source: "TEXAS",
        status: sold ? "SOLDEE" : "EN_COURS",
        totalAmount: orderAmount,
        importLogId,
        tioOrderNumber,
        ...(catalogId ? { catalogId } : {}),
      },
      create: {
        orderNumber,
        seasonId,
        clientId,
        source: "TEXAS",
        status: sold ? "SOLDEE" : "EN_COURS",
        totalAmount: orderAmount,
        importLogId,
        tioOrderNumber,
        ...(catalogId ? { catalogId } : {}),
      },
    });

    // Agrège les quantités par produit (via line.sizes décodées par gamme).
    const byProduct = new Map<string, Record<string, number>>();
    for (const row of rows) {
      const productId = await resolveId(row.reference, row.colorCode);
      if (!productId) {
        const k = `${row.reference} / ${row.colorCode}${row.colorName ? ` (${row.colorName})` : ""}`;
        missing.set(k, (missing.get(k) || 0) + 1);
        continue;
      }
      const acc = byProduct.get(productId) || {};
      for (const [size, q] of Object.entries(row.sizes || {})) if (q > 0) acc[size] = (acc[size] || 0) + q;
      byProduct.set(productId, acc);
    }

    // Répartition du montant net au prorata des quantités.
    const entries = [...byProduct.entries()].filter(([, q]) => Object.keys(q).length > 0);
    const totalQty = entries.reduce((s, [, q]) => s + sumQuantities(q), 0);

    // Préserve annulations (soldes) déjà saisies au ré-import.
    const existing = await prisma.clientOrderLine.findMany({
      where: { clientOrderId: clientOrder.id },
      select: { productId: true, cancelledBySize: true, cancelledTotal: true, cancelledAt: true, cancelledBy: true },
    });
    const cancMap = new Map(existing.map((e) => [e.productId, e]));

    const data = entries.map(([productId, q]) => {
      const c = cancMap.get(productId);
      const lineQty = sumQuantities(q);
      const amount = totalQty > 0 ? Math.round(((orderAmount * lineQty) / totalQty) * 100) / 100 : 0;
      return {
        clientOrderId: clientOrder.id,
        productId,
        quantitiesBySize: stringifySizeQuantities(q),
        totalQuantity: lineQty,
        amount,
        cancelledBySize: c?.cancelledBySize ?? "{}",
        cancelledTotal: c?.cancelledTotal ?? 0,
        cancelledAt: c?.cancelledAt ?? null,
        cancelledBy: c?.cancelledBy ?? null,
      };
    });

    await prisma.$transaction([
      prisma.clientOrderLine.deleteMany({ where: { clientOrderId: clientOrder.id } }),
      ...(data.length ? [prisma.clientOrderLine.createMany({ data })] : []),
    ]);
    imported += data.length;
  }

  const miss2 = [...missing.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, c] of miss2.slice(0, 50)) errors.push(`Produit introuvable : ${k} (${c} ligne${c > 1 ? "s" : ""})`);
  if (miss2.length > 50) errors.push(`… et ${miss2.length - 50} autres produits introuvables`);

  return { imported, errors };
}

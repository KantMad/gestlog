import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { allocationSimulateSchema } from "@/lib/validators";
import { runAllocation } from "@/lib/allocation/engine";
import { applyImportedAllocation, restrictDemandsToImported } from "@/lib/allocation/imported";
import { resolveOrderSource } from "@/lib/order-source";
import {
  parseSizeQuantities,
  parseSizeScale,
  addQuantities,
  stringifySizeQuantities,
  sumQuantities,
  type SizeQuantities,
} from "@/lib/utils";
import type {
  AllocationInput,
  AllocationDemand,
  AllocationResult,
  ClientConfig,
} from "@/lib/allocation/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = allocationSimulateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { seasonId, catalogId, clientIds, supplierIds, productReferences, orderType, importedAllocation, addProductIds, excludeSessionId } = parsed.data;

    // Source B2B active pour la saison (Texas prioritaire, repli TIO).
    const orderSource = await resolveOrderSource(seasonId);

    // Build filter — restrict by catalog, clients, order type
    const orderWhere: Record<string, unknown> = { seasonId, source: orderSource };
    if (catalogId) {
      orderWhere.catalogId = catalogId;
    }
    if (clientIds && clientIds.length > 0) {
      orderWhere.clientId = { in: clientIds };
    }
    // Default: only COMMANDE (exclude VSS/réassort), unless explicitly "ALL" or "VSS"
    const effectiveOrderType = orderType || "COMMANDE";
    if (effectiveOrderType !== "ALL") {
      orderWhere.orderType = effectiveOrderType;
    }

    const clientOrders = await prisma.clientOrder.findMany({
      where: orderWhere,
      include: {
        lines: { include: { product: true } },
        client: true,
      },
    });

    // Build supplier filter
    const supplierWhere: Record<string, unknown> = { seasonId };
    if (supplierIds && supplierIds.length > 0) {
      supplierWhere.supplierId = { in: supplierIds };
    }

    const supplierOrders = await prisma.supplierOrder.findMany({
      where: supplierWhere,
      include: {
        receptions: { include: { lines: true } },
        lines: true,
      },
    });

    const clientSeasons = await prisma.clientSeason.findMany({
      where: { seasonId, isActive: true },
      include: { client: true },
    });

    // Quand un/des fournisseur(s) sont sélectionnés, on restreint la DEMANDE à
    // leurs produits (commandés OU reçus). Sinon la simulation listerait tous les
    // fournisseurs (les produits des autres apparaissant juste à 0 alloué).
    const supplierProductFilter =
      supplierIds && supplierIds.length > 0 ? new Set<string>() : null;

    // Fournisseur(s) de chaque produit — sert au périmètre de VALIDATION côté écran : on
    // simule sur toute la demande (sinon le stock serait mal réparti) mais on peut ne
    // valider qu'une partie. Un produit peut venir de plusieurs fournisseurs → tableau.
    const supplierIdsByProduct: Record<string, string[]> = {};
    const noteSupplier = (productId: string, supplierId: string) => {
      const l = (supplierIdsByProduct[productId] ||= []);
      if (!l.includes(supplierId)) l.push(supplierId);
    };

    const receivedByProduct = new Map<string, SizeQuantities>();
    for (const so of supplierOrders) {
      for (const line of so.lines) {
        supplierProductFilter?.add(line.productId);
        noteSupplier(line.productId, so.supplierId);
      }
      for (const reception of so.receptions) {
        for (const rl of reception.lines) {
          supplierProductFilter?.add(rl.productId);
          noteSupplier(rl.productId, so.supplierId);
          const qty = parseSizeQuantities(rl.quantitiesBySize);
          const existing = receivedByProduct.get(rl.productId) || {};
          receivedByProduct.set(rl.productId, addQuantities(existing, qty));
        }
      }
    }

    // Échantillons « shipment sample » : pièces prélevées sur ces réceptions pour le contrôle
    // qualité du siège. Elles ne seront JAMAIS livrées → on les retire du DISPONIBLE, sans
    // toucher au reçu (qui reste le fait physique affiché en « Reçu fourn. »).
    const receptionIds = supplierOrders.flatMap((so) => so.receptions.map((r) => r.id));
    const samples = receptionIds.length
      ? await prisma.shipmentSample.findMany({
          where: { supplierReceptionId: { in: receptionIds } },
          select: { productId: true, size: true, quantity: true },
        })
      : [];
    const sampledByProduct: Record<string, SizeQuantities> = {};
    for (const s of samples) {
      if (s.quantity <= 0) continue;
      const m = (sampledByProduct[s.productId] ||= {});
      m[s.size] = (m[s.size] || 0) + s.quantity;
    }

    // Pièces DÉJÀ RÉPARTIES dans des répartitions VALIDÉES de la saison : elles sont
    // engagées auprès des boutiques, on ne peut plus les redistribuer. Sans cette
    // déduction, importer une 2e réception rendait de nouveau disponible le stock de la
    // 1re, déjà réparti et validé.
    // ⚠️ En REPRISE, la session rejouée est exclue : sinon elle se déduirait elle-même et
    // son propre stock paraîtrait consommé.
    const validatedLines = await prisma.allocationLine.findMany({
      where: {
        allocationSession: {
          seasonId,
          status: "VALIDATED",
          ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
        },
      },
      select: { productId: true, allocatedBySize: true },
    });
    const allocatedByProduct: Record<string, SizeQuantities> = {};
    for (const l of validatedLines) {
      const qty = parseSizeQuantities(l.allocatedBySize);
      const m = (allocatedByProduct[l.productId] ||= {});
      for (const [size, n] of Object.entries(qty)) {
        if (n > 0) m[size] = (m[size] || 0) + n;
      }
    }

    const available = new Map<string, SizeQuantities>();
    for (const [productId, qty] of receivedByProduct) {
      const taken = sampledByProduct[productId];
      const used = allocatedByProduct[productId];
      if (!taken && !used) {
        available.set(productId, qty);
        continue;
      }
      // Jamais négatif : ni un prélèvement ni une répartition validée ne peuvent dépasser le
      // reçu (garde-fous côté API), mais une réception corrigée À LA BAISSE après coup
      // pourrait le rendre caduc.
      const net: SizeQuantities = {};
      for (const [size, n] of Object.entries(qty)) {
        const left = n - (taken?.[size] || 0) - (used?.[size] || 0);
        if (left > 0) net[size] = left;
      }
      available.set(productId, net);
    }

    // Build a set of product references to filter (if any)
    const refFilter = productReferences && productReferences.length > 0
      ? new Set(productReferences)
      : null;

    const demands: AllocationDemand[] = [];
    for (const order of clientOrders) {
      for (const line of order.lines) {
        // Skip products not in the reference filter
        if (refFilter && !refFilter.has(line.product.reference)) continue;
        // Skip products not supplied by the selected supplier(s)
        if (supplierProductFilter && !supplierProductFilter.has(line.productId)) continue;
        demands.push({
          clientId: order.clientId,
          clientOrderId: order.id,
          productId: line.productId,
          sizeScale: parseSizeScale(line.product.sizeScale),
          requested: parseSizeQuantities(line.quantitiesBySize),
        });
      }
    }

    const clientConfigs = new Map<string, ClientConfig>();
    for (const cs of clientSeasons) {
      clientConfigs.set(cs.clientId, {
        ranking: cs.ranking,
        maxReductionOrder: cs.maxReductionOrder,
        maxReductionLine: cs.maxReductionLine,
        minDeliveryThreshold: cs.minDeliveryThreshold,
        rotationScore: cs.rotationScore,
      });
    }

    // Build display-name maps for human-readable warnings
    const clientNames = new Map<string, string>();
    for (const cs of clientSeasons) {
      clientNames.set(cs.clientId, cs.client.name);
    }

    const productMap = new Map<
      string,
      { reference: string; color: string; colorLabel: string | null; sizeScale: string }
    >();
    const productNames = new Map<string, string>();
    const clientCodes = new Map<string, string>();
    // Catalogue de chaque commande — même usage : périmètre de validation. null pour les
    // commandes hors catalogue (réassorts, ou jumelle TIO introuvable).
    const catalogIdByOrder: Record<string, string | null> = {};
    for (const order of clientOrders) {
      catalogIdByOrder[order.id] = order.catalogId;
      clientCodes.set(order.clientId, order.client.code);
      for (const line of order.lines) {
        if (!productMap.has(line.productId)) {
          productMap.set(line.productId, {
            reference: line.product.reference,
            color: line.product.color,
            colorLabel: line.product.colorLabel,
            sizeScale: line.product.sizeScale,
          });
          productNames.set(
            line.productId,
            `${line.product.reference} / ${line.product.color}`
          );
        }
      }
    }
    for (const cs of clientSeasons) if (!clientCodes.has(cs.clientId)) clientCodes.set(cs.clientId, cs.client.code);

    const input: AllocationInput = {
      seasonId,
      available,
      demands,
      clientConfigs,
      clientNames,
      productNames,
    };

    // Reprise d'un fichier EAN : le fichier fait autorité, on ne recalcule pas. Tout le
    // reste (commandes, reçus, EAN, rangs…) est chargé normalement ci-dessus → la réponse a
    // exactement la même forme qu'une simulation et l'écran ne fait aucune différence.
    const importWarnings: string[] = [];
    // Produits qu'on PEUT ajouter à une reprise (reçus + demandés + même fournisseur, absents
    // du fichier) → alimente le sélecteur « + Ajouter un produit reçu ». Vide hors reprise.
    let addableProducts: {
      productId: string;
      reference: string;
      color: string;
      colorLabel: string | null;
      totalReceived: number;
    }[] = [];
    let result: AllocationResult;
    if (importedAllocation && importedAllocation.length > 0) {
      // Résolution boutique (par CODE) et produit (référence + couleur, avec équivalences).
      const clientIdByCode = new Map<string, string>();
      for (const cs of clientSeasons) clientIdByCode.set(cs.client.code, cs.clientId);
      const productIdByKey = new Map<string, string>();
      for (const [productId, p] of productMap) productIdByKey.set(`${p.reference}__${p.color}`, productId);

      const allocatedByKey = new Map<string, SizeQuantities>();
      const unknownClients = new Set<string>();
      const unknownProducts = new Set<string>();
      for (const row of importedAllocation) {
        if (row.qty <= 0) continue;
        const clientId = clientIdByCode.get(row.clientCode.trim());
        if (!clientId) {
          unknownClients.add(row.clientCode);
          continue;
        }
        const ref = row.reference.trim();
        const color = row.color.trim();
        const productId =
          productIdByKey.get(`${ref}__${color}`) ??
          // Le fichier peut porter la couleur sans zéros de tête (« 0 » vs « 000 »).
          productIdByKey.get(`${ref}__${color.padStart(3, "0")}`);
        if (!productId) {
          unknownProducts.add(`${ref} / ${color}`);
          continue;
        }
        const key = `${clientId}__${productId}`;
        const cur = allocatedByKey.get(key) || {};
        const size = row.size.trim().toUpperCase();
        cur[size] = (cur[size] || 0) + row.qty;
        allocatedByKey.set(key, cur);
      }
      if (unknownClients.size > 0)
        importWarnings.push(
          `Fichier : ${unknownClients.size} boutique(s) inconnue(s) de cette saison — ignorée(s) : ${[...unknownClients].slice(0, 5).join(", ")}${unknownClients.size > 5 ? "…" : ""}`
        );
      if (unknownProducts.size > 0)
        importWarnings.push(
          `Fichier : ${unknownProducts.size} produit(s) hors périmètre de cette simulation — ignoré(s) : ${[...unknownProducts].slice(0, 5).join(", ")}${unknownProducts.size > 5 ? "…" : ""}`
        );

      // La répartition importée ne doit contenir QUE ce qui est dans le fichier — la reprise
      // reproduit EXACTEMENT la répartition sauvegardée (mêmes boutiques, mêmes produits).
      const importedDemands = restrictDemandsToImported(demands, allocatedByKey);
      const importedResult = applyImportedAllocation({ demands: importedDemands, allocatedByKey, clientConfigs });

      // Produits déjà dans le fichier + fournisseur(s) de la répartition.
      const fileProductIds = new Set([...allocatedByKey.keys()].map((k) => k.split("__")[1]));
      const fileSuppliers = new Set<string>();
      for (const pid of fileProductIds)
        for (const sid of supplierIdsByProduct[pid] || []) fileSuppliers.add(sid);

      // Un produit est AJOUTABLE s'il est reçu (stock > 0), demandé (dans productMap), du/des
      // même(s) fournisseur(s) que la répartition, et pas déjà dans le fichier. On ne l'ajoute
      // JAMAIS tout seul : c'est l'utilisateur qui le choisit (addProductIds).
      const isAddable = (pid: string) =>
        !fileProductIds.has(pid) &&
        sumQuantities(available.get(pid) || {}) > 0 &&
        productMap.has(pid) &&
        (supplierIdsByProduct[pid] || []).some((sid) => fileSuppliers.has(sid));

      const addSet = new Set((addProductIds || []).filter(isAddable));
      const addDemands = demands.filter((d) => addSet.has(d.productId));
      if (addDemands.length > 0) {
        const extra = runAllocation({ ...input, demands: addDemands });
        result = {
          lines: [...importedResult.lines, ...extra.lines],
          warnings: [...importedResult.warnings, ...extra.warnings],
        };
      } else {
        result = importedResult;
      }

      // Produits encore ajoutables (hors ceux déjà ajoutés) → sélecteur de l'écran.
      addableProducts = [...new Set(demands.map((d) => d.productId))]
        .filter((pid) => !addSet.has(pid) && isAddable(pid))
        .map((pid) => {
          const p = productMap.get(pid)!;
          return {
            productId: pid,
            reference: p.reference,
            color: p.color,
            colorLabel: p.colorLabel,
            totalReceived: sumQuantities(available.get(pid) || {}),
          };
        })
        .sort((a, b) => `${a.reference}${a.color}`.localeCompare(`${b.reference}${b.color}`));
    } else {
      result = runAllocation(input);
    }

    const enrichedLines = result.lines.map((line) => ({
      ...line,
      clientName: clientNames.get(line.clientId) || line.clientId,
      clientCode: clientCodes.get(line.clientId) || "",
      productReference: productMap.get(line.productId)?.reference || "",
      productColor: productMap.get(line.productId)?.color || "",
      productColorLabel: productMap.get(line.productId)?.colorLabel || "",
      sizeScale: parseSizeScale(
        productMap.get(line.productId)?.sizeScale || ""
      ),
    }));

    const clientImpacts = new Map<
      string,
      {
        clientId: string;
        clientName: string;
        totalOriginal: number;
        totalAllocated: number;
        totalReduced: number;
        reductionPercent: number;
        lineCount: number;
        reducedLineCount: number;
      }
    >();

    for (const line of enrichedLines) {
      if (!clientImpacts.has(line.clientId)) {
        clientImpacts.set(line.clientId, {
          clientId: line.clientId,
          clientName: line.clientName,
          totalOriginal: 0,
          totalAllocated: 0,
          totalReduced: 0,
          reductionPercent: 0,
          lineCount: 0,
          reducedLineCount: 0,
        });
      }
      const impact = clientImpacts.get(line.clientId)!;
      const origTotal = sumQuantities(line.original);
      const allocTotal = sumQuantities(line.allocated);
      impact.totalOriginal += origTotal;
      impact.totalAllocated += allocTotal;
      impact.totalReduced += origTotal - allocTotal;
      impact.lineCount++;
      if (origTotal > allocTotal) impact.reducedLineCount++;
    }

    for (const impact of clientImpacts.values()) {
      impact.reductionPercent =
        impact.totalOriginal > 0
          ? Math.round((impact.totalReduced / impact.totalOriginal) * 100)
          : 0;
    }

    // Collect unique product references for filter display
    const uniqueRefs = new Set<string>();
    for (const p of productMap.values()) {
      uniqueRefs.add(p.reference);
    }

    // Reçu par produit (pour afficher l'écart demande client / réception fournisseur).
    const receivedOut: Record<string, SizeQuantities> = {};
    for (const [productId, qty] of receivedByProduct) receivedOut[productId] = qty;

    // DISPONIBLE réel = reçu − échantillons − déjà réparti dans d'autres répartitions
    // validées. C'est ce qui doit plafonner les ajustements manuels et le surplus côté
    // écran (le « reçu » seul autoriserait à redistribuer des pièces déjà engagées).
    const availableOut: Record<string, SizeQuantities> = {};
    for (const [productId, qty] of available) availableOut[productId] = qty;

    // Ranking par client (pour départager les arrondis lors de la répartition du surplus).
    const rankingByClient: Record<string, number> = {};
    for (const [id, c] of clientConfigs) rankingByClient[id] = c.ranking;

    // Tailles exclues du surplus, par boutique (réglage GLOBAL du client). La répartition du
    // surplus est calculée côté écran (bouton « Répartir surplus ») → on lui fournit la donnée.
    const excludedSizesByClient: Record<string, string[]> = {};
    for (const cs of clientSeasons) {
      excludedSizesByClient[cs.clientId] = cs.client.surplusExcludedSizes
        ? parseSizeScale(cs.client.surplusExcludedSizes).filter(Boolean)
        : [];
    }

    // EAN par produit et par taille (pour l'export « EAN / quantité »).
    const refs = [...uniqueRefs];
    const eanRows = refs.length
      ? await prisma.productSizeEan.findMany({
          where: { reference: { in: refs } },
          select: { reference: true, color: true, size: true, ean: true },
        })
      : [];
    const eanByKey = new Map<string, string>();
    for (const e of eanRows) eanByKey.set(`${e.reference}__${e.color}__${e.size}`, e.ean);
    const eansByProduct: Record<string, Record<string, string>> = {};
    for (const [productId, p] of productMap) {
      const sizes = parseSizeScale(p.sizeScale);
      const m: Record<string, string> = {};
      for (const size of sizes) {
        const ean = eanByKey.get(`${p.reference}__${p.color}__${size}`);
        if (ean) m[size] = ean;
      }
      eansByProduct[productId] = m;
    }

    return NextResponse.json({
      lines: enrichedLines,
      // Avertissements du moteur + ceux de la reprise de fichier (boutiques/produits inconnus,
      // produits reçus depuis la répartition et ajoutés automatiquement).
      warnings: [...result.warnings, ...importWarnings],
      clientImpacts: Array.from(clientImpacts.values()),
      receivedByProduct: receivedOut,
      availableByProduct: availableOut,
      rankingByClient,
      excludedSizesByClient,
      sampledByProduct,
      // Déjà réparti dans d'AUTRES répartitions validées → déduit du disponible.
      allocatedElsewhereByProduct: allocatedByProduct,
      eansByProduct,
      supplierIdsByProduct,
      addableProducts,
      catalogIdByOrder,
      summary: {
        totalDemands: demands.length,
        totalProducts: new Set(demands.map((d) => d.productId)).size,
        totalClients: clientImpacts.size,
        totalOriginal: Array.from(clientImpacts.values()).reduce(
          (s, c) => s + c.totalOriginal,
          0
        ),
        totalAllocated: Array.from(clientImpacts.values()).reduce(
          (s, c) => s + c.totalAllocated,
          0
        ),
      },
      availableProductRefs: Array.from(uniqueRefs).sort(),
    });
  } catch (e) {
    return handleApiError(e, "api/allocation/simulate");
  }
}

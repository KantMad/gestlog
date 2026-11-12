// Transforme un fichier déposé en lignes normalisées comparables (cf. engine.ts).
//
// ⚠️ Ce module LIT la base (grilles de tailles, équivalences de couleur) mais n'écrit
// RIEN : le contrôle TIO ↔ Texas est une vérification, jamais un import. En particulier
// il n'utilise PAS `resolveProductWithEquivalence`, qui re-clé les produits au passage.

import { prisma } from "@/lib/prisma";
import { parseTexasClientOrders, parseMcsClientOrders } from "@/lib/import/mcs-format";
import {
  detecterFormat, lireFormatLong, lireColorOrders, lireTexasStatgen, decoderTailesTexas,
  texteCsv, LIBELLE_FORMAT, coteDuFormat, type FormatControle,
} from "./formats";

export { LIBELLE_FORMAT, coteDuFormat };
import { sortSizeScale } from "@/lib/size-order";
import { cleCommande, cleCouleur, type Cote, type LigneNormalisee } from "./engine";

export interface FichierAnalyse {
  nom: string;
  format: FormatControle;
  cote: Cote;
  lignes: LigneNormalisee[];
  /** Nombre de lignes dont les tailles n'ont pas pu être décodées (total seul comparable). */
  taillesNonDecodees: number;
  avertissements: string[];
}


/** Côté déduit du format : seul l'export Texas décrit l'ERP. */


const somme = (ns: number[]) => ns.reduce((s, n) => s + n, 0);

/** Variantes tolérées d'un code couleur numérique (« 6 » ↔ « 006 »). */
function candidatsCouleur(code: string): string[] {
  const set = new Set<string>([code]);
  if (/^\d+$/.test(code)) {
    set.add(code.padStart(3, "0"));
    set.add(String(parseInt(code, 10)));
  }
  return [...set];
}

/**
 * Grilles de tailles des produits cités, indexées par `référence__couleur`.
 * Lecture seule, une requête pour les produits + une pour les équivalences.
 */
async function chargerGrilles(references: string[]) {
  const [produits, equivalences] = await Promise.all([
    prisma.product.findMany({
      where: { reference: { in: references } },
      select: { reference: true, color: true, sizeScale: true },
    }),
    prisma.colorEquivalence.findMany({ select: { sourceCode: true, targetCode: true } }),
  ]);

  const grilles = new Map<string, string[]>();
  for (const p of produits) {
    const scale = (p.sizeScale || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    grilles.set(`${p.reference.toUpperCase()}__${p.color.toUpperCase()}`, scale);
  }

  const equivs = new Map<string, string[]>();
  for (const e of equivalences) {
    const k = e.sourceCode.trim().toUpperCase();
    const arr = equivs.get(k) || [];
    arr.push(e.targetCode.trim().toUpperCase());
    equivs.set(k, arr);
  }

  return (reference: string, codeCouleur: string): string[] | null => {
    const ref = reference.toUpperCase().trim();
    const code = codeCouleur.toUpperCase().trim();
    const codes = candidatsCouleur(code);
    for (const cible of equivs.get(code) || []) codes.push(...candidatsCouleur(cible));
    for (const c of codes) {
      const scale = grilles.get(`${ref}__${c}`);
      if (scale && scale.length > 0) return scale;
    }
    return null;
  };
}

/**
 * Grille (triée) de chaque type de taille cité, par code — repli quand le produit lui-même
 * est inconnu du référentiel.
 *
 * 🔴 La grille est **triée** (`sortSizeScale`), PAS prise dans l'ordre des positions TIO.
 * *Mesuré le 12/11/2026 sur 40 lignes de l'export « commandes à la couleur » confrontées aux
 * mêmes lignes déjà synchronisées en base : le décodage par la grille triée retombe juste
 * 40 fois sur 40, celui par `SizeTypeMapping.position` seulement 3 fois sur 40 (les 3 types
 * où les deux ordres coïncident). Exemple `HAU` : les positions TIO donnent M, L, XL, S, 2XL
 * alors que les colonnes T0..Tn du fichier suivent S, M, L, XL, 2XL.*
 */
async function chargerGrillesParType(codes: string[]) {
  if (codes.length === 0) return () => null;
  const types = await prisma.sizeType.findMany({
    where: { code: { in: codes } },
    select: { code: true, mappings: { select: { position: true, sizeName: true } } },
  });
  const map = new Map<string, string[]>();
  for (const t of types) {
    const noms = [...t.mappings]
      .sort((a, b) => a.position - b.position)
      .map((m) => m.sizeName);
    if (noms.length > 0) map.set(t.code.trim().toUpperCase(), sortSizeScale(noms));
  }
  return (code: string): string[] | null => map.get(code.trim().toUpperCase()) ?? null;
}

/**
 * Répartitions par taille déjà synchronisées depuis TIO, pour les commandes du fichier.
 *
 * 🔴 Elles font AUTORITÉ sur le décodage positionnel des colonnes T0..Tn. *Mesuré le
 * 12/11/2026 en confrontant 5 893 lignes de l'export « commandes à la couleur » à ce que
 * la synchro TIO avait écrit : le décodage par la grille du produit retombe juste 5 859
 * fois (99,4 %), mais échoue sur trois gammes à tailles groupées — CER 2/33, CAL 2/4,
 * SOC 2/3 (ceintures, chaussettes). Exemple : `AMBELT_P004`, grille « L,3XL », le fichier
 * dit T0=4 ce qui donnerait « L » là où TIO a bien envoyé « 3XL ». Sans ce recoupement,
 * le contrôle inventerait 34 écarts de répartition qui n'existent pas.*
 *
 * Le total fait foi : la base n'est retenue que si elle totalise le même nombre de pièces
 * que le fichier.
 */
async function chargerRepartitionsTio(numerosCommande: string[]) {
  if (numerosCommande.length === 0) return () => null;
  const lignes = await prisma.clientOrderLine.findMany({
    where: { clientOrder: { orderNumber: { in: numerosCommande }, source: "TIO" } },
    select: {
      quantitiesBySize: true,
      totalQuantity: true,
      clientOrder: { select: { orderNumber: true } },
      product: { select: { reference: true, color: true } },
    },
  });
  const map = new Map<string, { tailles: Record<string, number>; total: number }>();
  for (const l of lignes) {
    const k = `${cleCommande(l.clientOrder.orderNumber)}\u0000${l.product.reference.toUpperCase()}\u0000${cleCouleur(l.product.color)}`;
    try {
      const brut = JSON.parse(l.quantitiesBySize) as Record<string, number>;
      const tailles: Record<string, number> = {};
      for (const [t, q] of Object.entries(brut)) if (q > 0) tailles[t] = q;
      map.set(k, { tailles, total: l.totalQuantity });
    } catch {
      /* répartition illisible : on s'en remet au décodage du fichier */
    }
  }
  return (commande: string, reference: string, couleur: string) =>
    map.get(`${cleCommande(commande)}\u0000${reference.toUpperCase()}\u0000${cleCouleur(couleur)}`) ?? null;
}

/** Statuts de commande TIO qui valent annulation (« cancel », « Cancelled », « Annuler »). */
const estAnnulee = (statut: string) => /^(cancel|annul)/i.test(statut.trim());

/**
 * Lit un fichier et en tire des lignes comparables.
 *
 * Quand les tailles décodées ne totalisent pas le même nombre de pièces que le fichier,
 * elles sont ABANDONNÉES (seul le total reste comparable) : comparer une répartition
 * incomplète inventerait des écarts de taille qui n'existent pas.
 */
export async function analyserFichier(
  buffer: ArrayBuffer,
  nom: string,
  coteForcee?: Cote
): Promise<FichierAnalyse> {
  const format = detecterFormat(buffer);
  if (!format) {
    throw new Error(
      `« ${nom} » : format non reconnu. Attendu un export commande client Texas, un export GestLog « détail par code-barres », ou un fichier avec les colonnes n° de commande / référence / taille / quantité.`
    );
  }

  const avertissements: string[] = [];
  const lignes: LigneNormalisee[] = [];
  let taillesNonDecodees = 0;

  if (format === "texas") {
    const brutes = parseTexasClientOrders(buffer);
    let sansReference = 0;
    for (const l of brutes) {
      const pieces = somme(l.quantities);
      if (pieces === 0) continue;
      let tailles = l.sizes;
      if (tailles && somme(Object.values(tailles)) !== pieces) {
        tailles = undefined;
      }
      if (!tailles) taillesNonDecodees++;
      if (!l.tioOrderNumber) sansReference++;
      lignes.push({
        numeroTio: l.tioOrderNumber,
        numeroTexas: l.orderNumber,
        codeClient: l.clientCode,
        reference: l.reference,
        codeCouleur: l.colorCode,
        libelleCouleur: l.colorName,
        ...(tailles ? { tailles } : {}),
        pieces,
        montantCommande: l.amount || undefined,
        soldee: l.sold,
      });
    }
    if (sansReference > 0) {
      avertissements.push(
        `${sansReference} ligne(s) sans « Référence commande client » : ces commandes Texas ne portent pas leur n° TIO, elles ne peuvent pas être rapprochées.`
      );
    }
    if (taillesNonDecodees > 0) {
      avertissements.push(
        `${taillesNonDecodees} ligne(s) sans décodage des tailles (légende de gamme ou Taille début/fin absente) : comparées sur le total de pièces seulement.`
      );
    }
  } else if (format === "texas-statgen") {
    // StatGen commande client de Texas : Q.1..Q.n ABSOLUS dans la gamme (légende en tête
    // de fichier), et non dans la grille du produit. Le décodage croise les deux.
    const { legende, lignes: brutes } = lireTexasStatgen(buffer);
    const grilleDe = await chargerGrilles([...new Set(brutes.map((l) => l.reference))]);
    let sansReference = 0;
    const introuvables = new Map<string, number>();

    for (const l of brutes) {
      const grille = grilleDe(l.reference, l.codeCouleur);
      const tailles = decoderTailesTexas(l.quantitesParPosition, grille, legende, l.quantite);
      if (!tailles) {
        taillesNonDecodees++;
        if (!grille) {
          const k = `${l.reference} / ${l.codeCouleur}${l.libelleCouleur ? ` (${l.libelleCouleur})` : ""}`;
          introuvables.set(k, (introuvables.get(k) || 0) + 1);
        }
      }
      if (!l.numeroTio) sansReference++;

      lignes.push({
        numeroTio: l.numeroTio,
        numeroTexas: l.numeroTexas,
        codeClient: l.codeClient,
        nomClient: l.nomClient || undefined,
        reference: l.reference,
        codeCouleur: l.codeCouleur,
        libelleCouleur: l.libelleCouleur,
        ...(tailles ? { tailles } : {}),
        pieces: l.quantite,
        ...(l.montant > 0 ? { montantLigne: l.montant } : {}),
      });
    }

    if (Object.keys(legende).length === 0) {
      avertissements.push(
        "Aucune légende de gamme en tête de fichier : les tailles ne peuvent pas être décodées, la comparaison se fera sur les totaux de pièces."
      );
    }
    if (sansReference > 0) {
      avertissements.push(
        `${sansReference} ligne(s) sans « Référence commande client » : ces commandes Texas ne portent pas leur n° TIO, elles ne peuvent pas être rapprochées.`
      );
    }
    if (introuvables.size > 0) {
      const top = [...introuvables.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      avertissements.push(
        `${introuvables.size} produit(s) absent(s) du référentiel GestLog : leur grille est inconnue, donc leurs tailles ne sont pas décodables (comparaison au total) — ${top
          .map(([k, n]) => `${k} ×${n}`)
          .join(", ")}${introuvables.size > 10 ? ", …" : ""}.`
      );
    }
  } else if (format === "color-orders") {
    // Export CSV TIO « commandes à la couleur » : une ligne par commande × produit ×
    // coloris, quantités réparties dans les colonnes T0..Tn (positionnelles).
    const texte = texteCsv(buffer);
    const brutes = texte ? lireColorOrders(texte) : [];
    const [grilleDe, grilleType, repartitionTio] = await Promise.all([
      chargerGrilles([...new Set(brutes.map((l) => l.reference))]),
      chargerGrillesParType([...new Set(brutes.map((l) => l.typeTaille).filter(Boolean))]),
      chargerRepartitionsTio([...new Set(brutes.map((l) => l.numeroCommande))]),
    ]);
    let corroborees = 0;

    let annulees = 0;
    const autresStatuts = new Map<string, number>();
    const introuvables = new Map<string, number>();
    const catalogues = new Set<string>();

    for (const l of brutes) {
      // Les commandes annulées sont EXCLUES : les compter ferait sortir des « commandes
      // absentes de Texas » qui n'avaient aucune raison d'y être saisies.
      if (estAnnulee(l.statut)) {
        annulees++;
        continue;
      }
      if (l.statut && !/^confirm/i.test(l.statut)) {
        autresStatuts.set(l.statut, (autresStatuts.get(l.statut) || 0) + 1);
      }
      if (l.catalogue) catalogues.add(l.catalogue);

      let tailles: Record<string, number> | undefined;

      // D'abord la répartition déjà synchronisée depuis TIO : elle nomme les tailles au
      // lieu de les déduire d'une position, et tranche les gammes à tailles groupées.
      const deBase = repartitionTio(l.numeroCommande, l.reference, l.codeCouleur);
      if (deBase && deBase.total === l.quantite) {
        tailles = deBase.tailles;
        corroborees++;
      }

      const scale = grilleDe(l.reference, l.codeCouleur) ?? grilleType(l.typeTaille);
      if (!tailles && scale) {
        const acc: Record<string, number> = {};
        for (let i = 0; i < scale.length && i < l.quantitesParPosition.length; i++) {
          const q = l.quantitesParPosition[i];
          if (q > 0) acc[scale[i]] = (acc[scale[i]] || 0) + q;
        }
        // 🔴 « Quantité à la couleur » fait foi, pas la somme des T0..Tn : si les deux ne
        // concordent pas, les tailles sont abandonnées (total seul comparable).
        if (somme(Object.values(acc)) === l.quantite) tailles = acc;
      }
      if (!tailles) {
        taillesNonDecodees++;
        if (!scale) {
          const k = `${l.reference} / ${l.codeCouleur}${l.libelleCouleur ? ` (${l.libelleCouleur})` : ""}`;
          introuvables.set(k, (introuvables.get(k) || 0) + 1);
        }
      }

      lignes.push({
        numeroTio: l.numeroCommande,
        codeClient: l.codeClient,
        nomClient: l.nomClient || undefined,
        reference: l.reference,
        codeCouleur: l.codeCouleur,
        libelleCouleur: l.libelleCouleur,
        ...(tailles ? { tailles } : {}),
        pieces: l.quantite,
        ...(l.montant > 0 ? { montantLigne: l.montant } : {}),
      });
    }

    if (corroborees > 0 && corroborees < lignes.length) {
      avertissements.push(
        `${corroborees} ligne(s) sur ${lignes.length} ont vu leurs tailles confirmées par les commandes TIO déjà synchronisées dans GestLog ; les autres sont décodées depuis les colonnes T0..Tn du fichier.`
      );
    }
    if (annulees > 0) {
      avertissements.push(
        `${annulees} ligne(s) de commandes annulées écartées (statut « cancel ») — elles n'ont pas à être saisies dans Texas.`
      );
    }
    if (autresStatuts.size > 0) {
      avertissements.push(
        `Statut(s) de commande inhabituel(s), conservés dans la comparaison : ${[...autresStatuts.entries()]
          .map(([st, n]) => `${st} (${n} ligne(s))`)
          .join(", ")}.`
      );
    }
    if (catalogues.size > 1) {
      avertissements.push(
        `Ce fichier mélange ${catalogues.size} catalogues (${[...catalogues].join(", ")}) : si l'export Texas n'en couvre qu'un, les autres sortiront en « absentes de Texas ».`
      );
    }
    if (introuvables.size > 0) {
      const top = [...introuvables.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      avertissements.push(
        `${introuvables.size} produit(s) absent(s) du référentiel GestLog et sans type de taille exploitable : comparaison au total de pièces seulement — ${top
          .map(([k, n]) => `${k} ×${n}`)
          .join(", ")}${introuvables.size > 10 ? ", …" : ""}.`
      );
    }
  } else if (format === "long") {
    for (const l of lireFormatLong(buffer)) {
      lignes.push({
        numeroTio: l.numeroCommande,
        codeClient: l.codeClient,
        nomClient: l.nomClient || undefined,
        reference: l.reference,
        codeCouleur: l.codeCouleur,
        libelleCouleur: l.libelleCouleur,
        // Une taille vide (fichier sans grille) ne doit pas créer une fausse taille :
        // la ligne reste comparable au total.
        ...(l.taille ? { tailles: { [l.taille]: l.quantite } } : {}),
        pieces: l.quantite,
        ...(l.montantLigne != null ? { montantLigne: l.montantLigne } : {}),
        ...(l.montantCommande != null ? { montantCommande: l.montantCommande } : {}),
      });
      if (!l.taille) taillesNonDecodees++;
    }
    if (lignes.length > 0 && lignes.every((l) => l.montantLigne == null && l.montantCommande == null)) {
      avertissements.push(
        "Aucune colonne de prix ou de montant dans ce fichier : les montants ne seront pas comparés."
      );
    }
  } else {
    // StatGen TIO : les Q.N sont RELATIFS à la grille du produit → référentiel requis.
    const brutes = parseMcsClientOrders(buffer);
    const grilleDe = await chargerGrilles([...new Set(brutes.map((l) => l.reference))]);
    const introuvables = new Map<string, number>();
    for (const l of brutes) {
      const pieces = somme(l.quantities);
      if (pieces === 0) continue;
      const scale = grilleDe(l.reference, l.colorCode);
      let tailles: Record<string, number> | undefined;
      if (scale) {
        const acc: Record<string, number> = {};
        for (let i = 0; i < scale.length && i < l.quantities.length; i++) {
          if (l.quantities[i] > 0) acc[scale[i]] = (acc[scale[i]] || 0) + l.quantities[i];
        }
        if (somme(Object.values(acc)) === pieces) tailles = acc;
      }
      if (!tailles) {
        taillesNonDecodees++;
        if (!scale) {
          const k = `${l.reference} / ${l.colorCode}${l.colorName ? ` (${l.colorName})` : ""}`;
          introuvables.set(k, (introuvables.get(k) || 0) + 1);
        }
      }
      lignes.push({
        numeroTio: l.orderNumber,
        codeClient: l.clientCode,
        nomClient: l.clientName || undefined,
        reference: l.reference,
        codeCouleur: l.colorCode,
        libelleCouleur: l.colorName,
        ...(tailles ? { tailles } : {}),
        pieces,
      });
    }
    if (introuvables.size > 0) {
      const top = [...introuvables.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      avertissements.push(
        `${introuvables.size} produit(s) absent(s) du référentiel GestLog : leurs tailles ne peuvent pas être décodées (comparaison au total seulement) — ${top
          .map(([k, n]) => `${k} ×${n}`)
          .join(", ")}${introuvables.size > 10 ? ", …" : ""}.`
      );
    }
    avertissements.push(
      "Fichier TIO StatGen : les quantités Q.1..Q.n y sont relatives à la grille du produit — les tailles sont reconstituées depuis le référentiel GestLog."
    );
  }

  if (lignes.length === 0) {
    throw new Error(
      `« ${nom} » : format reconnu (${LIBELLE_FORMAT[format]}) mais aucune ligne de commande exploitable.`
    );
  }

  return {
    nom,
    format,
    cote: coteForcee ?? coteDuFormat(format),
    lignes,
    taillesNonDecodees,
    avertissements,
  };
}

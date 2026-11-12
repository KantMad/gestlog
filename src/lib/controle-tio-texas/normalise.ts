// Transforme un fichier déposé en lignes normalisées comparables (cf. engine.ts).
//
// ⚠️ Ce module LIT la base (grilles de tailles, équivalences de couleur) mais n'écrit
// RIEN : le contrôle TIO ↔ Texas est une vérification, jamais un import. En particulier
// il n'utilise PAS `resolveProductWithEquivalence`, qui re-clé les produits au passage.

import { prisma } from "@/lib/prisma";
import { parseTexasClientOrders, parseMcsClientOrders } from "@/lib/import/mcs-format";
import { detecterFormat, lireFormatLong, type FormatControle } from "./formats";
import type { Cote, LigneNormalisee } from "./engine";

export interface FichierAnalyse {
  nom: string;
  format: FormatControle;
  cote: Cote;
  lignes: LigneNormalisee[];
  /** Nombre de lignes dont les tailles n'ont pas pu être décodées (total seul comparable). */
  taillesNonDecodees: number;
  avertissements: string[];
}

export const LIBELLE_FORMAT: Record<FormatControle, string> = {
  texas: "Commande client Texas (ERP)",
  long: "Une ligne par taille (export GestLog ou équivalent)",
  statgen: "Commande client TIO (StatGen, Q.1..Q.n)",
};

/** Côté déduit du format : seul l'export Texas décrit l'ERP. */
export const coteDuFormat = (f: FormatControle): Cote => (f === "texas" ? "TEXAS" : "TIO");

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

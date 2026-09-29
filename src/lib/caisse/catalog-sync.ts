import { prisma } from "@/lib/prisma";
import { seasonFromReference } from "@/lib/a-vendre-season";

// Intégration sortante GestLog → CaissePro : envoi du CATALOGUE (fiches produits).
// Pendant de `delivery-sync.ts`, qui envoie les livraisons. Même secret partagé, même
// principe : GestLog est client, la caisse est serveur, ON NE TOUCHE JAMAIS À LA CAISSE.
//
// 🔴 CE QUI N'EST PAS ENVOYÉ : aucune quantité, aucun stock. La caisse ignore le stock sur
// cet endpoint — seul le webhook livraisons fait entrer des pièces. Un import catalogue est
// rejouable à l'identique.
//
// 🔴 LES PRIX NE SONT QUE CONSEILLÉS : `updatePrices` reste à false. La boutique fixe ses
// prix ; la caisse renvoie les écarts dans `ecartsPrix`, à arbitrer par le métier. Ne pas
// passer à true sans accord explicite.

const CAISSE_CATALOG_URL = "https://api.techincash.app/api/integrations/gestlog/catalog";

/** Ligne brute du référentiel : un EAN = une (référence, coloris, taille). */
export interface CatalogRow {
  reference: string;
  color: string;
  colorCode: string | null;
  colorLabel: string | null;
  label: string | null;
  salePrice: number | null;
  costPrice: number | null;
  category: string | null;
  size: string;
  ean: string;
}

/** Article tel que la caisse l'attend (forme à plat, une ligne par code-barres). */
export interface CatalogItem {
  sku: string;
  name: string;
  price?: number;
  costPrice?: number;
  category?: string;
  collection?: string;
  ean: string;
  color: string;
  colorCode: string;
  size: string;
}

export interface CatalogBuild {
  items: CatalogItem[];
  /** EAN absent ou non conforme (13 chiffres) — la caisse rejetterait la ligne. */
  eanInvalide: string[];
  /** Produits sans désignation : aucune identité à envoyer, exclus. */
  sansNom: string[];
  /** Articles envoyés SANS prix : la caisse ne peut pas les CRÉER (elle peut les compléter). */
  sansPrix: string[];
}

const isEan13 = (s: string) => /^\d{13}$/.test(String(s ?? "").trim());

/**
 * Transforme les lignes du référentiel en articles caisse.
 *
 * 🔴 `color` = le NOM de la couleur, `colorCode` = le CODE. Historiquement GestLog envoyait
 * le code dans les deux et la caisse affichait « 213 » comme nom de couleur. Le repli sur
 * le code, quand le nom manque, reste préférable à une couleur vide — mais il est compté.
 *
 * 🔴 UN PRIX ABSENT EST OMIS, JAMAIS ENVOYÉ À 0 : un article à 0 € en caisse serait vendu
 * gratuitement. La caisse rejettera la création, ce qui est le comportement voulu, et
 * l'article est compté dans `sansPrix` pour que le prix soit corrigé dans TIO.
 */
export function buildCatalogItems(rows: CatalogRow[]): CatalogBuild {
  const items: CatalogItem[] = [];
  const eanInvalide: string[] = [];
  const sansNom: string[] = [];
  const sansPrix: string[] = [];

  for (const r of rows) {
    const cle = `${r.reference}/${r.color}/${r.size}`;
    const ean = String(r.ean ?? "").trim();
    if (!isEan13(ean)) {
      eanInvalide.push(cle);
      continue;
    }
    const nom = String(r.label ?? "").trim();
    if (!nom) {
      sansNom.push(cle);
      continue;
    }
    const prix = r.salePrice != null && r.salePrice > 0 ? r.salePrice : null;
    if (prix == null) sansPrix.push(cle);

    const cout = r.costPrice != null && r.costPrice > 0 ? r.costPrice : null;
    const collection = seasonFromReference(r.reference);

    items.push({
      sku: r.reference,
      name: nom,
      ...(prix != null ? { price: prix } : {}),
      ...(cout != null ? { costPrice: cout } : {}),
      ...(r.category ? { category: r.category } : {}),
      // La saison n'existe pas en base : déduite de la 1re lettre de la référence, et
      // seulement quand cette lettre est sûre (cf. a-vendre-season.ts). Sinon, rien.
      ...(collection ? { collection } : {}),
      ean,
      color: (r.colorLabel || r.color || "").trim(),
      colorCode: (r.colorCode || r.color || "").trim(),
      size: String(r.size ?? "").trim(),
    });
  }

  return { items, eanInvalide, sansNom, sansPrix };
}

export interface CatalogBatchResult {
  ok: boolean;
  status: number;
  produitsCrees: number;
  produitsMisAJour: number;
  variantesCreees: number;
  variantesMisesAJour: number;
  prixMisAJour: number;
  ignorees: number;
  ecartsPrix: unknown[];
  rejets: unknown[];
  error?: string;
}

const VIDE = (): CatalogBatchResult => ({
  ok: false, status: 0, produitsCrees: 0, produitsMisAJour: 0, variantesCreees: 0,
  variantesMisesAJour: 0, prixMisAJour: 0, ignorees: 0, ecartsPrix: [], rejets: [],
});

const nombre = (v: unknown) => Number(v) || 0;
const liste = (v: unknown) => (Array.isArray(v) ? v : []);

/** Envoie UN lot. Réessaie sur 5xx / réseau (transitoires), jamais sur 401/4xx. */
export async function sendCatalogBatch(
  items: CatalogItem[],
  opts: { dryRun?: boolean; batchId?: string; storeId?: string } = {}
): Promise<CatalogBatchResult> {
  const secret = process.env.GESTLOG_CAISSE_SECRET;
  if (!secret) return { ...VIDE(), error: "GESTLOG_CAISSE_SECRET non configuré" };
  if (items.length === 0) return { ...VIDE(), ok: true, status: 200 };

  const storeId = opts.storeId ?? process.env.CAISSE_STORE_ID ?? undefined;
  const payload = {
    batchId: opts.batchId || `CAT-${new Date().toISOString().slice(0, 10)}`,
    ...(storeId ? { storeId } : {}),
    dryRun: !!opts.dryRun,
    // ⚠️ Jamais true sans accord explicite du métier : la boutique fixe ses prix.
    updatePrices: false,
    items,
  };

  const MAX = 3;
  let lastError = "";
  for (let essai = 1; essai <= MAX; essai++) {
    try {
      const res = await fetch(CAISSE_CATALOG_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gestlog-Secret": secret },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000),
      });
      if (res.status === 200 || res.status === 201) {
        const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        return {
          ok: true,
          status: res.status,
          produitsCrees: nombre(d.produitsCrees),
          produitsMisAJour: nombre(d.produitsMisAJour),
          variantesCreees: nombre(d.variantesCreees),
          variantesMisesAJour: nombre(d.variantesMisesAJour),
          prixMisAJour: nombre(d.prixMisAJour),
          ignorees: nombre(d.ignorees),
          ecartsPrix: liste(d.ecartsPrix),
          rejets: liste(d.rejets),
        };
      }
      if (res.status === 401) {
        return { ...VIDE(), status: 401, error: "Secret invalide (401)" };
      }
      if (res.status >= 500) {
        lastError = `HTTP ${res.status}`;
        if (essai < MAX) {
          await new Promise((r) => setTimeout(r, essai * 2000));
          continue;
        }
        return { ...VIDE(), status: res.status, error: `${lastError} (à réessayer)` };
      }
      const txt = await res.text().catch(() => "");
      return { ...VIDE(), status: res.status, error: `HTTP ${res.status} ${txt}`.slice(0, 300) };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (essai < MAX) {
        await new Promise((r) => setTimeout(r, essai * 2000));
        continue;
      }
      return { ...VIDE(), error: `${lastError} (à réessayer)` };
    }
  }
  return { ...VIDE(), error: lastError || "échec inconnu" };
}

export interface CatalogSyncSummary {
  dryRun: boolean;
  lots: number;
  lignesLues: number;
  articlesEnvoyes: number;
  produitsCrees: number;
  produitsMisAJour: number;
  variantesCreees: number;
  variantesMisesAJour: number;
  prixMisAJour: number;
  ignorees: number;
  eanInvalide: number;
  sansNom: number;
  sansPrix: number;
  exemplesSansPrix: string[];
  ecartsPrix: unknown[];
  rejets: unknown[];
  erreurs: string[];
  /** Position de reprise : `null` quand tout le catalogue a été parcouru. */
  nextOffset: number | null;
}

/**
 * Parcourt le référentiel par pages et envoie chaque lot à la caisse.
 *
 * 🔴 LE CATALOGUE COMPLET FAIT ~56 000 CODES-BARRES : un seul appel pèserait plusieurs
 * dizaines de Mo et serait coupé par le proxy. On envoie donc par lots, et la fonction
 * rend la main au bout de `budgetMs` en renvoyant `nextOffset` — le cron rappelle jusqu'à
 * ce qu'il vaille `null`. L'import étant rejouable, une reprise ne casse rien.
 *
 * ⚠️ Ordre de pagination STABLE (reference, color, size) : sans `ORDER BY` complet, deux
 * pages pourraient se recouvrir ou sauter des lignes.
 */
export async function syncCatalogToCaisse(options: {
  dryRun?: boolean;
  offset?: number;
  batchSize?: number;
  maxItems?: number;
  budgetMs?: number;
  storeId?: string;
} = {}): Promise<CatalogSyncSummary> {
  const dryRun = !!options.dryRun;
  const batchSize = Math.min(Math.max(options.batchSize ?? 500, 1), 2000);
  const budgetMs = options.budgetMs ?? 40000;
  const debut = Date.now();
  let offset = options.offset ?? 0;
  const jour = new Date().toISOString().slice(0, 10);

  const s: CatalogSyncSummary = {
    dryRun, lots: 0, lignesLues: 0, articlesEnvoyes: 0, produitsCrees: 0, produitsMisAJour: 0,
    variantesCreees: 0, variantesMisesAJour: 0, prixMisAJour: 0, ignorees: 0, eanInvalide: 0,
    sansNom: 0, sansPrix: 0, exemplesSansPrix: [], ecartsPrix: [], rejets: [], erreurs: [],
    nextOffset: null,
  };

  for (;;) {
    const restant = options.maxItems != null ? options.maxItems - s.lignesLues : Infinity;
    if (restant <= 0) {
      s.nextOffset = offset;
      break;
    }
    const taille = Math.min(batchSize, restant);
    const rows = await prisma.$queryRawUnsafe<CatalogRow[]>(
      `SELECT p."reference", p."color", p."colorCode", p."colorLabel", p."label",
              p."salePrice", p."costPrice", p."category", e."size", e."ean"
         FROM "ProductSizeEan" e
         JOIN "Product" p ON p."reference" = e."reference" AND p."color" = e."color"
        ORDER BY e."reference", e."color", e."size"
        LIMIT $1 OFFSET $2`,
      taille,
      offset
    );
    if (rows.length === 0) {
      s.nextOffset = null;
      break;
    }

    const lot = buildCatalogItems(rows);
    s.lignesLues += rows.length;
    s.eanInvalide += lot.eanInvalide.length;
    s.sansNom += lot.sansNom.length;
    s.sansPrix += lot.sansPrix.length;
    for (const c of lot.sansPrix) if (s.exemplesSansPrix.length < 20) s.exemplesSansPrix.push(c);

    if (lot.items.length > 0) {
      s.lots++;
      const r = await sendCatalogBatch(lot.items, {
        dryRun,
        batchId: `CAT-${jour}#${s.lots}`,
        storeId: options.storeId,
      });
      if (!r.ok) {
        s.erreurs.push(`lot ${s.lots} (offset ${offset}) : ${r.error || `HTTP ${r.status}`}`);
        // 🔴 On s'ARRÊTE à la première erreur en rendant `nextOffset` : réessayer les
        // lots suivants sur une caisse en panne ne ferait qu'empiler les échecs, et la
        // reprise repart exactement d'ici.
        s.nextOffset = offset;
        return s;
      }
      s.articlesEnvoyes += lot.items.length;
      s.produitsCrees += r.produitsCrees;
      s.produitsMisAJour += r.produitsMisAJour;
      s.variantesCreees += r.variantesCreees;
      s.variantesMisesAJour += r.variantesMisesAJour;
      s.prixMisAJour += r.prixMisAJour;
      s.ignorees += r.ignorees;
      for (const x of r.ecartsPrix) if (s.ecartsPrix.length < 50) s.ecartsPrix.push(x);
      for (const x of r.rejets) if (s.rejets.length < 50) s.rejets.push(x);
    }

    offset += rows.length;
    if (rows.length < taille) {
      s.nextOffset = null;
      break;
    }
    if (Date.now() - debut > budgetMs) {
      s.nextOffset = offset;
      break;
    }
  }

  return s;
}

// Suivi des collections (GESTLOG-13) — logique PURE, testée (collections.test.ts).
// Un relevé = l'état COMPLET d'un catalogue TIO (lng_catalog_product) un jour donné.

/** Coloris d'une ligne lng_catalog_product.colors : ids séparés par retour ligne, virgule ou espace. */
export function parseColorIds(raw: unknown): number[] {
  if (Array.isArray(raw)) return [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  return [
    ...new Set(
      String(raw ?? "")
        .split(/[\s,;|]+/)
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0)
    ),
  ];
}

export interface SnapshotProduct {
  productId: number;
  sku?: string | null;
  colors: number[];
  deleted: boolean; // lng_catalog_product.fl_deleted = 1 (retiré du catalogue)
}

export interface ExistingItem {
  id: string;
  productId: number;
  colorId: number;
  removedDay: string | null;
  removedBeforeTracking: boolean;
}

export type ItemAction =
  | { kind: "create"; productId: number; colorId: number; reference: string | null; present: boolean; presentAtStart: boolean; removedBeforeTracking: boolean; removedDay: string | null }
  | { kind: "seen"; id: string; reference: string | null } // toujours présenté : lastSeenDay = jour
  | { kind: "readded"; id: string; reference: string | null } // retiré puis remis
  | { kind: "removed"; id: string }; // retiré ce jour

/**
 * Compare le relevé complet d'un catalogue à ce qu'on connaît déjà.
 * `isFirst` : 1er relevé de CE catalogue → ce qui est là n'a pas de date d'ajout connue, ce
 * qui est déjà retiré n'a pas de date de retrait connue.
 * Un coloris qui disparaît de la liste (ou un produit qui n'est plus renvoyé) = retiré.
 */
export function diffCatalogSnapshot(existing: ExistingItem[], products: SnapshotProduct[], day: string, isFirst: boolean): ItemAction[] {
  const byKey = new Map(existing.map((e) => [`${e.productId}_${e.colorId}`, e]));
  const touched = new Set<string>();
  const actions: ItemAction[] = [];
  for (const p of products) {
    const reference = p.sku ? String(p.sku).trim() || null : null;
    for (const colorId of p.colors) {
      const k = `${p.productId}_${colorId}`;
      if (touched.has(k)) continue;
      touched.add(k);
      const e = byKey.get(k);
      const isRemoved = e ? e.removedDay !== null || e.removedBeforeTracking : false;
      if (!e) {
        actions.push({
          kind: "create",
          productId: p.productId,
          colorId,
          reference,
          present: !p.deleted,
          presentAtStart: isFirst && !p.deleted,
          removedBeforeTracking: isFirst && p.deleted,
          removedDay: !isFirst && p.deleted ? day : null,
        });
      } else if (!p.deleted) {
        actions.push(isRemoved ? { kind: "readded", id: e.id, reference } : { kind: "seen", id: e.id, reference });
      } else if (!isRemoved) {
        actions.push({ kind: "removed", id: e.id });
      }
    }
  }
  for (const e of existing) {
    const k = `${e.productId}_${e.colorId}`;
    if (!touched.has(k) && e.removedDay === null && !e.removedBeforeTracking) actions.push({ kind: "removed", id: e.id });
  }
  return actions;
}

/** Catalogues « hors collection » écartés par défaut (stock, offres, propositions…). */
export const NON_COLLECTION = /stock|offre|proposition|demande|actua|remise|outlet|s[ée]lection|bazar|fin de|d[ée]mo|test/i;

// ─── Rapport par saison × famille ───────────────────────────────────────

export interface CollectionItemRow {
  tioCatalogId: number;
  productId: number;
  externalId: string;
  reference: string | null;
  category: string;
  removed: boolean; // retiré de CE catalogue (daté ou non)
  removedDay: string | null;
  addedDuringTracking: boolean; // apparu après le 1er relevé du catalogue
}

export interface FamilyCounts {
  family: string;
  presentedProducts: number;
  presentedColors: number;
  removedProducts: number; // produits dont TOUS les coloris ont été retirés de tous les catalogues retenus
  removedColors: number;
  addedColors: number; // ajoutés depuis le début du suivi
  keptProducts: number;
  keptColors: number;
  clientProducts: number; // commandés par au moins un client
  clientColors: number;
  factoryProducts: number; // commandés à l'usine
  factoryColors: number;
  factoryRate: number | null; // % des coloris présentés commandés à l'usine (null si aucune commande usine connue)
}

/**
 * Compte, par famille, les produits et coloris présentés, retirés, gardés, commandés par les
 * clients et commandés à l'usine. Un coloris présent dans plusieurs catalogues compte une fois ;
 * il est « retiré » seulement s'il a été retiré de TOUS les catalogues retenus.
 */
export function familyCounts(
  items: CollectionItemRow[],
  clientIds: Set<string>,
  factoryIds: Set<string>,
  hasFactory: boolean
): FamilyCounts[] {
  const colors = new Map<string, { family: string; productId: number; removed: boolean; added: boolean }>();
  for (const it of items) {
    const c = colors.get(it.externalId);
    if (!c) colors.set(it.externalId, { family: it.category, productId: it.productId, removed: it.removed, added: it.addedDuringTracking });
    else {
      c.removed = c.removed && it.removed;
      c.added = c.added && it.addedDuringTracking;
    }
  }
  const fam = new Map<string, { p: Set<number>; pKept: Set<number>; c: number; cRemoved: number; cAdded: number; pClient: Set<number>; cClient: number; pFactory: Set<number>; cFactory: number }>();
  for (const [ext, c] of colors) {
    const f =
      fam.get(c.family) ??
      { p: new Set(), pKept: new Set(), c: 0, cRemoved: 0, cAdded: 0, pClient: new Set(), cClient: 0, pFactory: new Set(), cFactory: 0 };
    f.p.add(c.productId);
    f.c++;
    if (c.removed) f.cRemoved++;
    else f.pKept.add(c.productId);
    if (c.added) f.cAdded++;
    if (clientIds.has(ext)) {
      f.cClient++;
      f.pClient.add(c.productId);
    }
    if (factoryIds.has(ext)) {
      f.cFactory++;
      f.pFactory.add(c.productId);
    }
    fam.set(c.family, f);
  }
  const rows = [...fam.entries()].map(([family, f]) => ({
    family,
    presentedProducts: f.p.size,
    presentedColors: f.c,
    removedProducts: f.p.size - f.pKept.size,
    removedColors: f.cRemoved,
    addedColors: f.cAdded,
    keptProducts: f.pKept.size,
    keptColors: f.c - f.cRemoved,
    clientProducts: f.pClient.size,
    clientColors: f.cClient,
    factoryProducts: f.pFactory.size,
    factoryColors: f.cFactory,
    factoryRate: hasFactory && f.c > 0 ? Math.round((f.cFactory / f.c) * 1000) / 10 : null,
  }));
  return rows.sort((a, b) => b.presentedColors - a.presentedColors);
}

export function sumCounts(rows: FamilyCounts[], hasFactory: boolean): FamilyCounts {
  const t = rows.reduce(
    (a, r) => {
      for (const k of Object.keys(a) as (keyof typeof a)[]) a[k] += r[k];
      return a;
    },
    { presentedProducts: 0, presentedColors: 0, removedProducts: 0, removedColors: 0, addedColors: 0, keptProducts: 0, keptColors: 0, clientProducts: 0, clientColors: 0, factoryProducts: 0, factoryColors: 0 }
  );
  return {
    family: "Total",
    ...t,
    factoryRate: hasFactory && t.presentedColors > 0 ? Math.round((t.factoryColors / t.presentedColors) * 1000) / 10 : null,
  };
}

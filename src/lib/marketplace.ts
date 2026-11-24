// Commandes marketplaces arrivées dans WooCommerce via Shopping Feed (GESTLOG-15).
// Shopping Feed écrit dans chaque commande Woo les méta `sf_marketplace` (ex. « laredoutemirakl »)
// et `sf_reference` (n° de commande côté marketplace, ex. « LRFR20263273236715-A »).

export interface MarketplaceInfo {
  marketplace: string | null;
  marketplaceRef: string | null;
}

export function marketplaceFromMeta(meta: unknown): MarketplaceInfo {
  const out: MarketplaceInfo = { marketplace: null, marketplaceRef: null };
  if (!Array.isArray(meta)) return out;
  for (const m of meta as { key?: unknown; value?: unknown }[]) {
    const v = typeof m?.value === "string" ? m.value.trim() : typeof m?.value === "number" ? String(m.value) : "";
    if (!v) continue;
    if (m.key === "sf_marketplace") out.marketplace = v.toLowerCase();
    else if (m.key === "sf_reference") out.marketplaceRef = v;
  }
  return out;
}

/** Nom lisible d'une marketplace Shopping Feed. */
export function marketplaceLabel(code: string | null | undefined): string {
  if (!code) return "Site";
  const c = code.toLowerCase();
  if (c.startsWith("laredoute")) return "La Redoute";
  if (c.startsWith("zalando")) return "Zalando";
  if (c.startsWith("amazon")) return "Amazon";
  if (c.startsWith("galerieslafayette")) return "Galeries Lafayette";
  if (c.startsWith("cdiscount")) return "Cdiscount";
  if (c.startsWith("fnac")) return "Fnac";
  if (c.startsWith("miinto")) return "Miinto";
  if (c.startsWith("bol")) return "Bol.com";
  return code;
}

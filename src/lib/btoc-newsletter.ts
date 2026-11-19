// Newsletter BtoC : passage d'un contact Brevo à une ligne BtocNewsletterContact,
// et mise en forme Excel de l'onglet Newsletter. Pur (testé) ; la synchro et la
// lecture SQL sont dans les routes.

/** Listes Brevo considérées comme « newsletter » : 8 FR, 9 EN, 12 Boutique Réaumur.
 *  Les listes 5 « WooCommerce » et 13 « WooCommerce_NonSubscribers » sont celles du
 *  plugin Woo (tous les clients, abonnés ou non) : ce ne sont PAS des abonnés. */
export const DEFAULT_NEWSLETTER_LIST_IDS = [8, 9, 12];

export const NEWSLETTER_LIST_LABELS: Record<number, string> = {
  8: "FR",
  9: "EN",
  12: "Boutique Réaumur",
};

export function newsletterListIds(env: string | undefined = process.env.BREVO_NEWSLETTER_LIST_IDS): number[] {
  const ids = (env ?? "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return ids.length ? ids : DEFAULT_NEWSLETTER_LIST_IDS;
}

export function listLabel(id: number): string {
  return NEWSLETTER_LIST_LABELS[id] ?? `Liste ${id}`;
}

export interface BrevoRawContact {
  id?: number;
  email?: string | null;
  emailBlacklisted?: boolean;
  listIds?: number[];
  listUnsubscribed?: number[];
  createdAt?: string;
  modifiedAt?: string;
  attributes?: Record<string, unknown>;
}

export interface NewsletterRow {
  email: string;
  brevoId: number | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  listIds: number[];
  unsubscribedListIds: number[];
  blacklisted: boolean;
  inNewsletterList: boolean;
  subscribed: boolean;
  subscribedAt: string | null; // ISO
  brevoModifiedAt: string | null; // ISO
}

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  return s || null;
};
const iso = (v: string | undefined): string | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const ints = (a: unknown): number[] =>
  Array.isArray(a) ? [...new Set(a.filter((n): n is number => Number.isInteger(n)))].sort((x, y) => x - y) : [];

/** null = contact inutilisable (sans e-mail valide, ex. contact SMS seul). */
export function toNewsletterRow(c: BrevoRawContact, nlIds: number[]): NewsletterRow | null {
  const email = (c.email ?? "").trim().toLowerCase();
  if (!email.includes("@")) return null;
  const a = c.attributes ?? {};
  const listIds = ints(c.listIds);
  const unsubscribedListIds = ints(c.listUnsubscribed);
  const blacklisted = c.emailBlacklisted === true;
  const inList = listIds.some((id) => nlIds.includes(id));
  return {
    email,
    brevoId: Number.isInteger(c.id) ? (c.id as number) : null,
    firstName: str(a.PRENOM) ?? str(a.FIRSTNAME),
    lastName: str(a.NOM) ?? str(a.LASTNAME),
    phone: str(a.SMS) ?? str(a.PHONE) ?? str(a.LANDLINE_NUMBER) ?? str(a.WHATSAPP),
    listIds,
    unsubscribedListIds,
    blacklisted,
    inNewsletterList: inList || unsubscribedListIds.some((id) => nlIds.includes(id)),
    subscribed: !blacklisted && inList,
    subscribedAt: iso(c.createdAt),
    brevoModifiedAt: iso(c.modifiedAt),
  };
}

/** Dédoublonne par e-mail (Brevo peut renvoyer deux casses du même e-mail) :
 *  un contact inscrit l'emporte, sinon le plus récemment modifié. */
export function dedupeRows(rows: NewsletterRow[]): NewsletterRow[] {
  const by = new Map<string, NewsletterRow>();
  for (const r of rows) {
    const prev = by.get(r.email);
    if (
      !prev ||
      (r.subscribed && !prev.subscribed) ||
      (r.subscribed === prev.subscribed && (r.brevoModifiedAt ?? "") > (prev.brevoModifiedAt ?? ""))
    ) {
      by.set(r.email, r);
    }
  }
  return [...by.values()];
}

// ─── Onglet Newsletter ───────────────────────────────────────────────────────

export interface NewsletterListItem {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  lists: string; // ex. "FR, Boutique Réaumur"
  subscribed: boolean;
  subscribedAt: string | null; // YYYY-MM-DD
  unsubscribedAt: string | null; // YYYY-MM-DD
  ordersCount: number;
  totalSpent: number;
  lastOrder: string | null; // YYYY-MM-DD
}

export function newsletterSheetRow(r: NewsletterListItem) {
  return {
    Email: r.email,
    Prénom: r.firstName,
    Nom: r.lastName,
    Téléphone: r.phone,
    Listes: r.lists,
    Statut: r.subscribed ? "Inscrit" : "Désinscrit",
    "Inscrit le": r.subscribedAt ?? "",
    "Désinscrit le": r.unsubscribedAt ?? "",
    "A commandé": r.ordersCount > 0 ? "Oui" : "Non",
    "Nb commandes": r.ordersCount,
    "Total dépensé (€)": Math.round(r.totalSpent * 100) / 100,
    "Dernière commande": r.lastOrder ?? "",
  };
}

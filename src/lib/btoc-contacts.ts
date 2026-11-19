// Export « Clients & prospects » BtoC (/api/btoc/export/contacts).
//
// Deux listes, toutes deux identifiées par l'E-MAIL normalisé (minuscules, sans
// espaces) — comme la segmentation : une commande sur deux est passée sans compte.
//
//  1. CLIENTS   : au moins une commande aboutie (boutique live OU historique importé).
//  2. PROSPECTS : contacts qui n'ont JAMAIS commandé, de trois origines cumulables :
//       • newsletter : contact Brevo d'une liste newsletter, non désinscrit ;
//       • compte     : compte WooCommerce (BtocCustomer) sans commande ;
//       • panier     : commande WooCommerce non aboutie (en attente de paiement,
//                      échouée, annulée) — e-mail saisi au checkout, jamais payé.
//     Tout e-mail présent dans les clients est retiré des prospects.
//
// Ce module ne fait QUE la fusion (pur, testé) ; la route fait les lectures.

/** Statuts WooCommerce qui ne font PAS de quelqu'un un client. */
export const NON_ORDER_STATUSES = ["cancelled", "refunded", "failed", "pending", "checkout-draft"] as const;
/** Statuts « panier non abouti » : l'e-mail a été saisi mais rien n'a été payé. */
export const UNFINISHED_STATUSES = ["pending", "failed", "cancelled", "checkout-draft"] as const;

/** Listes Brevo considérées comme « newsletter » (FR, EN, Boutique Réaumur). */
export const DEFAULT_NEWSLETTER_LIST_IDS = [8, 9, 12];

/**
 * La 1re synchro des comptes WooCommerce a eu lieu le 08/06/2026 : pour les comptes
 * créés ce jour-là, `BtocCustomer.createdAt` est une date d'IMPORT, pas d'inscription.
 * Au-delà, la synchro quotidienne crée la fiche le lendemain de l'inscription au plus tard.
 */
export const ACCOUNT_IMPORT_CUTOFF = new Date("2026-06-10T00:00:00Z");

export type ProspectOrigin = "newsletter" | "compte" | "panier";
const ORIGIN_ORDER: ProspectOrigin[] = ["newsletter", "compte", "panier"];

export interface Identity {
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  postcode: string;
  city: string;
  country: string;
}

export interface ClientRow extends Identity {
  lastOrder: string | null; // YYYY-MM-DD (Paris)
  ordersCount: number;
  totalSpent: number;
}

export interface ProspectRow extends Identity {
  date: string | null; // 1er contact connu, YYYY-MM-DD (Paris)
  origin: string; // ex. "newsletter, compte"
}

export interface AccountInput {
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  postcode: string | null;
  city: string | null;
  country: string | null;
  createdAt: Date;
}

export interface UnfinishedOrderInput {
  email: string;
  firstName: string | null;
  lastName: string | null;
  customerName: string | null;
  postcode: string | null;
  city: string | null;
  country: string | null;
  lastDate: Date;
}

export interface BrevoContactInput {
  email: string;
  emailBlacklisted: boolean;
  listIds: number[];
  createdAt: string;
  attributes: Record<string, unknown>;
}

export function normEmail(e: string | null | undefined): string {
  return (e ?? "").trim().toLowerCase();
}

/** YYYY-MM-DD dans le fuseau de Paris. */
export function parisYmd(d: Date | null | undefined): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

const s = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/** Découpe « Prénom Nom » quand seule la forme concaténée existe. */
export function splitName(full: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts.shift() ?? "", lastName: parts.join(" ") };
}

function brevoIdentity(c: BrevoContactInput): Omit<Identity, "email"> {
  const a = c.attributes ?? {};
  return {
    phone: s(a.SMS) || s(a.PHONE) || s(a.LANDLINE_NUMBER) || s(a.WHATSAPP),
    firstName: s(a.PRENOM) || s(a.FIRSTNAME),
    lastName: s(a.NOM) || s(a.LASTNAME),
    postcode: "",
    city: "",
    country: "",
  };
}

/** Remplit les champs vides de `into` avec ceux de `from` (jamais d'écrasement). */
function fillBlanks(into: Identity, from: Partial<Omit<Identity, "email">>) {
  for (const k of ["phone", "firstName", "lastName", "postcode", "city", "country"] as const) {
    if (!into[k] && from[k]) into[k] = from[k]!;
  }
}

export function isNewsletterContact(c: BrevoContactInput, listIds: number[]): boolean {
  return !c.emailBlacklisted && (c.listIds ?? []).some((id) => listIds.includes(id));
}

/** Complète le téléphone des clients depuis Brevo quand la boutique ne l'a pas. */
export function enrichClients(clients: ClientRow[], brevo: BrevoContactInput[]): ClientRow[] {
  const byEmail = new Map(brevo.map((c) => [normEmail(c.email), c]));
  return clients.map((cl) => {
    const b = byEmail.get(normEmail(cl.email));
    if (!b) return cl;
    const out = { ...cl };
    fillBlanks(out, brevoIdentity(b));
    return out;
  });
}

export function buildProspects(input: {
  clientEmails: Set<string>;
  accounts: AccountInput[];
  unfinished: UnfinishedOrderInput[];
  brevo: BrevoContactInput[];
  newsletterListIds: number[];
}): ProspectRow[] {
  const { clientEmails, newsletterListIds } = input;
  const brevoByEmail = new Map<string, BrevoContactInput>();
  for (const c of input.brevo) {
    const k = normEmail(c.email);
    if (k) brevoByEmail.set(k, c);
  }

  type Acc = { id: Identity; origins: Set<ProspectOrigin>; dates: Date[] };
  const map = new Map<string, Acc>();
  const get = (email: string): Acc | null => {
    const k = normEmail(email);
    if (!k || !k.includes("@") || clientEmails.has(k)) return null;
    let a = map.get(k);
    if (!a) {
      a = {
        id: { email: k, phone: "", firstName: "", lastName: "", postcode: "", city: "", country: "" },
        origins: new Set(),
        dates: [],
      };
      map.set(k, a);
    }
    return a;
  };
  const brevoDate = (k: string): Date | null => {
    const b = brevoByEmail.get(k);
    const d = b ? new Date(b.createdAt) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  };

  // Ordre de priorité de l'identité : compte Woo > commande non aboutie > Brevo.
  for (const acc of input.accounts) {
    const a = get(acc.email);
    if (!a) continue;
    a.origins.add("compte");
    fillBlanks(a.id, {
      phone: s(acc.phone), firstName: s(acc.firstName), lastName: s(acc.lastName),
      postcode: s(acc.postcode), city: s(acc.city), country: s(acc.country),
    });
    // Date d'inscription : Brevo (le plugin Woo crée le contact à l'inscription),
    // sinon la date de création GestLog si elle n'est pas celle de l'import initial.
    const d = brevoDate(a.id.email) ?? (acc.createdAt >= ACCOUNT_IMPORT_CUTOFF ? acc.createdAt : null);
    if (d) a.dates.push(d);
  }

  for (const o of input.unfinished) {
    const a = get(o.email);
    if (!a) continue;
    a.origins.add("panier");
    const n = s(o.firstName) || s(o.lastName) ? { firstName: s(o.firstName), lastName: s(o.lastName) } : splitName(o.customerName);
    fillBlanks(a.id, { ...n, postcode: s(o.postcode), city: s(o.city), country: s(o.country) });
    a.dates.push(o.lastDate);
  }

  for (const c of input.brevo) {
    const k = normEmail(c.email);
    const subscribed = isNewsletterContact(c, newsletterListIds);
    // Un contact Brevo hors newsletter n'entre pas, mais sert à compléter l'identité.
    const a = subscribed ? get(k) : map.get(k) ?? null;
    if (!a) continue;
    if (subscribed) {
      a.origins.add("newsletter");
      const d = brevoDate(k);
      if (d) a.dates.push(d);
    }
    fillBlanks(a.id, brevoIdentity(c));
  }

  return [...map.values()]
    .map(({ id, origins, dates }) => ({
      ...id,
      date: dates.length ? parisYmd(new Date(Math.min(...dates.map((d) => d.getTime())))) : null,
      origin: ORIGIN_ORDER.filter((o) => origins.has(o)).join(", "),
    }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.email.localeCompare(b.email));
}

// ─── Mise en forme Excel (partagée écran ↔ tests) ────────────────────────────

export function clientSheetRow(c: ClientRow) {
  return {
    Email: c.email,
    Téléphone: c.phone,
    Prénom: c.firstName,
    Nom: c.lastName,
    "Code postal": c.postcode,
    Ville: c.city,
    Pays: c.country,
    "Dernière commande": c.lastOrder ?? "",
    "Nb commandes": c.ordersCount,
    "Total dépensé (€)": Math.round(c.totalSpent * 100) / 100,
  };
}

export function prospectSheetRow(p: ProspectRow) {
  return {
    Email: p.email,
    Téléphone: p.phone,
    Prénom: p.firstName,
    Nom: p.lastName,
    "Code postal": p.postcode,
    Ville: p.city,
    Pays: p.country,
    Date: p.date ?? "",
    Origine: p.origin,
  };
}

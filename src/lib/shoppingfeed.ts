// Lecture des commandes marketplaces dans l'API Shopping Feed (GESTLOG-15).
// LECTURE SEULE : on n'appelle QUE « List Orders » (GET /v1/store/{storeId}/order). L'API sait
// aussi accepter / expédier / rembourser des commandes : GestLog ne le fait jamais.
// Jeton : SHOPPINGFEED_TOKEN (.env du serveur) ; boutique : SHOPPINGFEED_STORE_ID (défaut 42888,
// la boutique mcsapparel.fr — c'est aussi la méta Woo sf_store_id).

const API = "https://api.shopping-feed.com";
const PAGE_SIZE = 200; // maximum accepté par l'API

export interface SfItem {
  reference: string | null;
  name: string | null;
  quantity: number;
  price: number;
  status: string | null;
}

export interface SfOrder {
  sfId: string;
  reference: string;
  storeReference: string | null;
  channelId: number;
  channel: string;
  status: string;
  isTest: boolean;
  orderCreatedAt: string;
  acknowledgedAt: string | null;
  sfUpdatedAt: string | null;
  totalAmount: number;
  productAmount: number;
  shippingAmount: number;
  currency: string;
  itemCount: number;
  items: SfItem[];
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v)) || 0;
const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));

/** Commande brute de l'API → ce que GestLog garde (sans nom, adresse, téléphone ni e-mail). */
export function mapSfOrder(o: Record<string, unknown>): SfOrder {
  const payment = (o.payment ?? {}) as Record<string, unknown>;
  const channel = (((o._embedded ?? {}) as Record<string, unknown>).channel ?? {}) as Record<string, unknown>;
  const items = (Array.isArray(o.items) ? o.items : []).map((i: Record<string, unknown>) => ({
    reference: str(i.reference),
    name: str(i.name),
    quantity: num(i.quantity),
    price: num(i.price),
    status: str(i.status),
  }));
  return {
    sfId: String(o.id),
    reference: String(o.reference ?? ""),
    storeReference: str(o.storeReference),
    channelId: num(o.channelId ?? channel.id),
    channel: String(channel.name ?? o.channelId ?? ""),
    status: String(o.status ?? ""),
    isTest: o.isTest === true,
    orderCreatedAt: String(o.createdAt),
    acknowledgedAt: str(o.acknowledgedAt),
    sfUpdatedAt: str(o.updatedAt),
    totalAmount: num(payment.totalAmount),
    productAmount: num(payment.productAmount),
    shippingAmount: num(payment.shippingAmount),
    currency: String(payment.currency ?? "EUR"),
    itemCount: items.reduce((s, i) => s + i.quantity, 0),
    items,
  };
}

/** Toutes les commandes CRÉÉES entre since et until (ISO ; sans fuseau = heure de Paris). */
export async function fetchSfOrders(since: string, until?: string): Promise<SfOrder[]> {
  const token = process.env.SHOPPINGFEED_TOKEN;
  if (!token) throw new Error("SHOPPINGFEED_TOKEN absent du .env");
  const storeId = process.env.SHOPPINGFEED_STORE_ID || "42888";
  const out: SfOrder[] = [];
  for (let page = 1; page <= 200; page++) {
    const q = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(page), since });
    if (until) q.set("until", until);
    const res = await fetch(`${API}/v1/store/${storeId}/order?${q}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Shopping Feed HTTP ${res.status}`);
    const d = (await res.json()) as { pages?: number; _embedded?: { order?: Record<string, unknown>[] } };
    for (const o of d._embedded?.order ?? []) out.push(mapSfOrder(o));
    if (!d.pages || page >= d.pages) break;
  }
  return out;
}

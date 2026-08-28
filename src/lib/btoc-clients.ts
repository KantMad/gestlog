// Client BtoC agrégé renvoyé par /api/btoc/segmentation/clients, et sa mise en forme Excel.
// Partagé par l'export ciblé et le détail d'un bloc de segmentation : les deux doivent
// produire EXACTEMENT les mêmes colonnes, sinon deux exports du même écran ne se comparent
// plus.

export interface SegmentedClient {
  email: string;
  firstName: string;
  lastName: string;
  customerName: string;
  phone: string;
  company: string;
  billingAddress: string;
  billingPostcode: string;
  billingCity: string;
  billingCountry: string;
  shippingFirstName: string;
  shippingLastName: string;
  shippingAddress: string;
  shippingPostcode: string;
  shippingCity: string;
  shippingCountry: string;
  orders: number;
  spent: number;
  averageBasket: number;
  discount: number;
  promoOrders: number;
  firstOrder: string | null;
  lastOrder: string | null;
  pieces: number;
  sizes: string;
  isVip: boolean;
}

export interface SegmentedSummary {
  clients: number;
  orders: number;
  revenue: number;
  pieces: number;
}

/** Nom affichable : facturation d'abord, repli sur le nom porté par la commande. */
export function clientDisplayName(c: SegmentedClient): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ") || c.customerName || "—";
}

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "");

/** Lignes du classeur Excel (une par client), colonnes en français. */
export function clientSheetRows(clients: SegmentedClient[]): Record<string, string | number>[] {
  return clients.map((c) => ({
    "E-mail": c.email,
    Prénom: c.firstName,
    Nom: c.lastName,
    "Nom (commande)": c.customerName,
    Téléphone: c.phone,
    Société: c.company,
    "Adresse facturation": c.billingAddress,
    "CP facturation": c.billingPostcode,
    "Ville facturation": c.billingCity,
    "Pays facturation": c.billingCountry,
    "Prénom livraison": c.shippingFirstName,
    "Nom livraison": c.shippingLastName,
    "Adresse livraison": c.shippingAddress,
    "CP livraison": c.shippingPostcode,
    "Ville livraison": c.shippingCity,
    "Pays livraison": c.shippingCountry,
    "Nb commandes": c.orders,
    "Total dépensé (€)": c.spent,
    "Panier moyen (€)": c.averageBasket,
    "Remises obtenues (€)": c.discount,
    "Commandes en promo": c.promoOrders,
    "Première commande": day(c.firstOrder),
    "Dernière commande": day(c.lastOrder),
    Pièces: c.pieces,
    "Tailles achetées": c.sizes,
    VIP: c.isVip ? "Oui" : "Non",
  }));
}

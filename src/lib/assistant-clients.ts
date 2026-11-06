// ─── Clients, commandes et statistiques pour l'assistant IA (lecture seule) ──────────────────
//
// Servis par :
//   • `GET /api/assistant/clients?recherche=`   un client B2B (Client + commandes TIO) ou du site
//     (commandes BtocOrder et HistOrder regroupées par email, fiche BtocCustomer en complément) ;
//   • `GET /api/assistant/commandes?numero=` ou `?jour=`   une commande précise, ou celles du site
//     d'une journée ;
//   • `GET /api/assistant/statistiques?debut=&fin=`   chiffres généraux d'une période, B2B et site,
//     avec la même période de l'an dernier.
// Règles des exports et des stats BtoC : commandes du site annulées, remboursées ou échouées
// exclues, remboursements partiels déduits ; B2B : commandes TIO (choix métier du recap), hors
// annulées. Montants du site en TTC (ce que le client a payé) et HT estimé au prorata de la TVA
// de chaque commande ; montants B2B au prix de gros, tels que portés par TIO.
//
// Fonctions PURES : les routes ne font que les requêtes.

import { globalCategoryLabel } from "./btoc-global-category";

/** Statuts du site qui ne comptent pas dans le chiffre d'affaires. */
export const STATUTS_EXCLUS = ["cancelled", "refunded", "failed"];

const nombre = (v: number | bigint | string | null | undefined) => Number(v ?? 0) || 0;
const arrondi = (v: number) => Math.round(v * 100) / 100;

// ─── Clients ────────────────────────────────────────────────────────────────

export interface CommandeResume {
  numero: string;
  date: string | null;
  montant: number | null;
  statut: string;
}

export interface LigneClientB2b {
  code: string;
  name: string;
  email: string | null;
  deliveryCity: string | null;
  deliveryPostcode: string | null;
  orderNumber: string | null;
  orderDate: Date | null;
  totalAmount: number | null;
  status: string | null;
  saison: string | null;
}

export interface ClientB2b {
  code: string;
  nom: string;
  email: string | null;
  ville: string | null;
  codePostal: string | null;
  commandes: number;
  montantTotal: number;
  /** Montant par saison, la plus récente d'abord. */
  parSaison: { saison: string; commandes: number; montant: number }[];
  dernieres: (CommandeResume & { saison: string | null })[];
}

/** Une ligne par commande (ou une seule sans commande) → un client par code. */
export function regrouperClientsB2b(lignes: LigneClientB2b[]): ClientB2b[] {
  const parCode = new Map<string, { client: ClientB2b; dates: Map<string, number> }>();
  for (const l of lignes) {
    let e = parCode.get(l.code);
    if (!e) {
      e = {
        client: {
          code: l.code, nom: l.name, email: l.email, ville: l.deliveryCity, codePostal: l.deliveryPostcode,
          commandes: 0, montantTotal: 0, parSaison: [], dernieres: [],
        },
        dates: new Map(),
      };
      parCode.set(l.code, e);
    }
    if (!l.orderNumber || l.status === "ANNULEE") continue;
    const c = e.client;
    c.commandes++;
    c.montantTotal += nombre(l.totalAmount);
    const saison = l.saison ?? "Sans saison";
    let s = c.parSaison.find((x) => x.saison === saison);
    if (!s) c.parSaison.push((s = { saison, commandes: 0, montant: 0 }));
    s.commandes++;
    s.montant += nombre(l.totalAmount);
    const t = l.orderDate?.getTime() ?? 0;
    e.dates.set(saison, Math.max(e.dates.get(saison) ?? 0, t));
    c.dernieres.push({ numero: l.orderNumber, date: l.orderDate?.toISOString() ?? null, montant: l.totalAmount, statut: l.status ?? "", saison: l.saison });
  }
  return [...parCode.values()].map(({ client, dates }) => ({
    ...client,
    montantTotal: arrondi(client.montantTotal),
    parSaison: client.parSaison
      .map((s) => ({ ...s, montant: arrondi(s.montant) }))
      .sort((a, b) => (dates.get(b.saison) ?? 0) - (dates.get(a.saison) ?? 0)),
    dernieres: client.dernieres.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 5),
  }));
}

export interface LigneCommandeSite {
  emailKey: string;
  email: string;
  nom: string | null;
  ville: string | null;
  pays: string | null;
  numero: string;
  date: Date;
  /** TTC, remboursements déduits. */
  montant: number;
  statut: string;
  /** "site" (WooCommerce actuel) ou "ancien site" (HistOrder). */
  origine: string;
}

export interface FicheClientSite {
  emailKey: string;
  prenom: string | null;
  nom: string | null;
  telephone: string | null;
  ville: string | null;
  pays: string | null;
  vip: boolean;
}

export interface ClientSite {
  nom: string;
  email: string;
  telephone: string | null;
  ville: string | null;
  pays: string | null;
  vip: boolean;
  commandes: number;
  depenseTtc: number;
  premiereCommande: string | null;
  derniereCommande: string | null;
  dernieres: (CommandeResume & { origine: string })[];
}

/** Commandes du site et de l'ancien site → un client par email, le meilleur client d'abord. */
export function regrouperClientsSite(commandes: LigneCommandeSite[], fiches: FicheClientSite[]): ClientSite[] {
  const parEmail = new Map<string, LigneCommandeSite[]>();
  for (const c of commandes) parEmail.set(c.emailKey, [...(parEmail.get(c.emailKey) ?? []), c]);
  const fichePar = new Map(fiches.map((f) => [f.emailKey, f]));
  return [...parEmail.entries()].map(([cle, liste]): ClientSite => {
    const comptees = liste.filter((c) => !STATUTS_EXCLUS.includes(c.statut));
    const triees = [...liste].sort((a, b) => b.date.getTime() - a.date.getTime());
    const f = fichePar.get(cle);
    const nomFiche = [f?.prenom, f?.nom].map((x) => x?.trim()).filter(Boolean).join(" ");
    const dates = comptees.map((c) => c.date.getTime());
    return {
      nom: nomFiche || triees.find((c) => c.nom?.trim())?.nom?.trim() || liste[0].email,
      email: liste[0].email,
      telephone: f?.telephone?.trim() || null,
      ville: f?.ville?.trim() || triees.find((c) => c.ville)?.ville || null,
      pays: f?.pays || triees.find((c) => c.pays)?.pays || null,
      vip: f?.vip ?? false,
      commandes: comptees.length,
      depenseTtc: arrondi(comptees.reduce((t, c) => t + c.montant, 0)),
      premiereCommande: dates.length ? new Date(Math.min(...dates)).toISOString() : null,
      derniereCommande: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
      dernieres: triees.slice(0, 5).map((c) => ({
        numero: c.numero, date: c.date.toISOString(), montant: arrondi(c.montant), statut: c.statut, origine: c.origine,
      })),
    };
  }).sort((a, b) => b.depenseTtc - a.depenseTtc);
}

// ─── Statistiques ───────────────────────────────────────────────────────────

export interface LigneVenteProduit {
  name: string;
  quantity: number | bigint;
  total: number;
}

/** Ventes du site par catégorie globale (déduite du titre, cf. btoc-global-category). */
export function ventesParCategorie(ventes: LigneVenteProduit[], remboursees: LigneVenteProduit[]) {
  const parCat = new Map<string, { categorie: string; pieces: number; montantHt: number }>();
  const ajouter = (l: LigneVenteProduit, signe: number) => {
    const categorie = globalCategoryLabel(l.name ?? "");
    const e = parCat.get(categorie) ?? { categorie, pieces: 0, montantHt: 0 };
    e.pieces += signe * nombre(l.quantity);
    e.montantHt += signe * nombre(l.total);
    parCat.set(categorie, e);
  };
  ventes.forEach((l) => ajouter(l, 1));
  remboursees.forEach((l) => ajouter(l, -1));
  return [...parCat.values()]
    .filter((c) => c.pieces > 0)
    .map((c) => ({ ...c, montantHt: arrondi(c.montantHt) }))
    .sort((a, b) => b.montantHt - a.montantHt);
}

export interface TotauxSiteRow {
  commandes: number | bigint;
  caTtc: number | null;
  caHt: number | null;
  articles: number | bigint | null;
  clients: number | bigint;
}

export function totauxSite(r: TotauxSiteRow | undefined) {
  const commandes = nombre(r?.commandes);
  const caTtc = arrondi(nombre(r?.caTtc));
  return {
    commandes,
    caTtc,
    caHt: arrondi(nombre(r?.caHt)),
    panierMoyenTtc: commandes ? arrondi(caTtc / commandes) : 0,
    articles: nombre(r?.articles),
    clients: nombre(r?.clients),
  };
}

export interface TotauxB2bRow {
  commandes: number | bigint;
  montant: number | null;
  clients: number | bigint;
  sansMontant: number | bigint;
}

export function totauxB2b(r: TotauxB2bRow | undefined) {
  return {
    commandes: nombre(r?.commandes),
    montant: arrondi(nombre(r?.montant)),
    clients: nombre(r?.clients),
    sansMontant: nombre(r?.sansMontant),
  };
}

/** Même période un an plus tôt (AAAA-MM-JJ) ; un 29 février devient le 28. */
export function anPrecedent(jour: string): string {
  const [a, m, j] = jour.split("-").map(Number);
  const dernier = new Date(Date.UTC(a - 1, m, 0)).getUTCDate();
  return `${a - 1}-${String(m).padStart(2, "0")}-${String(Math.min(j, dernier)).padStart(2, "0")}`;
}

/** Nombre de jours de [debut, fin], bornes incluses. */
export function joursEntre(debut: string, fin: string): number {
  return Math.round((Date.parse(`${fin}T12:00:00Z`) - Date.parse(`${debut}T12:00:00Z`)) / 86_400_000) + 1;
}

export function jourValide(j: string | null): j is string {
  return !!j && /^\d{4}-\d{2}-\d{2}$/.test(j) && !isNaN(Date.parse(`${j}T12:00:00Z`));
}

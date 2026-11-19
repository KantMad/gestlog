import { describe, it, expect } from "vitest";
import {
  buildProspects,
  enrichClients,
  clientSheetRow,
  prospectSheetRow,
  type AccountInput,
  type NewsletterContactInput,
  type ClientRow,
  type UnfinishedOrderInput,
} from "./btoc-contacts";

const acc = (o: Partial<AccountInput>): AccountInput => ({
  email: "x@y.fr", firstName: null, lastName: null, phone: null,
  postcode: null, city: null, country: null, createdAt: new Date("2026-06-08T11:00:00Z"), ...o,
});
const cart = (o: Partial<UnfinishedOrderInput>): UnfinishedOrderInput => ({
  email: "x@y.fr", firstName: null, lastName: null, customerName: null,
  postcode: null, city: null, country: null, lastDate: new Date("2026-10-01T10:00:00Z"), ...o,
});
const bv = (o: Partial<NewsletterContactInput>): NewsletterContactInput => ({
  email: "x@y.fr", subscribed: true, subscribedAt: new Date("2026-03-01T10:00:00Z"),
  firstName: null, lastName: null, phone: null, ...o,
});
const run = (o: Partial<Parameters<typeof buildProspects>[0]>) =>
  buildProspects({ clientEmails: new Set(), accounts: [], unfinished: [], brevo: [], ...o });

describe("buildProspects", () => {
  it("exclut tout e-mail déjà client, quelle que soit la casse", () => {
    const r = run({ clientEmails: new Set(["a@b.fr"]), accounts: [acc({ email: " A@B.fr " })], brevo: [bv({ email: "a@b.fr" })] });
    expect(r).toEqual([]);
  });

  it("fusionne les origines d'un même e-mail et garde la date la plus ancienne", () => {
    const [p] = run({
      accounts: [acc({ email: "a@b.fr", firstName: "Léa", city: "Lyon" })],
      unfinished: [cart({ email: "a@b.fr" })],
      brevo: [bv({ email: "A@b.fr", firstName: "Autre", phone: "+33600000000" })],
    });
    expect(p.origin).toBe("newsletter, compte, panier");
    expect(p.date).toBe("2026-03-01");
    expect(p.firstName).toBe("Léa"); // le compte prime sur Brevo
    expect(p.phone).toBe("+33600000000"); // Brevo complète les vides
    expect(p.city).toBe("Lyon");
  });

  it("ignore les contacts Brevo non inscrits", () => {
    const r = run({ brevo: [bv({ email: "a@b.fr", subscribed: false })] });
    expect(r).toEqual([]);
  });

  it("date du compte : Brevo, sinon création GestLog hors import initial, sinon vide", () => {
    const r = run({
      accounts: [
        acc({ email: "old@x.fr" }),
        acc({ email: "new@x.fr", createdAt: new Date("2026-09-15T08:00:00Z") }),
        acc({ email: "br@x.fr" }),
      ],
      brevo: [bv({ email: "br@x.fr", subscribed: false, subscribedAt: new Date("2025-12-24T10:00:00Z") })],
    });
    const by = Object.fromEntries(r.map((p) => [p.email, p]));
    expect(by["old@x.fr"].date).toBeNull();
    expect(by["new@x.fr"].date).toBe("2026-09-15");
    expect(by["br@x.fr"].date).toBe("2025-12-24");
    expect(by["br@x.fr"].origin).toBe("compte"); // contact Brevo non inscrit
  });

  it("découpe le nom de la commande quand le prénom/nom de facturation manque", () => {
    const [p] = run({ unfinished: [cart({ email: "a@b.fr", customerName: "Jean de la Tour" })] });
    expect([p.firstName, p.lastName, p.origin]).toEqual(["Jean", "de la Tour", "panier"]);
  });
});

describe("enrichClients / feuilles", () => {
  const cl: ClientRow = {
    email: "a@b.fr", phone: "", firstName: "A", lastName: "B", postcode: "75001", city: "Paris",
    country: "FR", lastOrder: "2026-11-01", ordersCount: 2, totalSpent: 123.456,
  };
  it("complète le téléphone depuis Brevo sans écraser le reste", () => {
    const [c] = enrichClients([cl], [bv({ email: "A@B.FR", phone: "0601", firstName: "Z" })]);
    expect(c.phone).toBe("0601");
    expect(c.firstName).toBe("A");
  });
  it("colonnes Excel dans l'ordre demandé", () => {
    expect(Object.keys(clientSheetRow(cl))).toEqual([
      "Email", "Téléphone", "Prénom", "Nom", "Code postal", "Ville", "Pays",
      "Dernière commande", "Nb commandes", "Total dépensé (€)",
    ]);
    expect(clientSheetRow(cl)["Total dépensé (€)"]).toBe(123.46);
    expect(Object.keys(prospectSheetRow({ ...cl, date: null, origin: "compte" })).slice(-2)).toEqual(["Date", "Origine"]);
  });
});

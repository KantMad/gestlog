import { describe, it, expect } from "vitest";
import {
  anPrecedent,
  joursEntre,
  regrouperClientsB2b,
  regrouperClientsSite,
  totauxSite,
  ventesParCategorie,
} from "./assistant-clients";

const boutique = { code: "FIC001", name: "Boutique fictive", email: null, deliveryCity: "Lyon", deliveryPostcode: "69001" };

describe("regrouperClientsB2b", () => {
  it("compte les commandes hors annulées, par saison, les plus récentes d'abord", () => {
    const [c] = regrouperClientsB2b([
      { ...boutique, orderNumber: "A1", orderDate: new Date("2026-03-01"), totalAmount: 1000, status: "VALIDEE", saison: "PE26" },
      { ...boutique, orderNumber: "A2", orderDate: new Date("2026-09-10"), totalAmount: 500.5, status: "EN_COURS", saison: "AH26" },
      { ...boutique, orderNumber: "A3", orderDate: new Date("2026-09-12"), totalAmount: 999, status: "ANNULEE", saison: "AH26" },
      { ...boutique, orderNumber: "A4", orderDate: new Date("2026-09-11"), totalAmount: null, status: "VALIDEE", saison: "AH26" },
    ]);
    expect(c).toMatchObject({ code: "FIC001", commandes: 3, montantTotal: 1500.5 });
    expect(c.parSaison).toEqual([
      { saison: "AH26", commandes: 2, montant: 500.5 },
      { saison: "PE26", commandes: 1, montant: 1000 },
    ]);
    expect(c.dernieres.map((d) => d.numero)).toEqual(["A4", "A2", "A1"]);
  });

  it("un client sans commande reste listé", () => {
    const [c] = regrouperClientsB2b([{ ...boutique, orderNumber: null, orderDate: null, totalAmount: null, status: null, saison: null }]);
    expect(c).toMatchObject({ commandes: 0, montantTotal: 0, dernieres: [] });
  });
});

describe("regrouperClientsSite", () => {
  const cmd = (numero: string, date: string, montant: number, statut = "completed", emailKey = "a@exemple.test") => ({
    emailKey, email: emailKey, nom: "Alex Fictif", ville: "Nantes", pays: "FR", numero, date: new Date(date), montant, statut, origine: "site",
  });

  it("additionne les commandes comptées, garde la fiche client et trie par dépense", () => {
    const clients = regrouperClientsSite(
      [
        cmd("1", "2025-01-05", 80),
        cmd("2", "2026-02-01", 120.4),
        cmd("3", "2026-03-01", 50, "cancelled"),
        cmd("9", "2026-01-01", 300, "completed", "b@exemple.test"),
      ],
      [{ emailKey: "a@exemple.test", prenom: "Alex", nom: "Fictif", telephone: "0600000000", ville: null, pays: null, vip: true }]
    );
    expect(clients.map((c) => c.email)).toEqual(["b@exemple.test", "a@exemple.test"]);
    expect(clients[1]).toMatchObject({
      nom: "Alex Fictif", telephone: "0600000000", ville: "Nantes", vip: true, commandes: 2, depenseTtc: 200.4,
      premiereCommande: "2025-01-05T00:00:00.000Z", derniereCommande: "2026-02-01T00:00:00.000Z",
    });
    expect(clients[1].dernieres.map((d) => d.numero)).toEqual(["3", "2", "1"]);
  });
});

describe("ventesParCategorie", () => {
  it("classe par titre et déduit les remboursements", () => {
    const cats = ventesParCategorie(
      [{ name: "Pull col rond fictif", quantity: BigInt(4), total: 400 }, { name: "Chemise fictive", quantity: 1, total: 90 }],
      [{ name: "Pull col rond fictif", quantity: 1, total: 100 }]
    );
    expect(cats[0]).toMatchObject({ pieces: 3, montantHt: 300 });
    expect(cats).toHaveLength(2);
  });
});

describe("totaux et dates", () => {
  it("panier moyen, et rien plutôt que NaN", () => {
    expect(totauxSite({ commandes: BigInt(4), caTtc: 410, caHt: 341.67, articles: BigInt(7), clients: BigInt(3) }))
      .toEqual({ commandes: 4, caTtc: 410, caHt: 341.67, panierMoyenTtc: 102.5, articles: 7, clients: 3 });
    expect(totauxSite(undefined).panierMoyenTtc).toBe(0);
  });

  it("an précédent et longueur de période", () => {
    expect(anPrecedent("2026-11-06")).toBe("2025-11-06");
    expect(anPrecedent("2028-02-29")).toBe("2027-02-28");
    expect(joursEntre("2026-01-01", "2026-12-31")).toBe(365);
    expect(joursEntre("2026-03-29", "2026-03-29")).toBe(1);
  });
});

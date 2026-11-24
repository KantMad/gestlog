import { describe, expect, it } from "vitest";
import { amountIssue, reconcile, type SfSide, type WooSide } from "./marketplace-reconcile";
import { mapSfOrder } from "./shoppingfeed";

const sf = (o: Partial<SfSide>): SfSide => ({
  sfId: "1",
  reference: "LR-1",
  storeReference: "100",
  channel: "laredoutemirakl",
  status: "shipped",
  isTest: false,
  createdAt: "2026-11-20T10:00:00.000Z",
  day: "2026-11-20",
  total: 83.3,
  qty: 1,
  ...o,
});
const woo = (o: Partial<WooSide>): WooSide => ({
  wooId: 100,
  orderNumber: "87000",
  marketplaceRef: "LR-1",
  marketplace: "laredoutemirakl",
  status: "lpc_delivered",
  total: 83,
  totalRefunded: 0,
  qty: 1,
  day: "2026-11-20",
  ...o,
});

describe("amountIssue", () => {
  it("accepte l'égalité et le petit surcoût La Redoute (jusqu'à 1 € par article)", () => {
    expect(amountIssue(83, 83, 1)).toBeNull();
    expect(amountIssue(83.3, 83, 1)).toBeNull();
    expect(amountIssue(86.8, 86, 1)).toBeNull();
    expect(amountIssue(347.2, 346, 4)).toBeNull();
    expect(amountIssue(90, 83, 1)).toMatch(/montant/);
    expect(amountIssue(241.5, 200, 5)).toMatch(/montant/);
    expect(amountIssue(82, 83, 1)).toMatch(/montant/);
  });
});

describe("reconcile", () => {
  it("rapproche par n° marketplace, sinon par id Woo", () => {
    const rows = reconcile([sf({}), sf({ sfId: "2", reference: "LR-2", storeReference: "101" })], [woo({}), woo({ wooId: 101, marketplaceRef: null })], null);
    expect(rows.map((r) => [r.reference, r.kind, r.wooId])).toEqual([
      ["LR-1", "ok", 100],
      ["LR-2", "ok", 101],
    ]);
  });

  it("repère les écarts d'articles et de statut", () => {
    const [r] = reconcile([sf({ status: "refunded", qty: 2, total: 166.6 })], [woo({ qty: 1, total: 166 })], null);
    expect(r.kind).toBe("ecart");
    expect(r.issues).toEqual(["articles : 2 sur la marketplace, 1 dans Woo", "remboursée sur la marketplace, pas dans Woo"]);
    const [r2] = reconcile([sf({})], [woo({ status: "cancelled" })], null);
    expect(r2.issues).toEqual(["annulée dans Woo, pas sur la marketplace"]);
    const [r3] = reconcile([sf({ status: "refunded" })], [woo({ totalRefunded: 83 })], null);
    expect(r3.kind).toBe("ok");
  });

  it("distingue absente de Woo, en attente et annulée", () => {
    const rows = reconcile(
      [
        sf({ reference: "A", storeReference: "555" }),
        sf({ reference: "B", storeReference: null, status: "waiting_store_acceptance" }),
        sf({ reference: "C", storeReference: null, status: "refused" }),
        sf({ reference: "D", storeReference: null, createdAt: "2026-11-24T08:00:00.000Z", day: "2026-11-24" }),
        sf({ reference: "T", isTest: true }),
      ],
      [],
      "2026-11-24T04:30:00.000Z"
    );
    const k = Object.fromEntries(rows.map((r) => [r.reference, [r.kind, r.issues[0]]]));
    expect(k).toEqual({
      A: ["absente_woo", "commande Woo n°555 introuvable"],
      B: ["en_attente", "pas encore acceptée"],
      C: ["annulee", "annulée ou refusée avant import"],
      D: ["en_attente", "passée après la dernière synchro Woo"],
    });
  });

  it("signale une commande Woo marketplace absente de Shopping Feed, ignore les commandes du site", () => {
    const rows = reconcile([], [woo({}), woo({ wooId: 7, marketplace: null, marketplaceRef: null })], null);
    expect(rows.map((r) => [r.wooId, r.kind])).toEqual([[100, "absente_sf"]]);
  });
});

describe("mapSfOrder", () => {
  it("garde les montants et articles, jamais les adresses", () => {
    const o = mapSfOrder({
      id: 23711186089,
      reference: "LRFR1-A",
      storeReference: "161868",
      status: "shipped",
      isTest: false,
      createdAt: "2026-11-24T11:00:40+01:00",
      channelId: 48894,
      payment: { totalAmount: 90.3, productAmount: 90.3, shippingAmount: 0, currency: "EUR" },
      shippingAddress: { lastName: "Doe", email: "x@y.z" },
      items: [{ reference: "119039", name: "Pull", quantity: 2, price: 45.15, status: "shipped" }],
      _embedded: { channel: { id: 48894, name: "laredoutemirakl" } },
    });
    expect(o).toMatchObject({ sfId: "23711186089", channel: "laredoutemirakl", itemCount: 2, totalAmount: 90.3 });
    expect(JSON.stringify(o)).not.toMatch(/Doe|x@y/);
  });
});

describe("anomalies traitées", () => {
  const res = { note: "recréée à la main, Woo 87123", by: "Géraldine", at: "2026-11-24T16:00:00.000Z" };
  it("passe une anomalie traitée en « traitee », garde le motif d'origine", () => {
    const [r] = reconcile([sf({ reference: "A", storeReference: "555" })], [], null, new Map([["A", res]]));
    expect(r.kind).toBe("traitee");
    expect(r.issues).toEqual(["commande Woo n°555 introuvable"]);
    expect(r.resolution).toEqual(res);
  });
  it("ne touche pas une commande cohérente ou en attente", () => {
    const rows = reconcile(
      [sf({}), sf({ reference: "B", storeReference: null, status: "waiting_store_acceptance" })],
      [woo({})],
      null,
      new Map([["LR-1", res], ["B", res]])
    );
    expect(rows.map((r) => [r.reference, r.kind])).toEqual([
      ["B", "en_attente"],
      ["LR-1", "ok"],
    ]);
  });
});

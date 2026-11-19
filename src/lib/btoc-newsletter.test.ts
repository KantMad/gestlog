import { describe, it, expect } from "vitest";
import { dedupeRows, newsletterListIds, newsletterSheetRow, toNewsletterRow } from "./btoc-newsletter";

const NL = [8, 9, 12];

describe("newsletterListIds", () => {
  it("lit la variable d'env, sinon FR/EN/Boutique Réaumur", () => {
    expect(newsletterListIds("8, 20")).toEqual([8, 20]);
    expect(newsletterListIds("")).toEqual(NL);
    expect(newsletterListIds("abc")).toEqual(NL);
  });
});

describe("toNewsletterRow", () => {
  const base = {
    id: 42, email: " Lea@Mail.FR ", emailBlacklisted: false, listIds: [13, 8, 8],
    createdAt: "2026-03-01T10:00:00.000+01:00", modifiedAt: "2026-04-01T10:00:00Z",
    attributes: { PRENOM: "Léa", NOM: "Martin", SMS: 33600000000 },
  };

  it("normalise l'e-mail et lit l'identité Brevo", () => {
    const r = toNewsletterRow(base, NL)!;
    expect(r.email).toBe("lea@mail.fr");
    expect([r.firstName, r.lastName, r.phone]).toEqual(["Léa", "Martin", "33600000000"]);
    expect(r.listIds).toEqual([8, 13]);
    expect(r.subscribed).toBe(true);
    expect(r.subscribedAt).toBe("2026-03-01T09:00:00.000Z");
  });

  it("désinscrit = blacklisté, même s'il reste dans une liste", () => {
    const r = toNewsletterRow({ ...base, emailBlacklisted: true }, NL)!;
    expect([r.subscribed, r.inNewsletterList, r.blacklisted]).toEqual([false, true, true]);
  });

  it("sorti d'une liste newsletter (listUnsubscribed) = désinscrit mais connu", () => {
    const r = toNewsletterRow({ ...base, listIds: [13], listUnsubscribed: [9] }, NL)!;
    expect([r.subscribed, r.inNewsletterList]).toEqual([false, true]);
  });

  it("listes du plugin Woo seules (5, 13) : pas newsletter", () => {
    const r = toNewsletterRow({ ...base, listIds: [5, 13] }, NL)!;
    expect([r.subscribed, r.inNewsletterList]).toEqual([false, false]);
  });

  it("écarte les contacts sans e-mail", () => {
    expect(toNewsletterRow({ ...base, email: "" }, NL)).toBeNull();
    expect(toNewsletterRow({ ...base, email: null }, NL)).toBeNull();
  });
});

describe("dedupeRows", () => {
  it("garde l'inscrit, sinon le plus récemment modifié", () => {
    const a = toNewsletterRow({ email: "a@b.fr", emailBlacklisted: true, listIds: [8], modifiedAt: "2026-05-01T00:00:00Z" }, NL)!;
    const b = toNewsletterRow({ email: "A@b.fr", emailBlacklisted: false, listIds: [8], modifiedAt: "2026-01-01T00:00:00Z" }, NL)!;
    expect(dedupeRows([a, b])).toEqual([b]);
    const c = { ...a, brevoModifiedAt: "2026-06-01T00:00:00.000Z" };
    expect(dedupeRows([a, c])).toEqual([c]);
  });
});

describe("newsletterSheetRow", () => {
  it("colonnes et libellés", () => {
    const row = newsletterSheetRow({
      email: "a@b.fr", firstName: "A", lastName: "B", phone: "", lists: "FR", subscribed: false,
      subscribedAt: "2026-01-02", unsubscribedAt: "2026-02-03", ordersCount: 0, totalSpent: 0, lastOrder: null,
    });
    expect(row.Statut).toBe("Désinscrit");
    expect(row["A commandé"]).toBe("Non");
    expect(Object.keys(row)).toHaveLength(12);
  });
});

import { describe, it, expect, beforeAll } from "vitest";
import { signSession, verifySession } from "./session";

beforeAll(() => {
  process.env.SESSION_SECRET = "secret-de-test-unitaire-123456";
});

describe("signSession / verifySession", () => {
  it("round-trip : un jeton signé est vérifié et renvoie le payload", async () => {
    const token = await signSession("user1", "ADMIN", null);
    const payload = await verifySession(token);
    expect(payload).toEqual({ uid: "user1", role: "ADMIN", scr: null });
  });

  it("conserve la liste d'écrans (scr)", async () => {
    const token = await signSession("u2", "USER", ["/btoc", "/reassort"]);
    const payload = await verifySession(token);
    expect(payload?.scr).toEqual(["/btoc", "/reassort"]);
  });

  it("jeton falsifié (signature modifiée) → null", async () => {
    const token = await signSession("u3", "USER", null);
    const [data] = token.split(".");
    const forged = `${data}.AAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    expect(await verifySession(forged)).toBeNull();
  });

  it("payload modifié (sans re-signer) → null", async () => {
    const token = await signSession("u4", "USER", null);
    const [, sig] = token.split(".");
    // remplace le data par un payload forgé (rôle ADMIN) avec l'ancienne signature
    const tampered = `${btoa('{"uid":"u4","role":"ADMIN","scr":null,"exp":9999999999999}').replace(/=+$/, "")}.${sig}`;
    expect(await verifySession(tampered)).toBeNull();
  });

  it("jeton expiré → null", async () => {
    const token = await signSession("u5", "USER", null, -1000); // déjà expiré
    expect(await verifySession(token)).toBeNull();
  });

  it("jeton absent ou malformé → null", async () => {
    expect(await verifySession(undefined)).toBeNull();
    expect(await verifySession("sans-point")).toBeNull();
    expect(await verifySession(".")).toBeNull();
  });
});

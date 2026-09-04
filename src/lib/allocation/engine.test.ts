import { describe, it, expect } from "vitest";
import { runAllocation } from "./engine";
import { sumQuantities } from "@/lib/utils";
import type { AllocationInput, ClientConfig } from "./types";

const cfg = (ranking: number): ClientConfig => ({
  ranking,
  maxReductionOrder: 50,
  maxReductionLine: 50, // valeur qui déclenchait la restauration « fantôme »
  minDeliveryThreshold: 0,
  rotationScore: 0,
});

function input(available: Record<string, Record<string, number>>): AllocationInput {
  return {
    seasonId: "s1",
    available: new Map(Object.entries(available)),
    // 2 boutiques, même produit, taille unique M : 20 demandées chacune (40 au total).
    demands: [
      { clientId: "A", clientOrderId: "oA", productId: "P", sizeScale: ["M"], requested: { M: 20 } },
      { clientId: "B", clientOrderId: "oB", productId: "P", sizeScale: ["M"], requested: { M: 20 } },
    ],
    clientConfigs: new Map([
      ["A", cfg(1)],
      ["B", cfg(2)],
    ]),
  };
}

const totalAllocated = (r: ReturnType<typeof runAllocation>) =>
  r.lines.reduce((s, l) => s + sumQuantities(l.allocated), 0);

describe("runAllocation — un surplus sur une taille ne masque pas le manque d'une autre", () => {
  // Cas réel CCAH26_PU02/811 : reçu TOTAL (144) >= demandé TOTAL (142) → l'ancien raccourci
  // « stock suffisant » servait tout le monde en plein, alors que M était à 31 pour 32
  // demandés. On allouait une 32e pièce de M inexistante et le -1 n'apparaissait nulle part.
  it("le manque d'une taille est appliqué même si le total reçu couvre le total demandé", () => {
    const r = runAllocation({
      seasonId: "s1",
      // M : 31 pour 32 demandés (manque 1) · L : 45 pour 44 demandés (surplus 1)
      available: new Map([["P", { M: 31, L: 45 }]]),
      demands: [
        { clientId: "A", clientOrderId: "oA", productId: "P", sizeScale: ["M", "L"], requested: { M: 20, L: 20 } },
        { clientId: "B", clientOrderId: "oB", productId: "P", sizeScale: ["M", "L"], requested: { M: 12, L: 24 } },
      ],
      clientConfigs: new Map([
        ["A", cfg(1)],
        ["B", cfg(2)],
      ]),
    });
    const allocM = r.lines.reduce((s, l) => s + (l.allocated.M ?? 0), 0);
    const allocL = r.lines.reduce((s, l) => s + (l.allocated.L ?? 0), 0);
    expect(allocM).toBe(31); // et non 32 : on n'invente pas la pièce manquante
    expect(allocL).toBe(44); // 44 demandés / 45 reçus → le surplus reste non alloué
    // Le -1 est bien porté par une boutique (total alloué = 75, pas 76).
    const total = r.lines.reduce((s, l) => s + sumQuantities(l.allocated), 0);
    expect(total).toBe(75);
    expect(r.lines.some((l) => sumQuantities(l.allocated) < sumQuantities(l.original))).toBe(true);
  });
});

describe("runAllocation — à rang égal, on égalise le % de coupe (pas les pièces)", () => {
  // Deux boutiques de MÊME rang, commandes de tailles très différentes (40 vs 10) sur la
  // même taille. Reçu 25 sur 50 demandés → 50 % de manque.
  // Attendu : chacune perd ~50 % de SA commande (20 et 5), et non « autant de pièces ».
  const equalRank: AllocationInput = {
    seasonId: "s1",
    available: new Map([["P", { M: 25 }]]),
    demands: [
      { clientId: "GROS", clientOrderId: "o1", productId: "P", sizeScale: ["M"], requested: { M: 40 } },
      { clientId: "PETIT", clientOrderId: "o2", productId: "P", sizeScale: ["M"], requested: { M: 10 } },
    ],
    clientConfigs: new Map([
      ["GROS", cfg(1)],
      ["PETIT", cfg(1)], // même rang
    ]),
  };

  it("deux boutiques de même rang subissent le même pourcentage de coupe", () => {
    const r = runAllocation(equalRank);
    const gros = r.lines.find((l) => l.clientId === "GROS")!;
    const petit = r.lines.find((l) => l.clientId === "PETIT")!;
    const pctGros = 1 - sumQuantities(gros.allocated) / 40;
    const pctPetit = 1 - sumQuantities(petit.allocated) / 10;
    // Même taux de service à ±1 pièce près (granularité entière).
    expect(Math.abs(pctGros - pctPetit)).toBeLessThan(0.11);
    expect(sumQuantities(gros.allocated) + sumQuantities(petit.allocated)).toBe(25);
    // La grosse commande absorbe plus de pièces en valeur absolue, c'est voulu.
    expect(sumQuantities(gros.allocated)).toBeGreaterThan(sumQuantities(petit.allocated));
  });

  it("à déficit égal, le meilleur rang est servi en premier", () => {
    const r = runAllocation({
      ...equalRank,
      available: new Map([["P", { M: 1 }]]), // 1 seule pièce à départager
      demands: [
        { clientId: "A", clientOrderId: "o1", productId: "P", sizeScale: ["M"], requested: { M: 10 } },
        { clientId: "B", clientOrderId: "o2", productId: "P", sizeScale: ["M"], requested: { M: 10 } },
      ],
      clientConfigs: new Map([
        ["A", cfg(2)],
        ["B", cfg(1)], // meilleur rang
      ]),
    });
    expect(r.lines.find((l) => l.clientId === "B")!.allocated.M).toBe(1);
    expect(r.lines.find((l) => l.clientId === "A")!.allocated.M ?? 0).toBe(0);
  });
});

describe("runAllocation — l'alloué ne dépasse JAMAIS la commande d'une boutique", () => {
  // Cas réel (CCAH26_PU02/005) : le produit est globalement en manque, MAIS une taille a été
  // sur-livrée (XL demandé 4 / reçu 6). Le pro-rata non plafonné servait alors les boutiques
  // au-dessus de leur commande. Le reliquat doit rester NON alloué (→ « Répartir surplus »).
  const surplusInput: AllocationInput = {
    seasonId: "s1",
    available: new Map([["P", { M: 12, XL: 6 }]]), // M en manque (12/20), XL en excès (6/4)
    demands: [
      { clientId: "A", clientOrderId: "oA", productId: "P", sizeScale: ["M", "XL"], requested: { M: 10, XL: 2 } },
      { clientId: "B", clientOrderId: "oB", productId: "P", sizeScale: ["M", "XL"], requested: { M: 10, XL: 2 } },
    ],
    clientConfigs: new Map([
      ["A", cfg(1)],
      ["B", cfg(2)],
    ]),
  };

  it("une taille sur-livrée ne fait pas dépasser la commande (surplus laissé de côté)", () => {
    const r = runAllocation(surplusInput);
    for (const l of r.lines) {
      for (const [size, req] of Object.entries(l.original)) {
        expect(l.allocated[size] ?? 0).toBeLessThanOrEqual(req);
      }
      expect(sumQuantities(l.allocated)).toBeLessThanOrEqual(sumQuantities(l.original));
    }
    // XL : 4 demandés au total, 6 reçus → on n'en alloue que 4, jamais 6.
    const xl = r.lines.reduce((s, l) => s + (l.allocated.XL ?? 0), 0);
    expect(xl).toBe(4);
  });
});

describe("runAllocation — l'alloué ne dépasse jamais le reçu", () => {
  it("0 reçu → 0 alloué (pas de pièce fantôme via le cap de réduction)", () => {
    const r = runAllocation(input({})); // aucune réception pour P
    expect(totalAllocated(r)).toBe(0);
    expect(r.lines.every((l) => sumQuantities(l.allocated) === 0)).toBe(true);
    expect(r.lines.every((l) => l.status === "ANNULE")).toBe(true);
  });

  it("reçu partiel → total alloué = total reçu (même avec un cap ligne à 50%)", () => {
    const r = runAllocation(input({ P: { M: 10 } })); // 10 reçus pour 40 demandés
    expect(totalAllocated(r)).toBe(10);
  });

  it("reçu suffisant → tout est alloué", () => {
    const r = runAllocation(input({ P: { M: 40 } }));
    expect(totalAllocated(r)).toBe(40);
    expect(r.lines.every((l) => l.reductionReason === "NONE")).toBe(true);
  });
});

describe("runAllocation — on ne transforme JAMAIS une taille en une autre", () => {
  // Cas réel CCAH26_PU19/205 : 1 seule pièce reçue en M, mais plusieurs boutiques en
  // demandent. Pour supprimer un « trou de taille » (S et L servis, M vide), le moteur
  // déplaçait 1 pièce d'une taille extrême vers le M : le total de la boutique était
  // conservé, mais on allouait 2 M alors qu'un seul existait physiquement.
  const cfgGap = (ranking: number): ClientConfig => ({
    ranking,
    maxReductionOrder: 100,
    maxReductionLine: 100,
    minDeliveryThreshold: 0,
    rotationScore: 0,
  });
  const SCALE = ["S", "M", "L"];

  const res = runAllocation({
    seasonId: "s1",
    // 1 seul M disponible, du stock en S et L.
    available: new Map([["P", { S: 6, M: 1, L: 6 }]]),
    demands: [
      { clientId: "A", clientOrderId: "oA", productId: "P", sizeScale: SCALE, requested: { S: 3, M: 3, L: 3 } },
      { clientId: "B", clientOrderId: "oB", productId: "P", sizeScale: SCALE, requested: { S: 3, M: 3, L: 3 } },
      { clientId: "C", clientOrderId: "oC", productId: "P", sizeScale: SCALE, requested: { S: 3, M: 3, L: 3 } },
    ],
    clientConfigs: new Map([["A", cfgGap(1)], ["B", cfgGap(2)], ["C", cfgGap(3)]]),
  });

  it("n'alloue jamais plus que le reçu, taille par taille", () => {
    const bySize: Record<string, number> = {};
    for (const l of res.lines) {
      for (const [s, q] of Object.entries(l.allocated)) bySize[s] = (bySize[s] || 0) + q;
    }
    expect(bySize.M ?? 0).toBeLessThanOrEqual(1);
    expect(bySize.S ?? 0).toBeLessThanOrEqual(6);
    expect(bySize.L ?? 0).toBeLessThanOrEqual(6);
  });

  it("ne laisse pas de trou de taille dans une allocation", () => {
    for (const l of res.lines) {
      const served = SCALE.map((s) => (l.allocated[s] || 0) > 0);
      const first = served.indexOf(true);
      const last = served.lastIndexOf(true);
      if (first === -1) continue;
      // Entre la première et la dernière taille servie, aucune taille à 0.
      expect(served.slice(first, last + 1).every(Boolean)).toBe(true);
    }
  });
});

describe("runAllocation — trou incomblable : on retire un bloc, on n'invente pas la taille", () => {
  // Aucune pièce de M n'a été reçue. La boutique a commandé S, M et L : la servir en S et L
  // laisserait un trou en M (règle 1). Comme on ne peut pas fabriquer un M, le moteur retire
  // le plus petit des deux blocs qui entourent le trou et rend les pièces au stock.
  const SCALE = ["S", "M", "L"];
  const res = runAllocation({
    seasonId: "s1",
    available: new Map([["P", { S: 5, L: 5 }]]), // M absent du stock
    demands: [
      { clientId: "A", clientOrderId: "oA", productId: "P", sizeScale: SCALE, requested: { S: 2, M: 2, L: 2 } },
    ],
    clientConfigs: new Map([
      ["A", { ranking: 1, maxReductionOrder: 100, maxReductionLine: 100, minDeliveryThreshold: 0, rotationScore: 0 }],
    ]),
  });

  const alloc = res.lines[0].allocated;

  it("n'invente aucune pièce dans la taille manquante", () => {
    expect(alloc.M ?? 0).toBe(0);
  });

  it("ne laisse pas de trou : un seul bloc contigu subsiste", () => {
    const served = SCALE.filter((s) => (alloc[s] || 0) > 0);
    // S et L ne peuvent pas être servis ensemble sans M au milieu.
    expect(served).not.toEqual(["S", "L"]);
    expect(served.length).toBeLessThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Trous de taille et redistribution — cas réels THRPOML_902/405 (AH26)
// ─────────────────────────────────────────────────────────────────────────────

const SCALE = ["S", "M", "L", "XL", "2XL", "3XL", "4XL"];

const run = (
  available: Record<string, number>,
  demandes: { id: string; req: Record<string, number>; rank?: number }[]
) =>
  runAllocation({
    seasonId: "s1",
    available: new Map([["P", available]]),
    demands: demandes.map((d) => ({
      clientId: d.id,
      clientOrderId: `o${d.id}`,
      productId: "P",
      sizeScale: SCALE,
      requested: d.req,
    })),
    clientConfigs: new Map(
      demandes.map((d) => [
        d.id,
        {
          ranking: d.rank ?? 1,
          maxReductionOrder: 100,
          maxReductionLine: 100,
          minDeliveryThreshold: 0,
          rotationScore: 0,
        },
      ])
    ),
  } as AllocationInput);

const allocOf = (res: ReturnType<typeof run>, id: string) =>
  res.lines.find((l) => l.clientId === id)!.allocated;

describe("une taille JAMAIS commandée n'est pas un trou", () => {
  // Cas réel : Dole commande M, L, XL et 3XL — sans 2XL. Jugée sur la grille complète
  // S→4XL, son allocation semblait « trouée » en 2XL et la règle lui retirait son 3XL,
  // qui restait ensuite inutilisé.
  it("garde le 3XL d'une boutique qui n'a pas commandé de 2XL", () => {
    const res = run(
      { M: 1, L: 3, XL: 1, "2XL": 0, "3XL": 1 },
      [{ id: "DOLE", req: { M: 1, L: 3, XL: 1, "3XL": 1 } }]
    );
    expect(allocOf(res, "DOLE")).toEqual({ M: 1, L: 3, XL: 1, "3XL": 1 });
  });

  it("détecte en revanche un VRAI trou : taille commandée et non servie au milieu", () => {
    // Ici le 2XL est commandé mais indisponible : servir XL puis 3XL laisserait un trou.
    const res = run(
      { M: 1, L: 1, XL: 1, "2XL": 0, "3XL": 1 },
      [{ id: "A", req: { M: 1, L: 1, XL: 1, "2XL": 1, "3XL": 1 } }]
    );
    expect(allocOf(res, "A")["3XL"] ?? 0).toBe(0);
  });
});

describe("redistribution du stock resté libre", () => {
  it("ne laisse pas une pièce inutilisée si une boutique l'a commandée", () => {
    // 2 boutiques, 3 M disponibles pour 2 + 2 demandés : tout doit partir.
    const res = run({ M: 3 }, [
      { id: "A", req: { M: 2 } },
      { id: "B", req: { M: 2 } },
    ]);
    const total = res.lines.reduce((s, l) => s + sumQuantities(l.allocated), 0);
    expect(total).toBe(3);
  });

  it("ne crée PAS de trou en redistribuant une taille extrême", () => {
    // Le 3XL restant ne doit pas être posé chez une boutique servie jusqu'au L :
    // ça rouvrirait le trou que la règle vient de fermer.
    const res = run({ M: 2, L: 2, XL: 0, "2XL": 0, "3XL": 2 }, [
      { id: "A", req: { M: 2, L: 2, XL: 1, "2XL": 1, "3XL": 1 } },
    ]);
    expect(allocOf(res, "A")["3XL"] ?? 0).toBe(0);
  });
});

describe("emprunt d'une taille pour éviter de sacrifier un bloc", () => {
  it("prélève 1 pièce chez une boutique qui en a 2, plutôt que de retirer un bloc", () => {
    // A a besoin d'un XL pour ne pas avoir de trou ; il n'en reste aucun en stock,
    // mais B en a 2 → B passe à 1 (aucun trou chez elle) et A est complète.
    const res = run({ M: 3, L: 3, XL: 2, "2XL": 1 }, [
      { id: "A", req: { M: 1, L: 1, XL: 1, "2XL": 1 }, rank: 2 },
      { id: "B", req: { M: 2, L: 2, XL: 2 }, rank: 1 },
    ]);
    const a = allocOf(res, "A");
    const b = allocOf(res, "B");
    // A garde son 2XL grâce au XL emprunté.
    expect(a["XL"]).toBe(1);
    expect(a["2XL"]).toBe(1);
    // B garde au moins 1 XL : on ne descend jamais un donneur à zéro.
    expect(b["XL"]).toBeGreaterThanOrEqual(1);
  });

  it("ne descend jamais un donneur à zéro : sans donneur possible, le bloc est sacrifié", () => {
    // Un seul XL pour deux boutiques qui en demandent chacune une. Celle qui ne l'a pas
    // se retrouve avec un trou (M, L, [XL], 2XL) ; l'autre n'a qu'UN XL, donc rien à
    // prêter. Le trou est alors fermé en retirant le bloc de droite, et le donneur
    // potentiel conserve son XL.
    const res = run({ M: 2, L: 2, XL: 1, "2XL": 2 }, [
      { id: "A", req: { M: 1, L: 1, XL: 1, "2XL": 1 }, rank: 1 },
      { id: "B", req: { M: 1, L: 1, XL: 1, "2XL": 1 }, rank: 2 },
    ]);
    const withXl = allocOf(res, (allocOf(res, "A")["XL"] ?? 0) > 0 ? "A" : "B");
    const without = allocOf(res, (allocOf(res, "A")["XL"] ?? 0) > 0 ? "B" : "A");
    // Le porteur du XL le garde : on ne le descend jamais à zéro pour dépanner l'autre.
    expect(withXl["XL"]).toBe(1);
    // Celle qui n'en a pas perd son 2XL plutôt que d'afficher un trou.
    expect(without["2XL"] ?? 0).toBe(0);
    // Et aucune des deux n'a de trou.
    expect(res.lines.every((l) => sumQuantities(l.allocated) > 0)).toBe(true);
  });
});

describe("invariants après correction", () => {
  it("n'alloue jamais plus que le commandé ni plus que le reçu", () => {
    const res = run({ S: 9, M: 38, L: 43, XL: 32, "2XL": 18, "3XL": 13, "4XL": 3 }, [
      { id: "A", req: { M: 3, L: 3, XL: 2, "2XL": 1, "3XL": 1 } },
      { id: "B", req: { M: 1, L: 3, XL: 1, "3XL": 1 } },
      { id: "C", req: { S: 1, M: 2, L: 2, XL: 1, "2XL": 1 } },
    ]);
    const bySize: Record<string, number> = {};
    for (const l of res.lines) {
      for (const [s, q] of Object.entries(l.allocated)) {
        expect(q).toBeLessThanOrEqual(l.original[s] ?? 0);
        bySize[s] = (bySize[s] ?? 0) + q;
      }
    }
    // Tout le monde est servi intégralement : le stock couvre chaque taille.
    expect(res.lines.every((l) => sumQuantities(l.allocated) === sumQuantities(l.original))).toBe(true);
    expect(bySize["3XL"]).toBe(2);
  });
});

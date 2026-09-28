"use client";

import { cn, formatNumber } from "@/lib/utils";

// Avertit quand le CA affiché ne repose pas sur la même base d'un élément comparé à
// l'autre. Cf. src/lib/amount-coverage.ts pour le pourquoi et les seuils.
//
// 🔴 Signalé le 28/09/2026 : « MCS Homme W25 » (31,9 % de pièces valorisées, 524 668 €
// affichés) comparé à « MCS Homme W26 » (100 %, 1 633 676 €) laissait croire à un CA
// triplé. Les volumes étaient comparables — 43 266 contre 40 708 pièces — et le prix
// unitaire presque identique là où il existe : 38,02 € contre 39,86 €.
//
// ⚠️ On ne masque JAMAIS les chiffres et on n'extrapole RIEN : les quantités restent
// fiables et constituent la lecture de repli.

export interface Couverture {
  pieces: number;
  piecesWithoutAmount: number;
  percent: number;
  pricePerPiece: number;
  verdict: "fiable" | "partiel" | "inexploitable";
}

export interface ElementCompare {
  name: string;
  coverage: Couverture;
}

export function CouvertureAlerte({
  items,
  prices,
}: {
  items: ElementCompare[];
  prices?: { comparable: boolean; ecart: number };
}) {
  const douteux = items.filter((i) => i.coverage.verdict !== "fiable");
  const prixIncomparables = !!prices && !prices.comparable && prices.ecart > 0;
  if (douteux.length === 0 && !prixIncomparables) return null;

  const grave = douteux.some((i) => i.coverage.verdict === "inexploitable");
  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border p-4 text-sm",
        grave
          ? "border-red-300 bg-red-50 text-red-900"
          : "border-amber-300 bg-amber-50 text-amber-900"
      )}
    >
      <p className="font-semibold">
        {grave ? "Le CA affiché n'est pas comparable" : "Le CA affiché est incomplet"}
      </p>
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={i.name}>
            <strong>{i.name}</strong> — {i.coverage.percent.toLocaleString("fr-FR")} % des
            pièces portent un montant
            {i.coverage.piecesWithoutAmount > 0 && (
              <>
                {" "}
                ({formatNumber(i.coverage.piecesWithoutAmount)} sans montant sur{" "}
                {formatNumber(i.coverage.pieces)})
              </>
            )}
            {i.coverage.pricePerPiece > 0 && (
              <> · {i.coverage.pricePerPiece.toLocaleString("fr-FR")} €/pièce là où il existe</>
            )}
          </li>
        ))}
      </ul>
      {prixIncomparables && (
        <p>
          Les prix unitaires diffèrent de{" "}
          <strong>{prices!.ecart.toLocaleString("fr-FR")} %</strong> entre les deux éléments.
          Un tel écart vient presque toujours d&apos;un montant manquant à la source, pas
          d&apos;une évolution de prix.
        </p>
      )}
      <p className="text-xs opacity-80">
        Les <strong>quantités</strong> ne sont pas affectées : elles restent la lecture
        fiable. Le montant vient de la commande importée — quand la colonne est vide à la
        source, il n&apos;est ni reconstitué ni estimé.
      </p>
    </div>
  );
}

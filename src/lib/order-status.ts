// Statut d'une commande client, traduit depuis le libellé TIO.
//
// 🔴 POURQUOI UNE FONCTION DÉDIÉE. La route de synchro écrivait
// `statusMap[status] || "EN_COURS"` : une valeur absente ou inconnue **rétrogradait
// silencieusement** la commande en EN_COURS, y compris une commande validée ou soldée.
// Même classe de défaut que les montants écrasés par des zéros le 28/09/2026 — un appelant
// partiel détruisait un état connu.
//
// Ici on distingue « traduit » de « inconnu », pour que l'appelant puisse NE RIEN ÉCRIRE
// plutôt que d'écraser, et signaler la valeur qu'il n'a pas comprise.

/** Libellés TIO connus → statut GestLog. */
export const TIO_STATUS: Record<string, string> = {
  Confirmer: "VALIDEE",
  Confirmed: "VALIDEE",
  "En cours": "EN_COURS",
  Pending: "EN_COURS",
  Solder: "SOLDEE",
  Annuler: "ANNULEE",
  Cancelled: "ANNULEE",
};

/** Statut retenu à la création, quand la source ne dit rien. */
export const STATUT_DEFAUT = "EN_COURS";

export interface StatusMapping {
  /** Statut GestLog, ou null si le libellé n'est pas reconnu. */
  status: string | null;
  /** Le libellé a-t-il été reconnu ? Sinon : ne rien écrire, et le signaler. */
  known: boolean;
  /** Libellé d'origine, tel que reçu — pour le message d'avertissement. */
  raw: string;
}

/**
 * Traduit un libellé TIO.
 *
 * ⚠️ Insensible à la casse et aux espaces de bord : *TIO renvoie « en cours » comme
 * « En cours » selon les versions.* Une valeur vide n'est PAS une erreur — elle veut dire
 * « la source ne se prononce pas » — mais elle n'est pas reconnue pour autant.
 */
export function mapOrderStatus(raw: unknown): StatusMapping {
  const s = String(raw ?? "").trim();
  if (!s) return { status: null, known: false, raw: "" };
  const direct = TIO_STATUS[s];
  if (direct) return { status: direct, known: true, raw: s };
  const cle = Object.keys(TIO_STATUS).find((k) => k.toLowerCase() === s.toLowerCase());
  if (cle) return { status: TIO_STATUS[cle], known: true, raw: s };
  // Un statut GestLog renvoyé tel quel (réimport d'un export GestLog) reste valide.
  if (["EN_COURS", "VALIDEE", "SOLDEE", "ANNULEE"].includes(s.toUpperCase())) {
    return { status: s.toUpperCase(), known: true, raw: s };
  }
  return { status: null, known: false, raw: s };
}

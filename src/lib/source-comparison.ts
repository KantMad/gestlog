// Comparaison des commandes clients IMPORTÉES : TIO (prise de commande, archive) contre
// TEXAS (ERP, vérité).
//
// 🔴 POURQUOI CET ÉCRAN. Tous les autres écrans B2B ne lisent qu'UNE source par saison
// (`resolveOrderSource` : TEXAS dès qu'il en existe, sinon TIO). L'autre devient
// invisible — sans moyen de savoir ce qu'on ne voit plus. *Sur AH26, la seule saison à
// porter les deux : 334 commandes TIO / 88 750 pièces contre 282 commandes TEXAS /
// 69 925 pièces. 18 825 pièces d'écart, que rien n'affichait.*
//
// ⚠️ Les NUMÉROS DE COMMANDE ne se recoupent pas d'une source à l'autre (0 commun sur
// AH26) : chaque source a sa numérotation. Le rapprochement se fait par `tioOrderNumber`
// (274 communs sur 320 et 281), et les volumes se comparent par boutique et par catalogue.

export type OrderSourceName = "TIO" | "TEXAS";

/** Un agrégat déjà calculé côté base, pour une source et un regroupement. */
export interface SourceAgg {
  source: OrderSourceName;
  /** Identifiant du regroupement (boutique ou catalogue). */
  id: string;
  label: string;
  orders: number;
  lines: number;
  pieces: number;
  amount: number;
}

export interface SourceSide {
  orders: number;
  lines: number;
  pieces: number;
  amount: number;
}

export type Presence = "deux" | "tio" | "texas";

export interface ComparisonRow {
  id: string;
  label: string;
  tio: SourceSide;
  texas: SourceSide;
  /** TEXAS − TIO. Négatif = TIO en porte davantage. */
  ecartPieces: number;
  ecartAmount: number;
  presence: Presence;
  /**
   * Libellé de l'autre source au nom proche, quand la ligne n'existe que d'un côté.
   * *Cas réel : « BRANDS CORNER » (TIO) et « BJB SAS / BRANDS CORNER » (TEXAS) sont deux
   * fiches client distinctes pour la même boutique.*
   */
  ressemble?: string;
  /**
   * Le nom de la jumelle est RIGOUREUSEMENT le même : deux fiches client distinctes pour
   * une seule boutique, à peu près certain. *Sur AH26, une vingtaine de cas, presque tous
   * des « TERRITOIRE D'HOMME - … ».*
   */
  ressembleExact?: boolean;
}

const vide = (): SourceSide => ({ orders: 0, lines: 0, pieces: 0, amount: 0 });

/** Normalise un libellé pour le rapprochement : sans casse, accent ni ponctuation. */
export function normLabel(v: string): string {
  return String(v ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deux libellés désignent-ils vraisemblablement la même boutique ?
 *
 * On compare les MOTS de 3 lettres ou plus : si tous ceux de l'un se retrouvent dans
 * l'autre, c'est un candidat. *« CLASSIC STOCK TALANGE » ⊂ « CLASSIC STOCK TALANGE MCS »,
 * « BRANDS CORNER » ⊂ « BJB SAS BRANDS CORNER ».*
 *
 * ⚠️ LE SEUIL EST À 3, PAS À 4. À 4, « LE KORNER - Saint-Leu » et « LE KORNER -
 * Saint-Paul » étaient déclarés proches : « LEU », trois lettres, était jeté, et il ne
 * restait que « KORNER SAINT » des deux côtés. C'est le mot court qui distingue.
 *
 * ⚠️ IL FAUT AU MOINS DEUX MOTS du côté inclus (sauf égalité stricte), sinon un nom
 * générique d'un seul mot rapprocherait n'importe quoi — « MCS » ⊂ « MCS Romans ».
 *
 * ⚠️ Simple indice, jamais une fusion : deux boutiques d'une même enseigne portent des
 * noms voisins sans être la même. C'est l'humain qui tranche.
 */
export function nomsProches(a: string, b: string): boolean {
  if (!normLabel(a) || !normLabel(b)) return false;
  if (normLabel(a) === normLabel(b)) return true;
  const mots = (v: string) => normLabel(v).split(" ").filter((m) => m.length >= 3);
  const ma = mots(a);
  const mb = mots(b);
  const inclus = (x: string[], y: string[]) => x.length >= 2 && x.every((m) => y.includes(m));
  return inclus(ma, mb) || inclus(mb, ma);
}

/**
 * Croise les agrégats des deux sources.
 * Tri par écart de pièces en valeur absolue : les divergences d'abord, c'est ce qu'on
 * vient chercher.
 */
export function buildComparison(aggs: SourceAgg[]): ComparisonRow[] {
  const map = new Map<string, ComparisonRow>();

  for (const a of aggs) {
    let r = map.get(a.id);
    if (!r) {
      r = {
        id: a.id,
        label: a.label,
        tio: vide(),
        texas: vide(),
        ecartPieces: 0,
        ecartAmount: 0,
        presence: "deux",
      };
      map.set(a.id, r);
    }
    // Le libellé peut différer d'une source à l'autre : on garde le premier non vide.
    if (!r.label && a.label) r.label = a.label;
    const cote = a.source === "TIO" ? r.tio : r.texas;
    cote.orders += a.orders;
    cote.lines += a.lines;
    cote.pieces += a.pieces;
    cote.amount += a.amount;
  }

  const rows = [...map.values()];
  for (const r of rows) {
    r.ecartPieces = r.texas.pieces - r.tio.pieces;
    r.ecartAmount = r.texas.amount - r.tio.amount;
    const aTio = r.tio.pieces > 0 || r.tio.orders > 0;
    const aTexas = r.texas.pieces > 0 || r.texas.orders > 0;
    r.presence = aTio && aTexas ? "deux" : aTio ? "tio" : "texas";
  }

  // Indice de fiche en double : uniquement entre lignes d'un seul côté, et de côtés
  // opposés — sinon on rapprocherait deux boutiques réellement distinctes.
  //
  // ⚠️ Une jumelle n'est appariée QU'UNE FOIS. Sans cela, plusieurs fiches homonymes se
  // désigneraient toutes la même, et le compte des doublons serait faux.
  const seulesTio = rows.filter((r) => r.presence === "tio");
  const disponibles = rows.filter((r) => r.presence === "texas");
  const prises = new Set<string>();
  for (const t of seulesTio) {
    const libres = disponibles.filter((x) => !prises.has(x.id));
    // Le nom rigoureusement identique l'emporte sur une simple ressemblance.
    const jumelle =
      libres.find((x) => normLabel(x.label) === normLabel(t.label)) ??
      libres.find((x) => nomsProches(t.label, x.label));
    if (!jumelle) continue;
    prises.add(jumelle.id);
    const exact = normLabel(jumelle.label) === normLabel(t.label);
    t.ressemble = jumelle.label;
    jumelle.ressemble = t.label;
    if (exact) {
      t.ressembleExact = true;
      jumelle.ressembleExact = true;
    }
  }

  return rows.sort(
    (a, b) =>
      Math.abs(b.ecartPieces) - Math.abs(a.ecartPieces) ||
      a.label.localeCompare(b.label, "fr")
  );
}

/** Cumul des deux côtés, pour les compteurs d'en-tête. */
export function totauxComparaison(rows: ComparisonRow[]): { tio: SourceSide; texas: SourceSide } {
  const t = vide();
  const x = vide();
  for (const r of rows) {
    for (const [dst, src] of [[t, r.tio], [x, r.texas]] as const) {
      dst.orders += src.orders;
      dst.lines += src.lines;
      dst.pieces += src.pieces;
      dst.amount += src.amount;
    }
  }
  return { tio: t, texas: x };
}

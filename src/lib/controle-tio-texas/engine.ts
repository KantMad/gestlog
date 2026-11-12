// ─────────────────────────────────────────────────────────────────────────────
// Rapprochement TIO ↔ TEXAS : vérifier que ce qui a été saisi dans l'ERP Texas
// correspond EXACTEMENT à ce qui a été commandé dans TIO.
//
// Ce module est PUR (aucun accès base, aucun XLSX) → testable et utilisable des
// deux côtés. La lecture des fichiers et la résolution des grilles produit vivent
// dans `normalise.ts` (qui, lui, a besoin de la base).
//
// ⚠️ Le SEUL lien entre les deux sources est le **n° de commande TIO** :
// les n° de commande Texas et TIO sont totalement disjoints. Côté Texas il est
// porté par la colonne « Référence commande client » (PO-… catalogue, IS-… réassort).
// ─────────────────────────────────────────────────────────────────────────────

export type Cote = "TIO" | "TEXAS";

/** Une ligne de commande, normalisée quelle que soit la provenance du fichier. */
export interface LigneNormalisee {
  /** N° de commande TIO — la clé de rapprochement. */
  numeroTio: string;
  /** N° de commande propre à Texas (vide côté TIO). */
  numeroTexas?: string;
  codeClient: string;
  nomClient?: string;
  reference: string;
  codeCouleur: string;
  libelleCouleur?: string;
  /**
   * Quantités par taille, quand le fichier (ou la grille du produit) permet de les
   * décoder. Absent = tailles non décodables → seul le TOTAL de la ligne est comparable.
   */
  tailles?: Record<string, number>;
  /** Total pièces de la ligne — TOUJOURS renseigné (somme des Q.N). */
  pieces: number;
  /** Montant au niveau COMMANDE, répété sur chaque ligne (Texas) → on NE SOMME PAS. */
  montantCommande?: number;
  /** Montant propre à la LIGNE (export GestLog : prix × quantité) → on somme. */
  montantLigne?: number;
  /** Commande soldée côté Texas. */
  soldee?: boolean;
}

export type StatutCommande = "ok" | "manquante_texas" | "en_trop_texas" | "ecart";

export interface EcartCommande {
  numeroTio: string;
  numeroTexas: string | null;
  codeClientTio: string | null;
  codeClientTexas: string | null;
  nomClient: string | null;
  piecesTio: number;
  piecesTexas: number;
  /** null = le fichier de ce côté ne porte aucun montant → non comparable. */
  montantTio: number | null;
  montantTexas: number | null;
  lignesTio: number;
  lignesTexas: number;
  soldeeTexas: boolean;
  statut: StatutCommande;
  anomalies: string[];
}

export type StatutLigne =
  | "ok"
  | "manquante_texas"
  | "en_trop_texas"
  | "ecart_pieces"
  | "ecart_tailles";

export interface EcartTaille {
  taille: string;
  tio: number;
  texas: number;
}

export interface EcartLigne {
  numeroTio: string;
  codeClient: string;
  reference: string;
  codeCouleur: string;
  libelleCouleur: string;
  piecesTio: number;
  piecesTexas: number;
  statut: StatutLigne;
  /** Détail taille par taille, uniquement quand les deux côtés décodent les tailles. */
  tailles: EcartTaille[];
  taillesComparables: boolean;
  anomalies: string[];
}

export interface SyntheseControle {
  commandesTio: number;
  commandesTexas: number;
  commandesCommunes: number;
  commandesConformes: number;
  commandesAvecEcart: number;
  commandesManquantes: number;
  commandesEnTrop: number;
  tauxConformite: number; // % de commandes TIO retrouvées et conformes
  lignesCommunes: number;
  lignesConformes: number;
  lignesAvecEcart: number;
  lignesManquantes: number;
  lignesEnTrop: number;
  piecesTio: number;
  piecesTexas: number;
  montantTio: number | null;
  montantTexas: number | null;
  montantComparable: boolean;
  /** Lignes communes dont les tailles ont pu être comparées une à une. */
  taillesComparees: number;
  taillesNonComparables: number;
}

export interface RapportControle {
  synthese: SyntheseControle;
  commandes: EcartCommande[];
  lignes: EcartLigne[];
}

export interface OptionsControle {
  /** Écart de montant toléré, en euros (défaut 0,01 € = au centime près). */
  toleranceMontant?: number;
  /** Exclure du contrôle les commandes marquées soldées côté Texas. */
  ignorerSoldees?: boolean;
}

// ─────────────────────────────────────────────────────── normalisation des clés

/**
 * Clé de rapprochement d'un n° de commande : majuscules, sans rien d'autre que
 * lettres et chiffres. « IS-26 0014 », « is26/0014 » et « IS260014 » se rejoignent —
 * les séparateurs varient entre un export TIO et une saisie Texas.
 */
export function cleCommande(numero: string): string {
  return String(numero ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Clé d'une référence produit : majuscules, espaces normalisés. */
export function cleReference(reference: string): string {
  return String(reference ?? "").toUpperCase().replace(/\s+/g, " ").trim();
}

/**
 * Clé d'un code couleur. Un code numérique est comparé SANS ses zéros de tête
 * (« 6 », « 06 » et « 006 » désignent le même coloris selon l'export).
 */
export function cleCouleur(code: string): string {
  const s = String(code ?? "").toUpperCase().replace(/\s+/g, "").trim();
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s;
}

const cleLigne = (l: LigneNormalisee) => `${cleReference(l.reference)}\u0000${cleCouleur(l.codeCouleur)}`;

// ─────────────────────────────────────────────────────── helpers

const euro = (n: number) =>
  `${n < 0 ? "−" : ""}${Math.abs(n).toFixed(2).replace(".", ",")} €`;

const piecesLabel = (n: number) => `${Math.abs(n)} pièce${Math.abs(n) > 1 ? "s" : ""}`;

/** Montant d'une commande : niveau commande s'il existe, sinon somme des lignes. */
function montantCommande(lignes: LigneNormalisee[]): number | null {
  const auNiveauCommande = lignes.find((l) => l.montantCommande != null);
  if (auNiveauCommande) return auNiveauCommande.montantCommande as number;
  const avecLigne = lignes.filter((l) => l.montantLigne != null);
  if (avecLigne.length === 0) return null;
  return arrondi(avecLigne.reduce((s, l) => s + (l.montantLigne as number), 0));
}

const arrondi = (n: number) => Math.round(n * 100) / 100;

/** Agrège les lignes d'une commande par (référence, coloris) — un produit peut être répété. */
function agregeParProduit(lignes: LigneNormalisee[]) {
  const map = new Map<
    string,
    {
      reference: string;
      codeCouleur: string;
      libelleCouleur: string;
      pieces: number;
      tailles: Record<string, number> | null;
    }
  >();
  for (const l of lignes) {
    const k = cleLigne(l);
    let e = map.get(k);
    if (!e) {
      e = {
        reference: l.reference,
        codeCouleur: l.codeCouleur,
        libelleCouleur: l.libelleCouleur || "",
        pieces: 0,
        // null dès qu'UNE des lignes du produit n'est pas décodable : on ne
        // prétend pas connaître les tailles d'un total partiellement décodé.
        tailles: l.tailles ? {} : null,
      };
      map.set(k, e);
    }
    e.pieces += l.pieces;
    if (!l.tailles) e.tailles = null;
    else if (e.tailles) {
      for (const [t, q] of Object.entries(l.tailles)) e.tailles[t] = (e.tailles[t] || 0) + q;
    }
    if (!e.libelleCouleur && l.libelleCouleur) e.libelleCouleur = l.libelleCouleur;
  }
  return map;
}

// ─────────────────────────────────────────────────────── comparaison

/**
 * Rapproche les lignes TIO et les lignes TEXAS.
 *
 * Les écarts de LIGNE ne sont calculés que pour les commandes présentes **des deux
 * côtés** : pour une commande absente d'un côté, c'est la commande entière qui est
 * signalée, détailler ses lignes n'apporterait rien.
 */
export function comparer(
  tio: LigneNormalisee[],
  texas: LigneNormalisee[],
  options: OptionsControle = {}
): RapportControle {
  const tolerance = options.toleranceMontant ?? 0.01;

  const parCommande = (lignes: LigneNormalisee[]) => {
    const m = new Map<string, LigneNormalisee[]>();
    for (const l of lignes) {
      const k = cleCommande(l.numeroTio);
      if (!k) continue; // une ligne sans n° de commande TIO n'est pas rapprochable
      const arr = m.get(k);
      if (arr) arr.push(l);
      else m.set(k, [l]);
    }
    return m;
  };

  const cmdTio = parCommande(tio);
  let cmdTexas = parCommande(texas);

  if (options.ignorerSoldees) {
    cmdTexas = new Map(
      [...cmdTexas.entries()].filter(([, ls]) => !ls.some((l) => l.soldee))
    );
  }

  const clesSansNumero = texas.filter((l) => !cleCommande(l.numeroTio));

  const commandes: EcartCommande[] = [];
  const lignes: EcartLigne[] = [];
  const synthese: SyntheseControle = {
    commandesTio: cmdTio.size,
    commandesTexas: cmdTexas.size,
    commandesCommunes: 0,
    commandesConformes: 0,
    commandesAvecEcart: 0,
    commandesManquantes: 0,
    commandesEnTrop: 0,
    tauxConformite: 0,
    lignesCommunes: 0,
    lignesConformes: 0,
    lignesAvecEcart: 0,
    lignesManquantes: 0,
    lignesEnTrop: 0,
    piecesTio: 0,
    piecesTexas: 0,
    montantTio: null,
    montantTexas: null,
    montantComparable: false,
    taillesComparees: 0,
    taillesNonComparables: 0,
  };

  const toutes = new Set([...cmdTio.keys(), ...cmdTexas.keys()]);

  for (const cle of toutes) {
    const lt = cmdTio.get(cle) || [];
    const lx = cmdTexas.get(cle) || [];
    const piecesTio = lt.reduce((s, l) => s + l.pieces, 0);
    const piecesTexas = lx.reduce((s, l) => s + l.pieces, 0);
    const mTio = montantCommande(lt);
    const mTexas = montantCommande(lx);

    synthese.piecesTio += piecesTio;
    synthese.piecesTexas += piecesTexas;
    if (mTio != null) synthese.montantTio = arrondi((synthese.montantTio ?? 0) + mTio);
    if (mTexas != null) synthese.montantTexas = arrondi((synthese.montantTexas ?? 0) + mTexas);

    const prodTio = agregeParProduit(lt);
    const prodTexas = agregeParProduit(lx);

    const anomalies: string[] = [];
    let statut: StatutCommande;

    if (lt.length === 0) {
      statut = "en_trop_texas";
      synthese.commandesEnTrop++;
      anomalies.push("commande saisie dans Texas mais absente de TIO");
    } else if (lx.length === 0) {
      statut = "manquante_texas";
      synthese.commandesManquantes++;
      anomalies.push("commande TIO jamais saisie dans Texas");
    } else {
      synthese.commandesCommunes++;

      // ── Niveau produit (uniquement sur les commandes communes).
      const clesProduits = new Set([...prodTio.keys(), ...prodTexas.keys()]);
      let produitsAbsents = 0;
      let produitsEnTrop = 0;
      let produitsEcart = 0;

      for (const kp of clesProduits) {
        const pt = prodTio.get(kp);
        const px = prodTexas.get(kp);
        const ref = (pt || px)!.reference;
        const couleur = (pt || px)!.codeCouleur;
        const libelle = pt?.libelleCouleur || px?.libelleCouleur || "";
        const qTio = pt?.pieces ?? 0;
        const qTexas = px?.pieces ?? 0;
        const anoL: string[] = [];
        let statutL: StatutLigne;
        const taillesComparables = !!(pt?.tailles && px?.tailles);
        const detail: EcartTaille[] = [];

        if (taillesComparables) {
          const tt = pt!.tailles!;
          const tx = px!.tailles!;
          for (const taille of new Set([...Object.keys(tt), ...Object.keys(tx)])) {
            const a = tt[taille] || 0;
            const b = tx[taille] || 0;
            if (a !== b) detail.push({ taille, tio: a, texas: b });
          }
        }

        if (!pt) {
          statutL = "en_trop_texas";
          produitsEnTrop++;
          synthese.lignesEnTrop++;
          anoL.push(`produit saisi dans Texas mais absent de la commande TIO (${piecesLabel(qTexas)})`);
        } else if (!px) {
          statutL = "manquante_texas";
          produitsAbsents++;
          synthese.lignesManquantes++;
          anoL.push(`produit commandé dans TIO mais absent de Texas (${piecesLabel(qTio)})`);
        } else {
          synthese.lignesCommunes++;
          if (taillesComparables) synthese.taillesComparees++;
          else synthese.taillesNonComparables++;

          if (qTio !== qTexas) {
            statutL = "ecart_pieces";
            anoL.push(
              `${piecesLabel(qTexas - qTio)} ${qTexas > qTio ? "en trop" : "en moins"} dans Texas (TIO ${qTio} / Texas ${qTexas})`
            );
          } else if (detail.length > 0) {
            // Total identique mais la répartition par taille diffère : erreur de
            // saisie la plus traître — elle ne se voit sur aucun total.
            statutL = "ecart_tailles";
            anoL.push(
              `même total (${qTio}) mais répartition différente : ${detail
                .map((d) => `${d.taille} ${d.tio}→${d.texas}`)
                .join(", ")}`
            );
          } else {
            statutL = "ok";
            synthese.lignesConformes++;
          }
          if (statutL !== "ok") {
            produitsEcart++;
            synthese.lignesAvecEcart++;
            if (statutL === "ecart_pieces" && detail.length > 0) {
              anoL.push(
                `tailles : ${detail.map((d) => `${d.taille} ${d.tio}→${d.texas}`).join(", ")}`
              );
            }
          }
        }

        lignes.push({
          numeroTio: (lt[0] || lx[0]).numeroTio,
          codeClient: lt[0]?.codeClient || lx[0]?.codeClient || "",
          reference: ref,
          codeCouleur: couleur,
          libelleCouleur: libelle,
          piecesTio: qTio,
          piecesTexas: qTexas,
          statut: statutL,
          tailles: detail,
          taillesComparables,
          anomalies: anoL,
        });
      }

      // ── Niveau commande.
      if (piecesTio !== piecesTexas) {
        anomalies.push(
          `${piecesLabel(piecesTexas - piecesTio)} ${piecesTexas > piecesTio ? "en trop" : "en moins"} dans Texas (TIO ${piecesTio} / Texas ${piecesTexas})`
        );
      }
      if (produitsAbsents > 0) anomalies.push(`${produitsAbsents} produit(s) absent(s) de Texas`);
      if (produitsEnTrop > 0) anomalies.push(`${produitsEnTrop} produit(s) en trop dans Texas`);
      const ecartsQte = produitsEcart;
      if (ecartsQte > 0) anomalies.push(`${ecartsQte} produit(s) avec un écart de quantité`);

      if (mTio != null && mTexas != null) {
        synthese.montantComparable = true;
        const d = arrondi(mTexas - mTio);
        if (Math.abs(d) > tolerance) {
          anomalies.push(`montant ${euro(d)} d'écart (TIO ${euro(mTio)} / Texas ${euro(mTexas)})`);
        }
      }

      const clientTio = lt[0]?.codeClient || "";
      const clientTexas = lx[0]?.codeClient || "";
      if (clientTio && clientTexas && cleCommande(clientTio) !== cleCommande(clientTexas)) {
        anomalies.push(`code client différent (TIO ${clientTio} / Texas ${clientTexas})`);
      }

      if (anomalies.length === 0) {
        statut = "ok";
        synthese.commandesConformes++;
      } else {
        statut = "ecart";
        synthese.commandesAvecEcart++;
      }
    }

    commandes.push({
      numeroTio: (lt[0] || lx[0]).numeroTio,
      numeroTexas: lx[0]?.numeroTexas || null,
      codeClientTio: lt[0]?.codeClient || null,
      codeClientTexas: lx[0]?.codeClient || null,
      nomClient: lt[0]?.nomClient || lx[0]?.nomClient || null,
      piecesTio,
      piecesTexas,
      montantTio: mTio,
      montantTexas: mTexas,
      lignesTio: prodTio.size,
      lignesTexas: prodTexas.size,
      soldeeTexas: lx.some((l) => l.soldee),
      statut,
      anomalies,
    });
  }

  if (clesSansNumero.length > 0) {
    // Une ligne Texas sans « Référence commande client » ne peut PAS être rapprochée :
    // on la signale explicitement plutôt que de la compter comme conforme.
    commandes.push({
      numeroTio: "(sans référence TIO)",
      numeroTexas: clesSansNumero[0].numeroTexas || null,
      codeClientTio: null,
      codeClientTexas: clesSansNumero[0].codeClient || null,
      nomClient: null,
      piecesTio: 0,
      piecesTexas: clesSansNumero.reduce((s, l) => s + l.pieces, 0),
      montantTio: null,
      montantTexas: null,
      lignesTio: 0,
      lignesTexas: clesSansNumero.length,
      soldeeTexas: false,
      statut: "en_trop_texas",
      anomalies: [
        `${clesSansNumero.length} ligne(s) Texas sans « Référence commande client » — non rapprochables`,
      ],
    });
    synthese.commandesEnTrop++;
  }

  synthese.tauxConformite =
    synthese.commandesTio > 0
      ? Math.round((synthese.commandesConformes / synthese.commandesTio) * 100)
      : 0;

  const rang: Record<StatutCommande, number> = {
    manquante_texas: 0,
    ecart: 1,
    en_trop_texas: 2,
    ok: 3,
  };
  commandes.sort(
    (a, b) => rang[a.statut] - rang[b.statut] || a.numeroTio.localeCompare(b.numeroTio, "fr")
  );
  const rangL: Record<StatutLigne, number> = {
    manquante_texas: 0,
    ecart_pieces: 1,
    ecart_tailles: 2,
    en_trop_texas: 3,
    ok: 4,
  };
  lignes.sort(
    (a, b) =>
      rangL[a.statut] - rangL[b.statut] ||
      a.numeroTio.localeCompare(b.numeroTio, "fr") ||
      a.reference.localeCompare(b.reference, "fr")
  );

  return { synthese, commandes, lignes };
}

// ─────────────────────────────────────────────────────── rapport Excel (AoA pur)

export const LIBELLE_STATUT_COMMANDE: Record<StatutCommande, string> = {
  ok: "Conforme",
  ecart: "Écart",
  manquante_texas: "Absente de Texas",
  en_trop_texas: "En trop dans Texas",
};

export const LIBELLE_STATUT_LIGNE: Record<StatutLigne, string> = {
  ok: "Conforme",
  ecart_pieces: "Écart de quantité",
  ecart_tailles: "Répartition des tailles",
  manquante_texas: "Absent de Texas",
  en_trop_texas: "En trop dans Texas",
};

export interface FeuilleRapport {
  nom: string;
  lignes: (string | number | null)[][];
}

/** Les feuilles du rapport d'écarts, prêtes pour `XLSX.utils.aoa_to_sheet`. */
export function rapportVersFeuilles(
  rapport: RapportControle,
  contexte: { fichierTio: string; fichierTexas: string; genereLe: string }
): FeuilleRapport[] {
  const s = rapport.synthese;
  const synthese: (string | number | null)[][] = [
    ["Contrôle TIO ↔ Texas"],
    ["Généré le", contexte.genereLe],
    ["Fichier TIO", contexte.fichierTio],
    ["Fichier Texas", contexte.fichierTexas],
    [],
    ["Commandes", "TIO", "Texas"],
    ["Nombre", s.commandesTio, s.commandesTexas],
    ["Pièces", s.piecesTio, s.piecesTexas],
    ["Montant (€)", s.montantTio, s.montantTexas],
    [],
    ["Rapprochement"],
    ["Commandes conformes", s.commandesConformes],
    ["Commandes avec écart", s.commandesAvecEcart],
    ["Commandes TIO absentes de Texas", s.commandesManquantes],
    ["Commandes Texas absentes de TIO", s.commandesEnTrop],
    ["Taux de conformité (%)", s.tauxConformite],
    [],
    ["Produits (commandes communes)"],
    ["Produits conformes", s.lignesConformes],
    ["Produits avec écart de quantité", s.lignesAvecEcart],
    ["Produits absents de Texas", s.lignesManquantes],
    ["Produits en trop dans Texas", s.lignesEnTrop],
    ["Produits comparés taille par taille", s.taillesComparees],
    ["Produits comparés au total seulement", s.taillesNonComparables],
  ];
  if (!s.montantComparable) {
    synthese.push([], ["⚠️ Montants non comparables : un des deux fichiers ne porte pas de montant."]);
  }

  const commandes: (string | number | null)[][] = [
    [
      "Statut",
      "N° commande TIO",
      "N° commande Texas",
      "Code client TIO",
      "Code client Texas",
      "Enseigne",
      "Pièces TIO",
      "Pièces Texas",
      "Écart pièces",
      "Montant TIO",
      "Montant Texas",
      "Écart montant",
      "Produits TIO",
      "Produits Texas",
      "Soldée Texas",
      "Anomalies",
    ],
    ...rapport.commandes.map((c) => [
      LIBELLE_STATUT_COMMANDE[c.statut],
      c.numeroTio,
      c.numeroTexas,
      c.codeClientTio,
      c.codeClientTexas,
      c.nomClient,
      c.piecesTio,
      c.piecesTexas,
      c.piecesTexas - c.piecesTio,
      c.montantTio,
      c.montantTexas,
      c.montantTio != null && c.montantTexas != null ? arrondi(c.montantTexas - c.montantTio) : null,
      c.lignesTio,
      c.lignesTexas,
      c.soldeeTexas ? "Oui" : "",
      c.anomalies.join(" ; "),
    ]),
  ];

  const produits: (string | number | null)[][] = [
    [
      "Statut",
      "N° commande TIO",
      "Code client",
      "Référence",
      "Code couleur",
      "Libellé couleur",
      "Pièces TIO",
      "Pièces Texas",
      "Écart",
      "Tailles comparées",
      "Détail des écarts de taille",
    ],
    ...rapport.lignes.map((l) => [
      LIBELLE_STATUT_LIGNE[l.statut],
      l.numeroTio,
      l.codeClient,
      l.reference,
      l.codeCouleur,
      l.libelleCouleur,
      l.piecesTio,
      l.piecesTexas,
      l.piecesTexas - l.piecesTio,
      l.taillesComparables ? "Oui" : "Non",
      l.tailles.map((t) => `${t.taille} : TIO ${t.tio} / Texas ${t.texas}`).join(" ; "),
    ]),
  ];

  const tailles: (string | number | null)[][] = [
    [
      "N° commande TIO",
      "Code client",
      "Référence",
      "Code couleur",
      "Taille",
      "TIO",
      "Texas",
      "Écart",
    ],
    ...rapport.lignes.flatMap((l) =>
      l.tailles.map((t) => [
        l.numeroTio,
        l.codeClient,
        l.reference,
        l.codeCouleur,
        t.taille,
        t.tio,
        t.texas,
        t.texas - t.tio,
      ])
    ),
  ];

  return [
    { nom: "Synthèse", lignes: synthese },
    { nom: "Commandes", lignes: commandes },
    { nom: "Produits", lignes: produits },
    { nom: "Tailles", lignes: tailles },
  ];
}

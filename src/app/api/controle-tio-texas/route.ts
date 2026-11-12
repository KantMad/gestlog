import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { analyserFichier, LIBELLE_FORMAT } from "@/lib/controle-tio-texas/normalise";
import { comparer, type Cote } from "@/lib/controle-tio-texas/engine";

// POST — Rapproche DEUX fichiers déposés : la commande telle qu'elle a été prise dans
// TIO, et la même commande telle qu'elle a été saisie dans l'ERP Texas.
//
// ⚠️ VÉRIFICATION PURE : cette route n'écrit RIEN en base (pas d'ImportLog, pas de
// commande, pas de produit re-clé). Les fichiers ne sont pas conservés.
//
// Le rapprochement se fait sur le **n° de commande TIO** — seul lien entre les deux
// sources (côté Texas : colonne « Référence commande client »).

/** Au-delà, le détail ligne à ligne est tronqué (la synthèse, elle, reste complète). */
const MAX_LIGNES_RENVOYEES = 20000;
/** Garde-fou mémoire : le VPS héberge aussi l'API caisse. */
const MAX_OCTETS = 25 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const a = form.get("fichierA") as File | null;
    const b = form.get("fichierB") as File | null;
    if (!a || !b) {
      return NextResponse.json(
        { error: "Deux fichiers sont requis : l'export TIO et l'export Texas." },
        { status: 400 }
      );
    }
    for (const f of [a, b]) {
      if (f.size > MAX_OCTETS) {
        return NextResponse.json(
          { error: `« ${f.name} » dépasse 25 Mo — exporte une saison à la fois.` },
          { status: 400 }
        );
      }
    }

    const coteA = (form.get("coteA") as string | null) as Cote | null;
    const coteB = (form.get("coteB") as string | null) as Cote | null;
    const tolerance = parseFloat((form.get("toleranceMontant") as string) || "0.01");
    const ignorerSoldees = form.get("ignorerSoldees") === "1";
    const inclureConformes = form.get("inclureConformes") === "1";

    const [fa, fb] = await Promise.all([
      analyserFichier(await a.arrayBuffer(), a.name, coteA ?? undefined),
      analyserFichier(await b.arrayBuffer(), b.name, coteB ?? undefined),
    ]);

    if (fa.cote === fb.cote) {
      return NextResponse.json(
        {
          error:
            `Les deux fichiers ont été reconnus du même côté (${fa.cote}) : « ${fa.nom} » = ${LIBELLE_FORMAT[fa.format]}, ` +
            `« ${fb.nom} » = ${LIBELLE_FORMAT[fb.format]}. Dépose un export TIO et un export Texas, ou indique explicitement le côté de chaque fichier.`,
        },
        { status: 400 }
      );
    }

    const tio = fa.cote === "TIO" ? fa : fb;
    const texas = fa.cote === "TEXAS" ? fa : fb;

    const rapport = comparer(tio.lignes, texas.lignes, {
      toleranceMontant: isNaN(tolerance) ? 0.01 : tolerance,
      ignorerSoldees,
    });

    const lignesRetenues = inclureConformes
      ? rapport.lignes
      : rapport.lignes.filter((l) => l.statut !== "ok");
    const tronque = lignesRetenues.length > MAX_LIGNES_RENVOYEES;

    return NextResponse.json({
      data: {
        synthese: rapport.synthese,
        commandes: rapport.commandes,
        lignes: tronque ? lignesRetenues.slice(0, MAX_LIGNES_RENVOYEES) : lignesRetenues,
        lignesTronquees: tronque,
        lignesConformesIncluses: inclureConformes,
        fichiers: {
          tio: {
            nom: tio.nom,
            format: tio.format,
            libelleFormat: LIBELLE_FORMAT[tio.format],
            lignesLues: tio.lignes.length,
            taillesNonDecodees: tio.taillesNonDecodees,
            avertissements: tio.avertissements,
          },
          texas: {
            nom: texas.nom,
            format: texas.format,
            libelleFormat: LIBELLE_FORMAT[texas.format],
            lignesLues: texas.lignes.length,
            taillesNonDecodees: texas.taillesNonDecodees,
            avertissements: texas.avertissements,
          },
        },
      },
    });
  } catch (e) {
    // Un format non reconnu est une erreur d'usage, pas un plantage : on rend le message.
    if (e instanceof Error && /format non reconnu|aucune ligne de commande/.test(e.message)) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return handleApiError(e, "api/controle-tio-texas");
  }
}

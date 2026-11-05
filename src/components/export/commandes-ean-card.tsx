"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Barcode, Download, FileSpreadsheet, Loader2, TriangleAlert, X } from "lucide-react";
import { cn, formatNumber, formatEuro } from "@/lib/utils";
import { fileStamp } from "@/lib/file-stamp";
import {
  parseCommandesEanCsv,
  buildCommandesEanExport,
  buildReferentiel,
  cleTaille,
  COLONNES,
  COLONNE_QUANTITE,
  COLONNE_PRIX_WHOLESALE,
  COLONNE_PRIX_CONSEILLE,
  type LigneCommande,
  type InfosReferentiel,
} from "@/lib/export-commandes-ean";

// Commandes clients → 14 colonnes : EAN, produit, coloris, taille, quantité, catégories,
// prix, commande, client. Le fichier déposé reste dans le navigateur ; seules les
// références, les numéros de commande et les triplets taille sans EAN partent au serveur.

export function CommandesEanCard() {
  const [file, setFile] = useState<File | null>(null);
  const [lignes, setLignes] = useState<LigneCommande[] | null>(null);
  const [referentiel, setReferentiel] = useState<InfosReferentiel>({});
  const [conflits, setConflits] = useState<{ orderNumber: string; codes: string[] }[]>([]);
  const [source, setSource] = useState<"commande" | "catalogue">("commande");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFile(null);
    setLignes(null);
    setReferentiel({});
    setConflits([]);
  };

  const choisir = useCallback(async (f: File) => {
    setBusy(true);
    try {
      const lu = parseCommandesEanCsv(await f.text());
      if (lu.manquantes.length > 0) {
        toast.error(`Colonne(s) manquante(s) : ${lu.manquantes.join(", ")}`, {
          description:
            "Attendu : l'export TIO « commandes EAN », une ligne par taille. L'export « à la couleur » met les tailles en colonnes T0…T11 et ne porte aucun EAN — il ne peut pas servir ici.",
          duration: 10000,
        });
        reset();
        return;
      }
      if (lu.lignes.length === 0) {
        toast.error("Aucune ligne exploitable", {
          description:
            lu.lues > 0
              ? `${lu.lues} ligne(s) lue(s), toutes sans référence ou à quantité nulle.`
              : "Fichier vide ou illisible.",
        });
        reset();
        return;
      }

      const references = [...new Set(lu.lignes.map((l) => l.reference))];
      const orderNumbers = [...new Set(lu.lignes.map((l) => l.orderNumber).filter(Boolean))];
      // On ne demande les EAN du référentiel que pour les lignes qui n'en ont pas : sur un
      // export EAN complet, c'est zéro clé envoyée.
      const vues = new Set<string>();
      const eanKeys: { reference: string; color: string; size: string }[] = [];
      for (const l of lu.lignes) {
        if (l.ean) continue;
        const k = cleTaille(l.reference, l.colorCode, l.size);
        if (vues.has(k)) continue;
        vues.add(k);
        eanKeys.push({ reference: l.reference, color: l.colorCode, size: l.size });
      }

      const res = await fetch("/api/export/commandes-ean-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ references, orderNumbers, eanKeys }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Impossible de lire le référentiel");
        reset();
        return;
      }
      setFile(f);
      setLignes(lu.lignes);
      setReferentiel(buildReferentiel(json.data));
      setConflits(json.data.conflitsClient || []);
      toast.success(
        `${formatNumber(lu.lignes.length)} ligne(s) · ${references.length} référence(s) · ${orderNumbers.length} commande(s)`,
        {
          description:
            lu.ecartees > 0
              ? `${lu.ecartees} ligne(s) écartée(s) : sans référence, ou à quantité nulle.`
              : undefined,
        }
      );
    } catch (e) {
      toast.error("Impossible de lire le fichier", { description: String(e) });
      reset();
    } finally {
      setBusy(false);
    }
  }, []);

  const apercu = useMemo(
    () => (lignes ? buildCommandesEanExport(lignes, { ...referentiel, wholesaleSource: source }) : null),
    [lignes, referentiel, source]
  );

  const exporter = () => {
    if (!apercu || !file) return;
    const ws = XLSX.utils.aoa_to_sheet([apercu.header, ...apercu.rows]);
    ws["!cols"] = [
      { wch: 15 }, // EAN
      { wch: 14 }, // Référence
      { wch: 32 }, // Nom produit
      { wch: 18 }, // Libellé couleur
      { wch: 11 }, // Code couleur
      { wch: 8 }, // Taille
      { wch: 11 }, // Quantité
      { wch: 20 }, // Catégorie
      { wch: 20 }, // Sous-catégorie
      { wch: 14 }, // Prix wholesale
      { wch: 16 }, // Prix conseillé
      { wch: 20 }, // Numéro de commande
      { wch: 13 }, // Code client
      { wch: 26 }, // Enseigne
    ];
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: apercu.rows.length, c: apercu.header.length - 1 },
      }),
    };
    // Formats : euros sur les deux prix, entier sur la quantité. L'EAN n'est PAS touché —
    // il reste une chaîne, sinon Excel l'afficherait « 3,66525E+12 ».
    for (let r = 1; r <= apercu.rows.length; r++) {
      for (const c of [COLONNE_PRIX_WHOLESALE, COLONNE_PRIX_CONSEILLE]) {
        const adr = XLSX.utils.encode_cell({ r, c });
        if (ws[adr] && typeof ws[adr].v === "number") ws[adr].z = '#,##0.00\\ "€"';
      }
      const adrQ = XLSX.utils.encode_cell({ r, c: COLONNE_QUANTITE });
      if (ws[adrQ]) ws[adrQ].z = "#,##0";
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Commandes");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        { Critère: "Fichier source", Valeur: file.name },
        { Critère: "Lignes", Valeur: apercu.rows.length },
        { Critère: "Pièces commandées", Valeur: apercu.pieces },
        { Critère: "Références distinctes", Valeur: apercu.references.length },
        { Critère: "Commandes distinctes", Valeur: apercu.commandes.length },
        {
          Critère: "Prix wholesale",
          Valeur:
            source === "commande"
              ? "« Prix à la variation » du fichier — prix facturé sur la commande, remise déjà appliquée"
              : "Product.costPrice — tarif de gros du catalogue, AVANT remise",
        },
        { Critère: "Montant wholesale total", Valeur: apercu.totalWholesale },
        { Critère: "Prix de vente conseillé", Valeur: "Référentiel GestLog (TIO min_retail_price)" },
        { Critère: "Lignes sans prix wholesale", Valeur: apercu.sansPrixWholesale },
        { Critère: "Lignes sans prix conseillé", Valeur: apercu.sansPrixConseille },
        { Critère: "EAN complétés depuis le référentiel", Valeur: apercu.eansCompletes },
        { Critère: "Lignes sans EAN", Valeur: apercu.sansEan },
        { Critère: "Commandes sans code client", Valeur: apercu.commandesSansCodeClient.length },
        { Critère: "Code client", Valeur: "Client.code, retrouvé par le numéro de commande" },
        {
          Critère: "Colonnes personnelles",
          Valeur:
            "Exclues : nom, prénom, genre, e-mail du client et du commercial, adresses de facturation",
        },
      ]),
      "Critères"
    );
    XLSX.writeFile(wb, `commandes-clients-ean_${fileStamp()}.xlsx`, { compression: true });
    toast.success(
      `${formatNumber(apercu.rows.length)} ligne(s) · ${formatNumber(apercu.pieces)} pièces · ${formatEuro(apercu.totalWholesale)}`
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50">
            <Barcode className="h-5 w-5 text-teal-600" />
          </div>
          <div>
            <CardTitle className="text-base">Commandes clients + infos produits et EAN</CardTitle>
            <p className="text-sm text-muted-foreground">
              Dépose l&apos;export TIO « commandes EAN » : tu récupères un classeur de{" "}
              <strong>{COLONNES.length} colonnes</strong> — code-barres, produit, coloris,
              taille, quantité, catégories, prix wholesale et conseillé, commande, code et
              enseigne du client.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!apercu ? (
          <label
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors",
              busy ? "opacity-60" : "hover:bg-muted/40"
            )}
          >
            <FileSpreadsheet className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm font-medium">{file ? file.name : "Choisir un fichier .csv"}</span>
            <span className="text-xs text-muted-foreground">
              {busy
                ? "Lecture et interrogation du référentiel…"
                : "Export TIO « commandes EAN » — une ligne par taille"}
            </span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) choisir(f);
              }}
            />
          </label>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Chiffre valeur={apercu.rows.length} legende="lignes" />
              <Chiffre valeur={apercu.pieces} legende="pièces commandées" />
              <Chiffre valeur={apercu.references.length} legende="références" />
              <Chiffre valeur={apercu.commandes.length} legende="commandes" />
            </div>

            {/* Le prix wholesale n'a pas une seule définition : le tarif du catalogue et le
                prix réellement facturé diffèrent de la remise. Le choix est explicite. */}
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Prix wholesale</p>
              <div className="inline-flex rounded-md border p-0.5">
                {(
                  [
                    { v: "commande", label: "Prix facturé sur la commande" },
                    { v: "catalogue", label: "Tarif de gros du catalogue" },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setSource(o.v)}
                    className={cn(
                      "rounded px-2.5 py-1 text-xs transition-colors",
                      source === o.v
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent"
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {source === "commande" ? (
                  <>
                    « Prix à la variation » du fichier. <strong>La remise y est déjà
                    appliquée</strong> — vérifié : 79,80 € facturés pour un tarif catalogue de
                    133 € et une réduction de 40 %. Ne la déduis pas une seconde fois.
                  </>
                ) : (
                  <>
                    <strong>Product.costPrice</strong>, le tarif de gros du catalogue TIO,{" "}
                    <strong>avant</strong> la remise de la commande. Plus élevé que le prix
                    facturé.
                  </>
                )}
              </p>
            </div>

            <div className="rounded-lg border bg-emerald-50 p-3">
              <div className="text-2xl font-bold tabular-nums text-emerald-900">
                {formatEuro(apercu.totalWholesale)}
              </div>
              <p className="text-xs text-emerald-800">
                montant wholesale total — prix × quantité sur {formatNumber(apercu.rows.length)}{" "}
                lignes
              </p>
            </div>

            <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              Les colonnes <strong>nominatives</strong> du fichier TIO (nom, prénom, genre et
              e-mail du client comme du responsable commercial, adresses de facturation){" "}
              <strong>ne sont pas reprises</strong> : les {COLONNES.length} colonnes de sortie
              sont une liste fixe. Le fichier déposé n&apos;est pas envoyé au serveur — seules
              les références et les numéros de commande le sont, pour aller chercher le prix
              conseillé et le code client.
            </div>

            {apercu.sansEan > 0 && (
              <Alerte>
                <strong>{formatNumber(apercu.sansEan)} ligne(s) sans EAN</strong> : ni le fichier
                ni le référentiel n&apos;en ont pour cette taille. La cellule reste{" "}
                <strong>vide</strong> et la ligne est conservée — un code-barres inventé serait
                scanné en caisse sur le mauvais article.
              </Alerte>
            )}

            {apercu.eansCompletes > 0 && (
              <div className="rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900">
                <strong>{formatNumber(apercu.eansCompletes)} EAN complété(s)</strong> depuis le
                référentiel GestLog : le fichier ne les portait pas.
              </div>
            )}

            {apercu.referencesSansPrixConseille.length > 0 && (
              <Alerte>
                <strong>
                  {apercu.referencesSansPrixConseille.length} référence(s) sans prix de vente
                  conseillé
                </strong>{" "}
                : {apercu.referencesSansPrixConseille.slice(0, 8).join(", ")}
                {apercu.referencesSansPrixConseille.length > 8 && "…"}. TIO n&apos;en publie pas
                pour elles ; la cellule reste vide. Elles arriveront à la synchro produits
                suivante (5 h 05) si le prix y est renseigné.
              </Alerte>
            )}

            {apercu.sansPrixWholesale > 0 && (
              <Alerte>
                <strong>{formatNumber(apercu.sansPrixWholesale)} ligne(s) sans prix wholesale</strong>{" "}
                {source === "commande"
                  ? "— le fichier n'a pas de « Prix à la variation » pour elles."
                  : "— aucun tarif de gros au catalogue pour ces références."}{" "}
                Le montant total ci-dessus les compte pour <strong>zéro</strong> : il est donc
                sous-estimé.
              </Alerte>
            )}

            {apercu.commandesSansCodeClient.length > 0 && (
              <Alerte>
                <strong>{apercu.commandesSansCodeClient.length} commande(s) sans code client</strong>{" "}
                : {apercu.commandesSansCodeClient.slice(0, 6).join(", ")}
                {apercu.commandesSansCodeClient.length > 6 && "…"}. Elles ne sont pas (encore)
                importées dans GestLog — l&apos;enseigne reste renseignée, le code client est
                vide.
              </Alerte>
            )}

            {conflits.length > 0 && (
              <Alerte>
                <strong>{conflits.length} commande(s) rattachée(s) à plusieurs fiches boutique</strong>{" "}
                : {conflits.slice(0, 4).map((c) => `${c.orderNumber} (${c.codes.join(" / ")})`).join(", ")}
                {conflits.length > 4 && "…"}. Le premier code par ordre alphabétique est retenu —
                à vérifier dans les fiches clients.
              </Alerte>
            )}

            <div className="flex items-center gap-2">
              <Button onClick={exporter} className="gap-2">
                <Download className="h-4 w-4" />
                Générer le fichier Excel
              </Button>
              <Button variant="ghost" size="sm" onClick={reset} className="gap-2">
                <X className="h-4 w-4" />
                Changer de fichier
              </Button>
            </div>
          </>
        )}
        {busy && apercu && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </CardContent>
    </Card>
  );
}

function Chiffre({ valeur, legende }: { valeur: number; legende: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xl font-bold tabular-nums">{formatNumber(valeur)}</div>
      <p className="text-xs text-muted-foreground">{legende}</p>
    </div>
  );
}

function Alerte({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

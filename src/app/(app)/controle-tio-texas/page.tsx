"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Check,
  Download,
  FileSpreadsheet,
  GitCompareArrows,
  Info,
  Loader2,
  Search,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { cn, formatNumber } from "@/lib/utils";
import { fileStamp } from "@/lib/file-stamp";
import { detecterFormat, type FormatControle } from "@/lib/controle-tio-texas/formats";
import {
  rapportVersFeuilles,
  LIBELLE_STATUT_COMMANDE,
  LIBELLE_STATUT_LIGNE,
  type Cote,
  type EcartCommande,
  type EcartLigne,
  type StatutCommande,
  type StatutLigne,
  type SyntheseControle,
} from "@/lib/controle-tio-texas/engine";

const LIBELLE_FORMAT: Record<FormatControle, string> = {
  texas: "Commande client Texas (ERP)",
  long: "Une ligne par taille (export GestLog)",
  statgen: "Commande client TIO (StatGen)",
};

interface InfoFichier {
  nom: string;
  format: FormatControle;
  libelleFormat: string;
  lignesLues: number;
  taillesNonDecodees: number;
  avertissements: string[];
}

interface Rapport {
  synthese: SyntheseControle;
  commandes: EcartCommande[];
  lignes: EcartLigne[];
  lignesTronquees: boolean;
  lignesConformesIncluses: boolean;
  fichiers: { tio: InfoFichier; texas: InfoFichier };
}

interface Fente {
  file: File | null;
  format: FormatControle | null;
  cote: Cote | null; // côté forcé par l'utilisateur
}

const FENTE_VIDE: Fente = { file: null, format: null, cote: null };

const euro = (n: number | null) =>
  n == null ? "—" : `${n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d)(?=,))/g, " ")} €`;

function Tuile({
  label,
  valeur,
  ton,
  aide,
}: {
  label: string;
  valeur: string | number;
  ton?: "ok" | "alerte" | "danger";
  aide?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        ton === "ok" && "border-emerald-200 bg-emerald-50/60",
        ton === "alerte" && "border-amber-200 bg-amber-50/60",
        ton === "danger" && "border-red-200 bg-red-50/60"
      )}
      title={aide}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{valeur}</div>
    </div>
  );
}

function BadgeStatut({ statut }: { statut: StatutCommande | StatutLigne }) {
  const libelle =
    (LIBELLE_STATUT_COMMANDE as Record<string, string>)[statut] ??
    (LIBELLE_STATUT_LIGNE as Record<string, string>)[statut];
  if (statut === "ok") {
    return (
      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
        <Check className="mr-1 h-3 w-3" />
        {libelle}
      </Badge>
    );
  }
  const rouge = statut === "manquante_texas" || statut === "en_trop_texas";
  return (
    <Badge
      className={cn(
        "hover:bg-inherit",
        rouge ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
      )}
    >
      <AlertTriangle className="mr-1 h-3 w-3" />
      {libelle}
    </Badge>
  );
}

/** Une case de dépôt : le format est reconnu DÈS le dépôt, avant toute comparaison. */
function Depot({
  titre,
  description,
  fente,
  onChange,
}: {
  titre: string;
  description: string;
  fente: Fente;
  onChange: (f: Fente) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [survol, setSurvol] = useState(false);

  const prendre = useCallback(
    async (file: File) => {
      try {
        const format = detecterFormat(await file.arrayBuffer());
        if (!format) {
          toast.error(`« ${file.name} » : format non reconnu`);
          onChange({ file, format: null, cote: null });
          return;
        }
        onChange({ file, format, cote: null });
      } catch {
        toast.error(`« ${file.name} » est illisible`);
        onChange(FENTE_VIDE);
      }
    },
    [onChange]
  );

  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium">{titre}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      {fente.file ? (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
          <FileSpreadsheet className="h-7 w-7 shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{fente.file.name}</p>
            <p className="text-xs text-muted-foreground">
              {fente.format ? (
                <>Format reconnu : {LIBELLE_FORMAT[fente.format]}</>
              ) : (
                <span className="text-red-600">Format non reconnu</span>
              )}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onChange(FENTE_VIDE)}
            aria-label="Retirer le fichier"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setSurvol(true);
          }}
          onDragLeave={() => setSurvol(false)}
          onDrop={(e) => {
            e.preventDefault();
            setSurvol(false);
            const f = e.dataTransfer.files[0];
            if (f) void prendre(f);
          }}
          className={cn(
            "flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
            survol ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
          )}
        >
          <Upload className="h-6 w-6 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Glisse le fichier ici, ou clique pour le choisir
          </span>
          <span className="text-xs text-muted-foreground">.xlsx, .xls, .csv</span>
        </button>
      )}
      <input
        ref={ref}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void prendre(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export default function ControleTioTexasPage() {
  const [a, setA] = useState<Fente>(FENTE_VIDE);
  const [b, setB] = useState<Fente>(FENTE_VIDE);
  const [tolerance, setTolerance] = useState("0.01");
  const [ignorerSoldees, setIgnorerSoldees] = useState(false);
  const [inclureConformes, setInclureConformes] = useState(false);
  const [chargement, setChargement] = useState(false);
  const [rapport, setRapport] = useState<Rapport | null>(null);
  const [recherche, setRecherche] = useState("");
  const [ecartsSeulement, setEcartsSeulement] = useState(true);

  // Les deux fichiers sont-ils de côtés opposés ? (Texas d'un côté, TIO de l'autre)
  const coteDe = (f: Fente): Cote | null =>
    f.cote ?? (f.format ? (f.format === "texas" ? "TEXAS" : "TIO") : null);
  const memeCote = !!(a.format && b.format && coteDe(a) === coteDe(b));
  const pret = !!(a.file && b.file && a.format && b.format && !memeCote);

  const comparer = async () => {
    if (!a.file || !b.file) return;
    setChargement(true);
    setRapport(null);
    try {
      const fd = new FormData();
      fd.append("fichierA", a.file);
      fd.append("fichierB", b.file);
      if (a.cote) fd.append("coteA", a.cote);
      if (b.cote) fd.append("coteB", b.cote);
      fd.append("toleranceMontant", tolerance || "0.01");
      if (ignorerSoldees) fd.append("ignorerSoldees", "1");
      if (inclureConformes) fd.append("inclureConformes", "1");

      const r = await fetch("/api/controle-tio-texas", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) {
        toast.error(j.error || "Comparaison impossible");
        return;
      }
      setRapport(j.data as Rapport);
      const s = (j.data as Rapport).synthese;
      if (s.commandesAvecEcart + s.commandesManquantes + s.commandesEnTrop === 0) {
        toast.success("Aucun écart : les deux fichiers concordent");
      } else {
        toast.warning(
          `${s.commandesAvecEcart + s.commandesManquantes + s.commandesEnTrop} commande(s) à vérifier`
        );
      }
    } catch {
      toast.error("Comparaison impossible");
    } finally {
      setChargement(false);
    }
  };

  const q = recherche.trim().toLowerCase();
  const commandesFiltrees = useMemo(() => {
    if (!rapport) return [];
    return rapport.commandes.filter((c) => {
      if (ecartsSeulement && c.statut === "ok") return false;
      if (!q) return true;
      return [c.numeroTio, c.numeroTexas, c.codeClientTio, c.codeClientTexas, c.nomClient]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rapport, q, ecartsSeulement]);

  const lignesFiltrees = useMemo(() => {
    if (!rapport) return [];
    return rapport.lignes.filter((l) => {
      if (ecartsSeulement && l.statut === "ok") return false;
      if (!q) return true;
      return [l.numeroTio, l.codeClient, l.reference, l.codeCouleur, l.libelleCouleur]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rapport, q, ecartsSeulement]);

  const exporter = () => {
    if (!rapport) return;
    const feuilles = rapportVersFeuilles(
      { synthese: rapport.synthese, commandes: rapport.commandes, lignes: rapport.lignes },
      {
        fichierTio: rapport.fichiers.tio.nom,
        fichierTexas: rapport.fichiers.texas.nom,
        genereLe: new Date().toLocaleString("fr-FR"),
      }
    );
    const wb = XLSX.utils.book_new();
    for (const f of feuilles) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(f.lignes), f.nom);
    }
    XLSX.writeFile(wb, `controle_tio_texas_${fileStamp()}.xlsx`);
    toast.success("Rapport exporté");
  };

  const s = rapport?.synthese;
  const avertissements = rapport
    ? [
        ...rapport.fichiers.tio.avertissements.map((t) => `TIO — ${t}`),
        ...rapport.fichiers.texas.avertissements.map((t) => `Texas — ${t}`),
      ]
    : [];

  return (
    <div>
      <Topbar title="Contrôle TIO ↔ Texas" />
      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
        <PageHeader
          title="Contrôle TIO ↔ Texas"
          description="Dépose l'export des commandes TIO et l'export des commandes Texas : GestLog vérifie que tout a été ressaisi à l'identique — commandes, produits, quantités par taille et montants."
          action={
            rapport && (
              <Button variant="outline" size="sm" onClick={exporter} className="gap-2">
                <Download className="h-4 w-4" />
                Exporter le rapport
              </Button>
            )
          }
        />

        <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
          <span>
            Le rapprochement se fait sur le <strong>n° de commande TIO</strong> — c&apos;est le
            seul lien entre les deux sources. Côté Texas, il est porté par la colonne «{" "}
            <strong>Référence commande client</strong> » (PO-… pour une commande de catalogue,
            IS-… pour un réassort) : les n° de commande propres à Texas, eux, sont totalement
            disjoints de ceux de TIO.
            <br />
            Rien n&apos;est importé ni modifié : les deux fichiers sont seulement comparés.
          </span>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <GitCompareArrows className="h-4 w-4" />
              Les deux fichiers à comparer
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Depot
                titre="Fichier 1"
                description="L'export TIO (ou l'export GestLog « détail par code-barres »)."
                fente={a}
                onChange={setA}
              />
              <Depot
                titre="Fichier 2"
                description="L'export des commandes clients de Texas."
                fente={b}
                onChange={setB}
              />
            </div>

            {memeCote && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Les deux fichiers ont été reconnus du <strong>même côté</strong> (
                  {coteDe(a) === "TEXAS" ? "Texas" : "TIO"}). Dépose un export TIO{" "}
                  <em>et</em> un export Texas.
                </span>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="tol">
                  Écart de montant toléré (€)
                </label>
                <Input
                  id="tol"
                  value={tolerance}
                  onChange={(e) => setTolerance(e.target.value)}
                  className="h-9"
                  inputMode="decimal"
                />
              </div>
              <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
                <span className="text-xs">
                  Ignorer les commandes <strong>soldées</strong> côté Texas
                </span>
                <Switch
                  checked={ignorerSoldees}
                  onCheckedChange={(v) => setIgnorerSoldees(Boolean(v))}
                />
              </div>
              <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
                <span className="text-xs">
                  Garder aussi les produits <strong>conformes</strong> dans le détail
                </span>
                <Switch
                  checked={inclureConformes}
                  onCheckedChange={(v) => setInclureConformes(Boolean(v))}
                />
              </div>
            </div>

            <Button onClick={comparer} disabled={!pret || chargement} className="w-full gap-2">
              {chargement ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <GitCompareArrows className="h-4 w-4" />
              )}
              {chargement ? "Comparaison en cours…" : "Comparer les deux fichiers"}
            </Button>
          </CardContent>
        </Card>

        {s && rapport && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Synthèse</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <Tuile
                    label="Commandes conformes"
                    valeur={formatNumber(s.commandesConformes)}
                    ton={s.commandesConformes === s.commandesTio ? "ok" : undefined}
                  />
                  <Tuile
                    label="Commandes avec écart"
                    valeur={formatNumber(s.commandesAvecEcart)}
                    ton={s.commandesAvecEcart > 0 ? "alerte" : undefined}
                  />
                  <Tuile
                    label="Absentes de Texas"
                    valeur={formatNumber(s.commandesManquantes)}
                    ton={s.commandesManquantes > 0 ? "danger" : undefined}
                    aide="Commandes prises dans TIO qui n'ont jamais été saisies dans Texas."
                  />
                  <Tuile
                    label="En trop dans Texas"
                    valeur={formatNumber(s.commandesEnTrop)}
                    ton={s.commandesEnTrop > 0 ? "danger" : undefined}
                    aide="Commandes saisies dans Texas sans équivalent dans TIO."
                  />
                  <Tuile label="Taux de conformité" valeur={`${s.tauxConformite} %`} />
                </div>

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead></TableHead>
                        <TableHead className="text-right">TIO</TableHead>
                        <TableHead className="text-right">Texas</TableHead>
                        <TableHead className="text-right">Écart</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-medium">Commandes</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(s.commandesTio)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(s.commandesTexas)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(s.commandesTexas - s.commandesTio)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium">Pièces</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(s.piecesTio)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(s.piecesTexas)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            s.piecesTexas !== s.piecesTio && "font-semibold text-red-600"
                          )}
                        >
                          {formatNumber(s.piecesTexas - s.piecesTio)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium">Montant</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {euro(s.montantTio)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {euro(s.montantTexas)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {s.montantTio != null && s.montantTexas != null
                            ? euro(Math.round((s.montantTexas - s.montantTio) * 100) / 100)
                            : "—"}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                  <div>
                    <strong>{rapport.fichiers.tio.nom}</strong> → côté TIO,{" "}
                    {rapport.fichiers.tio.libelleFormat},{" "}
                    {formatNumber(rapport.fichiers.tio.lignesLues)} ligne(s) lue(s).
                  </div>
                  <div>
                    <strong>{rapport.fichiers.texas.nom}</strong> → côté Texas,{" "}
                    {rapport.fichiers.texas.libelleFormat},{" "}
                    {formatNumber(rapport.fichiers.texas.lignesLues)} ligne(s) lue(s).
                  </div>
                </div>

                {!s.montantComparable && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      <strong>Montants non comparés</strong> : un des deux fichiers ne porte aucun
                      montant. Les quantités, elles, ont bien été comparées.
                    </span>
                  </div>
                )}

                {s.taillesNonComparables > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                    <span>
                      {formatNumber(s.taillesComparees)} produit(s) comparé(s){" "}
                      <strong>taille par taille</strong> et{" "}
                      {formatNumber(s.taillesNonComparables)} sur le{" "}
                      <strong>total de pièces seulement</strong> (tailles non décodables d&apos;un
                      des deux côtés).
                    </span>
                  </div>
                )}

                {avertissements.map((t, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{t}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-4 pt-6">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative min-w-56 flex-1">
                    <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={recherche}
                      onChange={(e) => setRecherche(e.target.value)}
                      placeholder="Commande, code client, référence…"
                      className="h-9 pl-9"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Écarts seulement</span>
                    <Switch
                      checked={ecartsSeulement}
                      onCheckedChange={(v) => setEcartsSeulement(Boolean(v))}
                    />
                  </div>
                </div>

                <Tabs defaultValue="commandes">
                  <TabsList>
                    <TabsTrigger value="commandes">
                      Commandes ({formatNumber(commandesFiltrees.length)})
                    </TabsTrigger>
                    <TabsTrigger value="produits">
                      Produits ({formatNumber(lignesFiltrees.length)})
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="commandes" className="mt-4">
                    {commandesFiltrees.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        {ecartsSeulement
                          ? "Aucun écart au niveau des commandes. 🎉"
                          : "Aucune commande à afficher."}
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Statut</TableHead>
                              <TableHead>N° TIO</TableHead>
                              <TableHead>N° Texas</TableHead>
                              <TableHead>Client</TableHead>
                              <TableHead className="text-right">Pièces TIO</TableHead>
                              <TableHead className="text-right">Pièces Texas</TableHead>
                              <TableHead className="text-right">Montant TIO</TableHead>
                              <TableHead className="text-right">Montant Texas</TableHead>
                              <TableHead>Anomalies</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {commandesFiltrees.slice(0, 500).map((c, i) => (
                              <TableRow key={`${c.numeroTio}-${i}`}>
                                <TableCell>
                                  <BadgeStatut statut={c.statut} />
                                </TableCell>
                                <TableCell className="font-medium">{c.numeroTio}</TableCell>
                                <TableCell className="text-muted-foreground">
                                  {c.numeroTexas || "—"}
                                </TableCell>
                                <TableCell>
                                  <div className="text-sm">{c.codeClientTio || c.codeClientTexas || "—"}</div>
                                  {c.nomClient && (
                                    <div className="text-xs text-muted-foreground">{c.nomClient}</div>
                                  )}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatNumber(c.piecesTio)}
                                </TableCell>
                                <TableCell
                                  className={cn(
                                    "text-right tabular-nums",
                                    c.piecesTexas !== c.piecesTio && "font-semibold text-red-600"
                                  )}
                                >
                                  {formatNumber(c.piecesTexas)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {euro(c.montantTio)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {euro(c.montantTexas)}
                                </TableCell>
                                <TableCell className="max-w-xs text-xs text-muted-foreground">
                                  {c.anomalies.join(" ; ") || "—"}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {commandesFiltrees.length > 500 && (
                          <p className="pt-3 text-center text-xs text-muted-foreground">
                            500 premières commandes affichées sur{" "}
                            {formatNumber(commandesFiltrees.length)} — le rapport Excel contient
                            tout.
                          </p>
                        )}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="produits" className="mt-4">
                    {!rapport.lignesConformesIncluses && !ecartsSeulement && (
                      <p className="mb-3 text-xs text-muted-foreground">
                        Seuls les produits en écart ont été rapatriés. Active « Garder aussi les
                        produits conformes » puis relance la comparaison pour voir tout le détail.
                      </p>
                    )}
                    {lignesFiltrees.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        Aucun écart au niveau des produits. 🎉
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Statut</TableHead>
                              <TableHead>N° TIO</TableHead>
                              <TableHead>Référence</TableHead>
                              <TableHead>Coloris</TableHead>
                              <TableHead className="text-right">TIO</TableHead>
                              <TableHead className="text-right">Texas</TableHead>
                              <TableHead>Détail des tailles</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {lignesFiltrees.slice(0, 500).map((l, i) => (
                              <TableRow key={`${l.numeroTio}-${l.reference}-${l.codeCouleur}-${i}`}>
                                <TableCell>
                                  <BadgeStatut statut={l.statut} />
                                </TableCell>
                                <TableCell className="font-medium">{l.numeroTio}</TableCell>
                                <TableCell>{l.reference}</TableCell>
                                <TableCell>
                                  <div className="text-sm">{l.codeCouleur}</div>
                                  {l.libelleCouleur && (
                                    <div className="text-xs text-muted-foreground">
                                      {l.libelleCouleur}
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatNumber(l.piecesTio)}
                                </TableCell>
                                <TableCell
                                  className={cn(
                                    "text-right tabular-nums",
                                    l.piecesTexas !== l.piecesTio && "font-semibold text-red-600"
                                  )}
                                >
                                  {formatNumber(l.piecesTexas)}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {!l.taillesComparables
                                    ? "tailles non comparables"
                                    : l.tailles.length === 0
                                      ? "—"
                                      : l.tailles
                                          .map((t) => `${t.taille} : ${t.tio} → ${t.texas}`)
                                          .join(" ; ")}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {lignesFiltrees.length > 500 && (
                          <p className="pt-3 text-center text-xs text-muted-foreground">
                            500 premiers produits affichés sur {formatNumber(lignesFiltrees.length)}{" "}
                            — le rapport Excel contient tout.
                          </p>
                        )}
                        {rapport.lignesTronquees && (
                          <p className="pt-2 text-center text-xs text-amber-700">
                            Le détail a été tronqué à 20 000 produits : affine le périmètre des
                            fichiers déposés.
                          </p>
                        )}
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

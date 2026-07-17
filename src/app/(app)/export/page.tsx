"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSeason, formatSeasonLabel } from "@/lib/season-context";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Calendar,
  Download,
  PackageCheck,
  GitCompareArrows,
  Calculator,
  ArrowLeftRight,
  Store,
  Truck,
  ExternalLink,
  Loader2,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

interface ReceptionRow {
  id: string;
  receptionNumber: string;
  createdAt: string;
  orderNumber: string;
  supplierName: string;
  supplierCode: string;
  lineCount: number;
  totalQty: number;
}

export default function ExportPage() {
  const { seasons, activeSeason } = useSeason();
  const [seasonId, setSeasonId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // Sélection des réceptions à exporter (multi + recherche fournisseur).
  const [receptions, setReceptions] = useState<ReceptionRow[]>([]);
  const [selectedRec, setSelectedRec] = useState<Set<string>>(new Set());
  const [recSearch, setRecSearch] = useState("");

  useEffect(() => {
    if (!seasonId && activeSeason) setSeasonId(activeSeason.id);
  }, [activeSeason, seasonId]);

  // Charge les réceptions de la saison choisie (pour le sélecteur).
  useEffect(() => {
    if (!seasonId) {
      setReceptions([]);
      setSelectedRec(new Set());
      return;
    }
    fetch(`/api/import/receptions?seasonId=${seasonId}`)
      .then((r) => r.json())
      .then((d) => {
        setReceptions(d.data || []);
        setSelectedRec(new Set()); // par défaut : aucune sélection = toutes exportées
      })
      .catch(() => setReceptions([]));
  }, [seasonId]);

  const season = seasons.find((s) => s.id === seasonId) || null;

  const filteredReceptions = receptions.filter((r) => {
    const q = recSearch.trim().toLowerCase();
    return (
      !q ||
      r.supplierName.toLowerCase().includes(q) ||
      r.supplierCode.toLowerCase().includes(q) ||
      r.orderNumber.toLowerCase().includes(q)
    );
  });
  const toggleRec = (id: string) =>
    setSelectedRec((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Réceptions → CSV EAN/quantité (format concaténé). Téléchargement via blob pour lire
  // les diagnostics (lignes écartées) renvoyés en en-têtes.
  const exportReceptions = async () => {
    if (!seasonId) return;
    setBusy("receptions");
    try {
      const recParam =
        selectedRec.size > 0 ? `&receptionIds=${[...selectedRec].join(",")}` : "";
      const res = await fetch(`/api/export/receptions?seasonId=${seasonId}${recParam}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error || "Export impossible");
        return;
      }
      const rows = Number(res.headers.get("X-Rows") || 0);
      const noSeason = Number(res.headers.get("X-Skipped-No-Season") || 0);
      const noEan = Number(res.headers.get("X-Skipped-No-Ean") || 0);
      // Rien à exporter → on n'ouvre pas de fichier vide, on explique pourquoi.
      if (rows === 0) {
        if (noSeason > 0)
          toast.error(
            `Fichier vide : ${noSeason} ligne(s) sans code saison. Réimporte le fichier COMMANDE FOURNISSEUR (le code saison en vient) puis réessaie.`,
            { duration: 8000 }
          );
        else if (noEan > 0)
          toast.error(`Fichier vide : ${noEan} ligne(s) sans EAN au référentiel.`, { duration: 8000 });
        else toast.warning("Aucune réception à exporter pour cette sélection.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `receptions_${season?.name || seasonId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`${rows} ligne(s) exportée(s)`);
      if (noSeason > 0)
        toast.warning(`${noSeason} ligne(s) sans code saison ignorées (réimporte la commande fournisseur)`);
      if (noEan > 0) toast.warning(`${noEan} ligne(s) sans EAN ignorées`);
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setBusy(null);
    }
  };

  // Comparaison commande/réception → xlsx (même contenu que l'écran Comparaison).
  const exportComparison = async () => {
    if (!seasonId) return;
    setBusy("comparison");
    try {
      const res = await fetch(`/api/comparison?seasonId=${seasonId}`);
      const data = await res.json();
      const summaries = data.data || [];
      const rows = summaries.flatMap(
        (s: {
          supplierName: string;
          rows: {
            reference: string;
            color: string;
            totalOrdered: number;
            totalReceived: number;
            totalGap: number;
            gapPercent: number;
            status: string;
          }[];
        }) =>
          s.rows.map((r) => ({
            Fournisseur: s.supplierName,
            Référence: r.reference,
            Couleur: r.color,
            Commandé: r.totalOrdered,
            Reçu: r.totalReceived,
            Écart: r.totalGap,
            "Écart %": r.gapPercent,
            Statut:
              r.status === "conforme" ? "Conforme" : r.status === "ecart_mineur" ? "Écart mineur" : "Écart majeur",
          }))
      );
      if (rows.length === 0) {
        toast.warning("Aucune donnée de comparaison pour cette saison");
        return;
      }
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Comparaison");
      XLSX.writeFile(wb, `comparaison_${season?.name || ""}.xlsx`);
      toast.success(`${rows.length} ligne(s) exportée(s)`);
    } catch {
      toast.error("Export impossible");
    } finally {
      setBusy(null);
    }
  };

  // Exports contextuels (nécessitent une action sur leur écran) → liens.
  const linkExports = [
    {
      icon: Calculator,
      title: "Répartition",
      desc: "Export xlsx + fichier EAN. Depuis une simulation en cours, ou depuis une répartition déjà validée (Historique → une session), avec filtre fournisseur / boutique.",
      href: "/allocation",
    },
    {
      icon: ArrowLeftRight,
      title: "Comparaison saisons / catalogues",
      desc: "Export xlsx du détail par catégorie, selon les deux saisons/catalogues choisis.",
      href: "/season-comparison",
    },
    {
      icon: Store,
      title: "Répartition magasin",
      desc: "Split d'une commande TIO en 1 onglet xlsx par fournisseur (dépôt du fichier requis).",
      href: "/repartition",
    },
    {
      icon: Truck,
      title: "Livraisons — fichier EAN",
      desc: "Fichier EAN/quantité par livraison, généré à l'expédition.",
      href: "/deliveries",
    },
  ];

  return (
    <div>
      <Topbar title="Exports" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-8">
        <PageHeader
          title="Exports"
          description="Tous les exports GestLog regroupés (hors BtoC)."
        />

        {/* Saison cible */}
        <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3 space-y-1.5 max-w-md">
          <label htmlFor="export-season" className="text-sm font-semibold flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Saison
          </label>
          <select
            id="export-season"
            value={seasonId}
            onChange={(e) => setSeasonId(e.target.value)}
            className="w-full rounded-lg border-2 border-input bg-background px-3 py-2 text-sm font-medium outline-none focus:border-primary"
          >
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {formatSeasonLabel(s)}
                {activeSeason && s.id === activeSeason.id ? " — active" : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Exports directs (téléchargement immédiat) */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Téléchargement direct</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <PackageCheck className="h-4 w-4 text-emerald-600" />
                  Réceptions — CSV EAN / quantité
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  À partir des réceptions fournisseur : une valeur par ligne, concaténée sans espace —{" "}
                  <span className="font-mono text-xs">
                    [saison 3c][n° commande 11c][EAN 13c][quantité]
                  </span>
                  . Code saison lu dans le fichier commande fournisseur ; quantités à 0 exclues.
                </p>

                {/* Sélecteur de réceptions (multi + recherche fournisseur). */}
                <div className="rounded-md border">
                  <div className="flex items-center gap-2 border-b p-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={recSearch}
                        onChange={(e) => setRecSearch(e.target.value)}
                        placeholder="Rechercher un fournisseur / n° commande…"
                        className="w-full rounded border-0 bg-transparent pl-7 text-sm outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => setSelectedRec(new Set(filteredReceptions.map((r) => r.id)))}
                    >
                      Tout
                    </button>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:underline"
                      onClick={() => setSelectedRec(new Set())}
                    >
                      Aucun
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto p-1">
                    {filteredReceptions.length === 0 ? (
                      <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                        {receptions.length === 0 ? "Aucune réception pour cette saison." : "Aucun résultat."}
                      </p>
                    ) : (
                      filteredReceptions.map((r) => (
                        <label
                          key={r.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50"
                        >
                          <input
                            type="checkbox"
                            checked={selectedRec.has(r.id)}
                            onChange={() => toggleRec(r.id)}
                            className="h-3.5 w-3.5"
                          />
                          <span className="min-w-0 flex-1 truncate">
                            <span className="font-medium">{r.supplierName}</span>{" "}
                            <span className="text-xs text-muted-foreground">
                              · cmd {r.orderNumber} · {r.totalQty} pcs
                            </span>
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {selectedRec.size > 0
                    ? `${selectedRec.size} réception(s) sélectionnée(s).`
                    : "Aucune sélection = toutes les réceptions de la saison."}
                </p>

                <Button onClick={exportReceptions} disabled={!seasonId || busy !== null} className="gap-2">
                  {busy === "receptions" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Exporter les réceptions
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitCompareArrows className="h-4 w-4 text-blue-600" />
                  Comparaison commande / réception
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Écarts commandé / reçu par fournisseur et référence (xlsx), pour la saison choisie.
                </p>
                <Button
                  onClick={exportComparison}
                  disabled={!seasonId || busy !== null}
                  variant="outline"
                  className="gap-2"
                >
                  {busy === "comparison" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Exporter la comparaison
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Exports contextuels (sur leur écran) */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
            Depuis leur écran (contexte requis)
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {linkExports.map((e) => (
              <Card key={e.href}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <e.icon className="h-4 w-4 text-muted-foreground" />
                    {e.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">{e.desc}</p>
                  <Link href={e.href}>
                    <Button variant="outline" size="sm" className="gap-2">
                      <ExternalLink className="h-4 w-4" />
                      Ouvrir l&apos;écran
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

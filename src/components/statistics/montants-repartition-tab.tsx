"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Loader2, Search, TriangleAlert } from "lucide-react";
import { cn, formatEuro, formatNumber } from "@/lib/utils";

// Montants du pipeline de répartition : commandé (import commande client) → réparti
// (sessions validées) → manquant. Cf. src/lib/repartition-montants.ts pour le pourquoi
// du périmètre et pour la déduction du montant réparti.

interface Groupe {
  id: string;
  label: string;
  commande: number;
  solde: number;
  reparti: number;
  manquant: number;
  qCommandee: number;
  qRepartie: number;
  taux: number;
}
interface Rapport {
  total: Omit<Groupe, "id" | "label">;
  parBoutique: Groupe[];
  parCatalogue: Groupe[];
  lignesSansMontant: number;
  surRepartition: number;
  meta: {
    source: string;
    lineCount: number;
    orderLineDuplicates: number;
    validatedSessions: number;
  };
}

const TOUS = "__tous__";

export function MontantsRepartitionTab({ seasonId }: { seasonId: string }) {
  const [data, setData] = useState<Rapport | null>(null);
  const [loading, setLoading] = useState(true);
  const [catalogId, setCatalogId] = useState(TOUS);
  const [clientId, setClientId] = useState(TOUS);
  const [recherche, setRecherche] = useState("");

  // Les listes de filtres viennent du rapport NON filtré : filtrer sur un catalogue ne
  // doit pas faire disparaître les autres choix de la liste.
  const [listes, setListes] = useState<{ catalogues: Groupe[]; boutiques: Groupe[] }>({
    catalogues: [],
    boutiques: [],
  });

  const charger = useCallback(async () => {
    if (!seasonId) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({ seasonId });
      if (catalogId !== TOUS) p.set("catalogId", catalogId);
      if (clientId !== TOUS) {
        p.set("clients", clientId);
        p.set("clientMode", "include");
      }
      const res = await fetch(`/api/statistics/repartition-montants?${p}`);
      if (!res.ok) return;
      const json: Rapport = await res.json();
      setData(json);
      if (catalogId === TOUS && clientId === TOUS) {
        setListes({ catalogues: json.parCatalogue, boutiques: json.parBoutique });
      }
    } finally {
      setLoading(false);
    }
  }, [seasonId, catalogId, clientId]);

  useEffect(() => {
    charger();
  }, [charger]);

  const boutiquesFiltrees = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    if (!q) return data?.parBoutique ?? [];
    return (data?.parBoutique ?? []).filter((b) => b.label.toLowerCase().includes(q));
  }, [data, recherche]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Calcul des montants…
      </div>
    );
  }
  if (!data) return null;

  const t = data.total;
  const nomCatalogue =
    catalogId === TOUS
      ? "Tous les catalogues"
      : listes.catalogues.find((c) => c.id === catalogId)?.label || "—";
  const nomBoutique =
    clientId === TOUS
      ? "Toutes les boutiques"
      : listes.boutiques.find((b) => b.id === clientId)?.label || "—";

  return (
    <div className="space-y-6">
      {/* ── Filtres ── */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-muted-foreground">Catalogue</label>
          <Select value={catalogId} onValueChange={(v) => v && setCatalogId(v)}>
            <SelectTrigger className="h-9 w-64">
              <span className="truncate text-sm">{nomCatalogue}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TOUS}>Tous les catalogues</SelectItem>
              {listes.catalogues.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-muted-foreground">Boutique</label>
          <Select value={clientId} onValueChange={(v) => v && setClientId(v)}>
            <SelectTrigger className="h-9 w-64">
              <span className="truncate text-sm">{nomBoutique}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TOUS}>Toutes les boutiques</SelectItem>
              {listes.boutiques.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {loading && <Loader2 className="mb-2 h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {/* ── Les quatre chiffres ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent>
            <div className="text-2xl font-bold">{formatEuro(t.commande)}</div>
            <p className="text-sm text-muted-foreground">
              Commandé · {formatNumber(t.qCommandee)} pcs
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-700">{formatEuro(t.reparti)}</div>
            <p className="text-sm text-muted-foreground">
              Réparti · {formatNumber(t.qRepartie)} pcs
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-2xl font-bold text-red-700">{formatEuro(t.manquant)}</div>
            <p className="text-sm text-muted-foreground">
              Manquant
              {t.solde > 0 && ` · hors ${formatEuro(t.solde)} soldés`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-2xl font-bold">{t.taux.toLocaleString("fr-FR")} %</div>
            <Progress value={Math.min(100, t.taux)} className="mt-2" />
            <p className="mt-1 text-sm text-muted-foreground">du montant commandé réparti</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Ce qui rendrait les chiffres trompeurs ── */}
      {data.meta.validatedSessions === 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>Aucune répartition validée sur cette saison.</strong> Le réparti vaut donc
            0 et tout apparaît comme manquant — ce n&apos;est pas une anomalie de données.
          </span>
        </div>
      )}
      {data.lignesSansMontant > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>
              {formatNumber(data.lignesSansMontant)} ligne(s) commandée(s) sans montant
            </strong>{" "}
            sur {formatNumber(data.meta.lineCount)} : elles pèsent dans les pièces mais pas
            dans les euros. Le taux en € est donc calculé sur un périmètre plus étroit.
          </span>
        </div>
      )}
      {data.surRepartition > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>{data.surRepartition} ligne(s) réparties au-delà du commandé.</strong> Rien
            n&apos;est écrêté : le manquant devient négatif là où c&apos;est le cas, pour que
            l&apos;anomalie se voie.
          </span>
        </div>
      )}

      {/* ── Par catalogue ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Par catalogue</CardTitle>
            <Badge variant="secondary">{data.parCatalogue.length}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <TableMontants lignes={data.parCatalogue} colonne="Catalogue" />
        </CardContent>
      </Card>

      {/* ── Par boutique ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <CardTitle className="text-base">Par boutique</CardTitle>
              <Badge variant="secondary">{boutiquesFiltrees.length}</Badge>
            </div>
            <div className="relative">
              <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder="Rechercher une boutique…"
                className="h-9 w-64 pl-8"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <TableMontants lignes={boutiquesFiltrees} colonne="Boutique" />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Commandes lues sur la source <strong>{data.meta.source}</strong> ·{" "}
        {formatNumber(data.meta.lineCount)} lignes de commande ·{" "}
        {data.meta.validatedSessions} répartition(s) validée(s). Le montant réparti est
        déduit au prorata de la pièce : aucun montant n&apos;est stocké sur une quantité
        répartie.
      </p>
    </div>
  );
}

function TableMontants({ lignes, colonne }: { lignes: Groupe[]; colonne: string }) {
  if (lignes.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Aucune ligne.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{colonne}</TableHead>
            <TableHead className="text-right">Commandé</TableHead>
            <TableHead className="text-right">Réparti</TableHead>
            <TableHead className="text-right">Manquant</TableHead>
            <TableHead className="text-right">Taux</TableHead>
            <TableHead className="text-right">Pcs cmd.</TableHead>
            <TableHead className="text-right">Pcs rép.</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lignes.map((l) => (
            <TableRow key={l.id}>
              <TableCell className="font-medium">{l.label}</TableCell>
              <TableCell className="text-right tabular-nums">{formatEuro(l.commande)}</TableCell>
              <TableCell className="text-right tabular-nums text-emerald-700">
                {formatEuro(l.reparti)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-red-700">
                {formatEuro(l.manquant)}
              </TableCell>
              <TableCell className="text-right">
                {/* Le taux en couleur : on repère d'un coup d'œil qui n'a rien reçu. */}
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-xs font-medium tabular-nums",
                    l.taux >= 80
                      ? "bg-emerald-100 text-emerald-800"
                      : l.taux >= 40
                        ? "bg-amber-100 text-amber-800"
                        : "bg-red-100 text-red-800"
                  )}
                >
                  {l.taux.toLocaleString("fr-FR")} %
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {formatNumber(l.qCommandee)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {formatNumber(l.qRepartie)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

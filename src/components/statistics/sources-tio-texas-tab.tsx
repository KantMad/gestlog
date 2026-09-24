"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Search, TriangleAlert, ArrowLeftRight } from "lucide-react";
import { cn, formatEuro, formatNumber } from "@/lib/utils";

// Commandes clients importées : TIO (prise de commande, archive) contre TEXAS (ERP).
//
// 🔴 Seul endroit de l'application qui lit les DEUX sources. Partout ailleurs,
// `resolveOrderSource` n'en retient qu'une et l'autre devient invisible.

interface Cote {
  orders: number;
  lines: number;
  pieces: number;
  amount: number;
}
interface Ligne {
  id: string;
  label: string;
  tio: Cote;
  texas: Cote;
  ecartPieces: number;
  ecartAmount: number;
  presence: "deux" | "tio" | "texas";
  ressemble?: string;
  ressembleExact?: boolean;
}
interface Donnees {
  totaux: { tio: Cote; texas: Cote };
  boutiques: Ligne[];
  catalogues: Ligne[];
  meta: {
    sourceActive: string;
    lesDeuxSources: boolean;
    fichesEnDouble: number;
    fichesEnDoubleExactes: number;
    commandes: {
      tioAvecNumero: number;
      texasAvecNumero: number;
      communs: number;
      tioSeulement: number;
      texasSeulement: number;
      sansNumero: number;
    };
  };
}

export function SourcesTioTexasTab({ seasonId }: { seasonId: string }) {
  const [data, setData] = useState<Donnees | null>(null);
  const [loading, setLoading] = useState(true);
  const [recherche, setRecherche] = useState("");
  const [seulementEcarts, setSeulementEcarts] = useState(false);

  const charger = useCallback(async () => {
    if (!seasonId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/statistics/source-comparison?seasonId=${seasonId}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [seasonId]);

  useEffect(() => {
    charger();
  }, [charger]);

  const boutiques = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return (data?.boutiques ?? []).filter(
      (b) =>
        (!q || b.label.toLowerCase().includes(q)) &&
        (!seulementEcarts || b.ecartPieces !== 0)
    );
  }, [data, recherche, seulementEcarts]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Comparaison en cours…
      </div>
    );
  }
  if (!data) return null;

  const { tio, texas } = data.totaux;
  const c = data.meta.commandes;

  if (!data.meta.lesDeuxSources) {
    return (
      <Card className="border-dashed">
        <CardContent className="space-y-2 py-12 text-center">
          <ArrowLeftRight className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium">Une seule source sur cette saison</p>
          <p className="text-sm text-muted-foreground">
            {tio.orders > 0
              ? `${formatNumber(tio.orders)} commande(s) TIO, aucune commande Texas.`
              : `${formatNumber(texas.orders)} commande(s) Texas, aucune commande TIO.`}{" "}
            Il n&apos;y a rien à comparer.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Les deux colonnes de chiffres ── */}
      <div className="grid gap-4 md:grid-cols-3">
        <CarteSource titre="TIO — prise de commande" cote={tio} actif={data.meta.sourceActive === "TIO"} />
        <CarteSource titre="Texas — ERP" cote={texas} actif={data.meta.sourceActive === "TEXAS"} />
        <Card>
          <CardContent>
            <p className="text-sm font-medium">Écart Texas − TIO</p>
            <div
              className={cn(
                "mt-1 text-2xl font-bold",
                texas.pieces - tio.pieces < 0 ? "text-red-700" : "text-emerald-700"
              )}
            >
              {texas.pieces - tio.pieces > 0 ? "+" : ""}
              {formatNumber(texas.pieces - tio.pieces)} pcs
            </div>
            <p className="text-sm text-muted-foreground">
              {texas.amount - tio.amount > 0 ? "+" : ""}
              {formatEuro(texas.amount - tio.amount)} ·{" "}
              {texas.orders - tio.orders > 0 ? "+" : ""}
              {texas.orders - tio.orders} commande(s)
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ⚠️ Dire laquelle est lue ailleurs : c'est l'information qui manque le plus. */}
      <div className="flex items-start gap-2 rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Tous les autres écrans de GestLog ne lisent que{" "}
          <strong>{data.meta.sourceActive}</strong> sur cette saison — Texas est prioritaire
          dès qu&apos;il existe. Ce que porte l&apos;autre source n&apos;apparaît nulle part
          ailleurs.
        </span>
      </div>

      {/* ── Rapprochement des commandes ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Rapprochement des commandes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="secondary">{c.communs} commande(s) des deux côtés</Badge>
            <Badge variant="outline">{c.tioSeulement} seulement dans TIO</Badge>
            <Badge variant="outline">{c.texasSeulement} seulement dans Texas</Badge>
            {c.sansNumero > 0 && (
              <Badge variant="outline" className="text-amber-700">
                {c.sansNumero} sans n° de commande TIO
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Les numéros de commande ne se recoupent pas d&apos;une source à l&apos;autre :
            chacune a sa numérotation. Le rapprochement se fait sur le{" "}
            <strong>n° de commande TIO</strong> porté par les deux.
          </p>
        </CardContent>
      </Card>

      {data.meta.fichesEnDouble > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>
              {data.meta.fichesEnDouble} boutique(s) semblent avoir DEUX fiches
            </strong>{" "}
            — une vue par TIO, l&apos;autre par Texas
            {data.meta.fichesEnDoubleExactes > 0 &&
              `, dont ${data.meta.fichesEnDoubleExactes} au nom rigoureusement identique`}
            . Leurs volumes sont comptés séparément et paraissent donc manquants d&apos;un
            côté. Rien n&apos;est fusionné : les rapprochements sont signalés sous chaque
            nom, à vous de trancher.
          </span>
        </div>
      )}

      <Comparatif
        titre="Par catalogue"
        colonne="Catalogue"
        lignes={data.catalogues}
        note={
          <>
            <strong>« Sans catalogue » n&apos;est pas un catalogue</strong> : ce sont les
            commandes dont le champ est vide, et il recouvre deux choses différentes selon
            la source. Côté <strong>TIO</strong>, des commandes importées sans « Nom du
            catalogue de vente » — en pratique des mises à disposition de stock, sans
            chiffre d&apos;affaires. Côté <strong>Texas</strong>, des commandes dont la
            jumelle TIO est introuvable : surtout des <strong>réassorts</strong>, qui
            n&apos;ont pas de commande de collection en face. L&apos;écart de cette ligne
            ne compare donc pas la même chose des deux côtés.
          </>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <CardTitle className="text-base">Par boutique</CardTitle>
              <Badge variant="secondary">{boutiques.length}</Badge>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={seulementEcarts}
                  onChange={(e) => setSeulementEcarts(e.target.checked)}
                  className="h-4 w-4"
                />
                Seulement les écarts
              </label>
              <div className="relative">
                <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={recherche}
                  onChange={(e) => setRecherche(e.target.value)}
                  placeholder="Rechercher…"
                  className="h-9 w-56 pl-8"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <TableComparatif colonne="Boutique" lignes={boutiques} />
        </CardContent>
      </Card>
    </div>
  );
}

function CarteSource({ titre, cote, actif }: { titre: string; cote: Cote; actif: boolean }) {
  return (
    <Card className={cn(actif && "border-primary")}>
      <CardContent>
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{titre}</p>
          {actif && <Badge variant="secondary">source lue</Badge>}
        </div>
        <div className="mt-1 text-2xl font-bold">{formatNumber(cote.pieces)} pcs</div>
        <p className="text-sm text-muted-foreground">
          {formatEuro(cote.amount)} · {formatNumber(cote.orders)} commande(s) ·{" "}
          {formatNumber(cote.lines)} ligne(s)
        </p>
      </CardContent>
    </Card>
  );
}

function Comparatif({
  titre,
  colonne,
  lignes,
  note,
}: {
  titre: string;
  colonne: string;
  lignes: Ligne[];
  note?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <CardTitle className="text-base">{titre}</CardTitle>
          <Badge variant="secondary">{lignes.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <TableComparatif colonne={colonne} lignes={lignes} />
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  );
}

function TableComparatif({ colonne, lignes }: { colonne: string; lignes: Ligne[] }) {
  if (lignes.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Aucune ligne.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{colonne}</TableHead>
            <TableHead className="text-right">TIO pcs</TableHead>
            <TableHead className="text-right">Texas pcs</TableHead>
            <TableHead className="text-right">Écart</TableHead>
            <TableHead className="text-right">TIO €</TableHead>
            <TableHead className="text-right">Texas €</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lignes.map((l) => (
            <TableRow key={l.id}>
              <TableCell className="font-medium">
                <div className="flex flex-wrap items-center gap-2">
                  {l.label}
                  {l.presence === "tio" && (
                    <Badge variant="outline" className="text-amber-700">
                      absente de Texas
                    </Badge>
                  )}
                  {l.presence === "texas" && (
                    <Badge variant="outline" className="text-amber-700">
                      absente de TIO
                    </Badge>
                  )}
                </div>
                {/* ⚠️ Indice de fiche en double, jamais une fusion : c'est l'humain qui
                    décide si ce sont bien les deux fiches d'une même boutique. */}
                {l.ressemble && (
                  <p className="mt-0.5 text-xs text-sky-700">
                    {l.ressembleExact ? "même nom que" : "ressemble à"} « {l.ressemble} »
                    dans l&apos;autre source
                    {l.ressembleExact && " — fiche en double probable"}
                  </p>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(l.tio.pieces)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(l.texas.pieces)}</TableCell>
              <TableCell
                className={cn(
                  "text-right tabular-nums font-medium",
                  l.ecartPieces === 0
                    ? "text-muted-foreground"
                    : l.ecartPieces < 0
                      ? "text-red-700"
                      : "text-emerald-700"
                )}
              >
                {l.ecartPieces > 0 ? "+" : ""}
                {formatNumber(l.ecartPieces)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {formatEuro(l.tio.amount)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {formatEuro(l.texas.amount)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

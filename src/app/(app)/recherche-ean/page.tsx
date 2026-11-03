"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Barcode, Search, Loader2, AlertTriangle, Copy, X, PackageSearch,
} from "lucide-react";
import { toast } from "sonner";
import { cn, formatEuro } from "@/lib/utils";
import { classifyQuery, formatEan } from "@/lib/ean-search";

// Recherche produit ↔ code-barres. Un seul champ : on y scanne un EAN, ou on y tape une
// référence, un nom, une couleur. L'écran est conçu pour le COMPTOIR et l'ENTREPÔT :
// le champ est focalisé au chargement, une douchette tape les chiffres puis Entrée.

interface Taille {
  size: string;
  ean: string;
  matched: boolean;
  stock: number;
}
interface Groupe {
  reference: string;
  color: string;
  colorCode: string | null;
  colorLabel: string | null;
  label: string | null;
  category: string | null;
  subCategory: string | null;
  salePrice: number | null;
  originCountry: string | null;
  tailles: Taille[];
}
interface Resultat {
  kind: "vide" | "ean" | "ean-partiel" | "texte";
  eanValide?: boolean;
  totalGroupes: number;
  tronque?: boolean;
  plafondAtteint?: boolean;
  eansTrouves: number;
  groupes: Groupe[];
}

export default function RechercheEanPage() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Resultat | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Évite qu'une réponse lente écrase le résultat d'une saisie plus récente.
  const dernier = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const chercher = useCallback(async (valeur: string) => {
    const parsed = classifyQuery(valeur);
    if (parsed.kind === "vide") {
      setRes(null);
      return;
    }
    const jeton = ++dernier.current;
    setLoading(true);
    try {
      const r = await fetch(`/api/recherche-ean?q=${encodeURIComponent(valeur)}`);
      const j = await r.json();
      if (jeton !== dernier.current) return;
      if (!r.ok) {
        toast.error(j.error || "Recherche impossible");
        return;
      }
      setRes(j.data);
    } catch {
      if (jeton === dernier.current) toast.error("Recherche impossible");
    } finally {
      if (jeton === dernier.current) setLoading(false);
    }
  }, []);

  // La douchette « tape » très vite puis envoie Entrée : 250 ms suffisent à ne pas
  // lancer une requête par chiffre, sans qu'on sente d'attente.
  useEffect(() => {
    const parsed = classifyQuery(q);
    if (parsed.kind === "vide") {
      setRes(null);
      return;
    }
    if (parsed.kind === "texte" && parsed.value.length < 2) return;
    const t = setTimeout(() => chercher(q), 250);
    return () => clearTimeout(t);
  }, [q, chercher]);

  const copier = async (ean: string) => {
    try {
      await navigator.clipboard.writeText(ean);
      toast.success(`${ean} copié`);
    } catch {
      toast.error("Copie impossible");
    }
  };

  const parsed = classifyQuery(q);
  const aucun = res && res.groupes.length === 0;

  return (
    <div className="flex flex-col h-full">
      <Topbar />
      <div className="flex-1 space-y-6 p-6 overflow-auto">
        <PageHeader
          title="Recherche EAN"
          description="Scanne un code-barres pour trouver le produit, ou tape une référence pour voir ses EAN taille par taille."
        />

        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="relative">
              <Barcode className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") chercher(q);
                  if (e.key === "Escape") setQ("");
                }}
                placeholder="Code-barres, référence, nom de produit ou couleur…"
                className="h-12 pl-11 pr-24 text-base"
                autoComplete="off"
                spellCheck={false}
              />
              <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                {q && (
                  <Button variant="ghost" size="sm" onClick={() => { setQ(""); inputRef.current?.focus(); }} className="h-8 gap-1">
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Search className="h-3.5 w-3.5" />
              {parsed.kind === "ean" && <span>Code-barres complet</span>}
              {parsed.kind === "ean-partiel" && <span>Fragment de code-barres — recherche sur les chiffres saisis</span>}
              {parsed.kind === "texte" && <span>Recherche sur la référence, la désignation et la couleur</span>}
              {parsed.kind === "vide" && <span>Le champ est prêt : scanne, ou tape une référence.</span>}
              {res && res.plafondAtteint && (
              <span className="text-amber-700">Trop large pour être utile — ajoute la référence.</span>
            )}
            {res && res.totalGroupes > 0 && (
                <Badge variant="secondary" className="font-normal">
                  {res.plafondAtteint ? "plus de " : ""}
                  {res.totalGroupes} coloris trouvé{res.totalGroupes > 1 ? "s" : ""}
                  {res.tronque && " — 60 affichés"}
                </Badge>
              )}
            </div>

            {/* 🔴 Une clé de contrôle fausse explique un « aucun résultat » bien mieux
                qu'un écran vide : le code a été recopié de travers. */}
            {parsed.kind === "ean" && parsed.eanValide === false && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <strong>Clé de contrôle invalide</strong> — ce code a 13 chiffres mais le dernier
                  ne correspond pas aux douze autres. Il a probablement été mal recopié. La
                  recherche est quand même lancée.
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {aucun && (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <PackageSearch className="h-8 w-8 text-muted-foreground" />
              <p className="font-medium">Aucun produit pour « {q} »</p>
              <p className="max-w-md text-sm text-muted-foreground">
                {parsed.kind === "ean" || parsed.kind === "ean-partiel"
                  ? "Ce code-barres n'est pas dans le référentiel. Il peut venir d'une autre marque, ou l'EAN n'a jamais été importé pour ce produit."
                  : "Essaie la référence seule (SMCHML_C025), un mot de la désignation, ou le code couleur."}
              </p>
            </CardContent>
          </Card>
        )}

        {res?.groupes.map((g) => (
          <Card key={`${g.reference}__${g.color}`} className={cn(g.tailles.some((t) => t.matched) && "border-emerald-300")}>
            <CardContent className="space-y-4 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{g.reference}</span>
                    <Badge variant="secondary" className="font-normal">
                      {g.colorLabel || g.color}
                      {g.colorCode && g.colorLabel ? ` · ${g.colorCode}` : ""}
                    </Badge>
                    {g.category && <Badge variant="outline" className="font-normal">{g.category}</Badge>}
                  </div>
                  <p className="mt-1 text-sm">{g.label || <span className="text-muted-foreground">Sans désignation</span>}</p>
                </div>
                <div className="text-right text-sm">
                  {g.salePrice != null && g.salePrice > 0 ? (
                    <p className="font-semibold">{formatEuro(g.salePrice)}</p>
                  ) : (
                    <p className="text-amber-700">Pas de prix de vente</p>
                  )}
                  {g.originCountry && g.originCountry !== "000" && (
                    <p className="text-xs text-muted-foreground">Origine {g.originCountry}</p>
                  )}
                </div>
              </div>

              {g.tailles.length === 0 ? (
                <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <strong>Aucun code-barres</strong> pour ce coloris. Il n&apos;a jamais été importé —
                    à charger dans <em>Infos produits → EAN</em>.
                  </span>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">Taille</TableHead>
                      <TableHead>EAN</TableHead>
                      <TableHead className="w-24 text-right">Stock</TableHead>
                      <TableHead className="w-16" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.tailles.map((t) => (
                      <TableRow key={t.ean} className={cn(t.matched && "bg-emerald-50")}>
                        <TableCell className="font-medium">{t.size}</TableCell>
                        <TableCell className="font-mono text-sm">
                          {formatEan(t.ean)}
                          {t.matched && (
                            <Badge className="ml-2 bg-emerald-100 font-normal text-emerald-800">scanné</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{t.stock}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => copier(t.ean)} className="h-8 w-8 p-0">
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

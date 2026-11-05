"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Barcode, Download, Info, Loader2, Search, TriangleAlert } from "lucide-react";
import { cn, formatNumber, formatEuro } from "@/lib/utils";
import { fileStamp } from "@/lib/file-stamp";
import { COLONNES } from "@/lib/export-commandes-produits";

// Commandes clients × produits × EAN, GÉNÉRÉ par GestLog depuis la base — rien à déposer.
// Le classeur est construit côté serveur : une saison fait 35 000 à 40 000 lignes, les
// faire transiter en JSON pour que le navigateur fabrique le fichier n'aurait pas de sens.

interface Catalog {
  id: string;
  name: string;
  orderCount: number;
}
interface Boutique {
  id: string;
  code: string;
  name: string;
}
interface AutreSaison {
  saison: string;
  source: string;
  memeSaison: boolean;
  commandes: number;
}
interface Commande {
  orderNumber: string;
  clientName: string | null;
  clientCode: string | null;
  orderDate: string | null;
  lignes: number;
  pieces: number;
}
interface Compte {
  lignes: number;
  pieces: number;
  commandes: number;
  references: number;
  source: string;
  seasonName: string;
  plafond: number;
  prixCommandeExploitable: boolean;
  raisonPrix: string | null;
  numerosInconnus: string[];
  numerosAilleurs: { numero: string; saison: string; source: string }[];
}

export function CommandesProduitsCard({
  seasonId,
  seasonName,
}: {
  seasonId: string;
  seasonName: string;
}) {
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [boutiques, setBoutiques] = useState<Boutique[]>([]);
  const [catalogId, setCatalogId] = useState("");
  const [sku, setSku] = useState("");
  const [clientMode, setClientMode] = useState<"include" | "exclude">("include");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [recherche, setRecherche] = useState("");
  const [commandes, setCommandes] = useState<Commande[]>([]);
  const [cmdCochees, setCmdCochees] = useState<Set<string>>(new Set());
  const [cmdSaisies, setCmdSaisies] = useState("");
  const [cmdRecherche, setCmdRecherche] = useState("");
  const [cmdChargement, setCmdChargement] = useState(false);
  const [autres, setAutres] = useState<AutreSaison[]>([]);
  const [wholesale, setWholesale] = useState<"commande" | "catalogue">("commande");
  const [compte, setCompte] = useState<Compte | null>(null);
  const [comptage, setComptage] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!seasonId) return;
    setCatalogId("");
    fetch(`/api/catalogs?seasonId=${seasonId}`)
      .then((r) => r.json())
      .then((d) => setCatalogs(d.data || []))
      .catch(() => setCatalogs([]));
  }, [seasonId]);

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((d) => setBoutiques(d.data || []))
      .catch(() => setBoutiques([]));
  }, []);

  // Numéros cochés dans la liste ET numéros tapés à la main : les deux comptent, en
  // union. Cocher une commande puis en taper une autre prend les deux.
  const numeros = useMemo(() => {
    const tapes = cmdSaisies.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    return [...new Set([...cmdCochees, ...tapes])];
  }, [cmdCochees, cmdSaisies]);

  // Périmètre BOUTIQUE : ce qui restreint la liste des commandes. Les numéros n'en font
  // pas partie — sinon cocher la première commande ferait disparaître les autres.
  const filtresBoutique = useCallback(() => {
    const q = new URLSearchParams({ seasonId });
    if (catalogId) q.set("catalogId", catalogId);
    if (selected.size > 0) {
      q.set("clients", [...selected].join(","));
      q.set("clientMode", clientMode);
    }
    return q;
  }, [seasonId, catalogId, selected, clientMode]);

  // Filtres complets, SANS le prix : changer l'origine du prix ne change pas le nombre de
  // lignes, et relancerait un comptage pour rien.
  const filtres = useCallback(() => {
    const q = filtresBoutique();
    if (sku.trim()) q.set("sku", sku.trim());
    if (numeros.length > 0) q.set("orders", numeros.join(","));
    return q;
  }, [filtresBoutique, sku, numeros]);

  // Liste des commandes du périmètre boutique, pour le sélecteur.
  useEffect(() => {
    if (!seasonId) {
      setCommandes([]);
      return;
    }
    let annule = false;
    setCmdChargement(true);
    const q = filtresBoutique();
    q.set("list", "orders");
    fetch(`/api/export/commandes-produits?${q.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (annule) return;
        const liste: Commande[] = d.data?.orders || [];
        setCommandes(liste);
        setAutres(d.data?.autres || []);
        // Une commande cochée qui sort du périmètre (changement de boutique) est
        // décochée : la garder filtrerait sur une commande absente de la liste.
        const connus = new Set(liste.map((o) => o.orderNumber));
        setCmdCochees((prev) => {
          const n = new Set([...prev].filter((x) => connus.has(x)));
          return n.size === prev.size ? prev : n;
        });
      })
      .catch(() => {
        if (!annule) {
          setCommandes([]);
          setAutres([]);
        }
      })
      .finally(() => {
        if (!annule) setCmdChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [seasonId, filtresBoutique]);

  // Comptage avant téléchargement : on annonce le volume plutôt que de lancer un fichier
  // de 40 000 lignes à l'aveugle.
  useEffect(() => {
    if (!seasonId) {
      setCompte(null);
      return;
    }
    let annule = false;
    setComptage(true);
    const q = filtres();
    q.set("count", "1");
    const t = setTimeout(() => {
      fetch(`/api/export/commandes-produits?${q.toString()}`)
        .then((r) => r.json())
        .then((d) => {
          if (!annule) setCompte(d.data || null);
        })
        .catch(() => {
          if (!annule) setCompte(null);
        })
        .finally(() => {
          if (!annule) setComptage(false);
        });
    }, 300);
    return () => {
      annule = true;
      clearTimeout(t);
    };
  }, [seasonId, filtres]);

  // Le prix de la commande est refusé sur TEXAS : on bascule l'écran pour que le bouton
  // affiché corresponde à ce que le fichier contiendra.
  const prixCommandeKo = compte ? !compte.prixCommandeExploitable : false;
  useEffect(() => {
    if (prixCommandeKo && wholesale === "commande") setWholesale("catalogue");
  }, [prixCommandeKo, wholesale]);

  const filtrees = boutiques.filter((b) => {
    const q = recherche.trim().toLowerCase();
    return !q || b.name.toLowerCase().includes(q) || b.code.toLowerCase().includes(q);
  });
  const commandesFiltrees = commandes.filter((o) => {
    const q = cmdRecherche.trim().toLowerCase();
    return (
      !q ||
      o.orderNumber.toLowerCase().includes(q) ||
      (o.clientName || "").toLowerCase().includes(q) ||
      (o.clientCode || "").toLowerCase().includes(q)
    );
  });
  const basculerCmd = (num: string) =>
    setCmdCochees((prev) => {
      const n = new Set(prev);
      if (n.has(num)) n.delete(num);
      else n.add(num);
      return n;
    });
  const basculer = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const exporter = async () => {
    if (!seasonId) return;
    setBusy(true);
    try {
      const q = filtres();
      q.set("wholesale", wholesale);
      const res = await fetch(`/api/export/commandes-produits?${q.toString()}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error || "Export impossible");
        return;
      }
      const h = (k: string) => Number(res.headers.get(k) || 0);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `commandes-produits-ean_${seasonName || seasonId}_${fileStamp()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(
        `${formatNumber(h("X-Rows"))} ligne(s) · ${formatNumber(h("X-Pieces"))} pièces · ${formatEuro(h("X-Total-Wholesale"))}`,
        {
          description: `${h("X-Orders")} commande(s) · ${h("X-Refs")} référence(s) · ${h("X-Shops")} boutique(s) · source ${res.headers.get("X-Source")}`,
        }
      );
      if (res.headers.get("X-Wholesale-Forced") === "1")
        toast.warning("Prix wholesale : tarif catalogue", {
          description: "Le prix de la commande n'est pas exploitable sur cette source (TEXAS).",
          duration: 9000,
        });
      if (h("X-No-Ean") > 0)
        toast.warning(`${formatNumber(h("X-No-Ean"))} ligne(s) sans EAN — cellule vide, ligne conservée.`);
      if (h("X-No-Retail") > 0)
        toast.warning(
          `${formatNumber(h("X-No-Retail"))} ligne(s) sans prix de vente conseillé (${h("X-No-Retail-Refs")} référence(s)).`,
          { duration: 9000 }
        );
      if (h("X-No-Wholesale") > 0)
        toast.warning(
          `${formatNumber(h("X-No-Wholesale"))} ligne(s) sans prix wholesale : le total est sous-estimé.`
        );
      if (h("X-Unknown-Orders") > 0)
        toast.warning(
          `${h("X-Unknown-Orders")} numéro(s) de commande sans correspondance — aucune ligne ajoutée pour eux.`,
          { duration: 9000 }
        );
      if (res.headers.get("X-Capped") === "1")
        toast.warning("Fichier tronqué au plafond — filtre par catalogue ou par boutique.", {
          duration: 10000,
        });
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setBusy(false);
    }
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
              Généré par GestLog depuis la base — <strong>rien à déposer</strong>. Un classeur
              de <strong>{COLONNES.length} colonnes</strong>, une ligne par commande × produit
              × coloris × <strong>taille</strong>, avec son code-barres.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* La saison est choisie EN HAUT de la page : à 2 000 px de cette carte, on ne la
            voit plus. L'export étant par saison, elle est rappelée ici. */}
        <div className="rounded-lg border-2 border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          Saison exportée : <strong>{seasonName || "—"}</strong>
          {compte?.source ? (
            <span className="text-muted-foreground"> · source {compte.source}</span>
          ) : null}
          <span className="text-muted-foreground">
            {" "}
            — elle se change tout en haut de la page.
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="cp-catalogue" className="text-xs font-medium text-muted-foreground">
              Catalogue
            </label>
            <select
              id="cp-catalogue"
              value={catalogId}
              onChange={(e) => setCatalogId(e.target.value)}
              className="w-full rounded-lg border-2 border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="">Tous les catalogues</option>
              {catalogs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.orderCount})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="cp-sku" className="text-xs font-medium text-muted-foreground">
              Références (séparées par des virgules)
            </label>
            <Input
              id="cp-sku"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="SMPTCH_C001, CCPE27…"
            />
          </div>
        </div>

        {/* Boutiques : inclure ou exclure une sélection. */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Boutiques</p>
            <div className="inline-flex rounded-md border p-0.5">
              {(
                [
                  { v: "include", label: "Seulement celles-ci" },
                  { v: "exclude", label: "Toutes sauf celles-ci" },
                ] as const
              ).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setClientMode(o.v)}
                  className={cn(
                    "rounded px-2.5 py-1 text-xs transition-colors",
                    clientMode === o.v
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent"
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-md border">
            <div className="flex items-center gap-2 border-b p-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={recherche}
                  onChange={(e) => setRecherche(e.target.value)}
                  placeholder="Rechercher une boutique…"
                  className="w-full rounded border-0 bg-transparent pl-7 text-sm outline-none"
                />
              </div>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:underline"
                onClick={() => setSelected(new Set())}
              >
                Aucune
              </button>
            </div>
            <div className="max-h-40 overflow-y-auto p-1">
              {filtrees.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">Aucun résultat.</p>
              ) : (
                filtrees.slice(0, 200).map((b) => (
                  <label
                    key={b.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(b.id)}
                      onChange={() => basculer(b.id)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {b.name} <span className="text-xs text-muted-foreground">· {b.code}</span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {selected.size === 0
              ? "Aucune sélection = toutes les boutiques."
              : `${selected.size} boutique(s) ${clientMode === "exclude" ? "exclue(s)" : "incluse(s)"}.`}
          </p>
        </div>

        {/* Commandes : on coche dans la liste (restreinte par la boutique) OU on tape un
            numéro. Les deux se cumulent. */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              Commandes{" "}
              {cmdChargement ? (
                <span className="opacity-60">(chargement…)</span>
              ) : (
                <span className="opacity-60">({formatNumber(commandes.length)} dans le périmètre)</span>
              )}
            </p>
            {cmdCochees.size > 0 && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:underline"
                onClick={() => setCmdCochees(new Set())}
              >
                Tout décocher
              </button>
            )}
          </div>
          <div className="rounded-md border">
            <div className="flex items-center gap-2 border-b p-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={cmdRecherche}
                  onChange={(e) => setCmdRecherche(e.target.value)}
                  placeholder="Rechercher un numéro ou une boutique…"
                  className="w-full rounded border-0 bg-transparent pl-7 text-sm outline-none"
                />
              </div>
            </div>
            <div className="max-h-40 overflow-y-auto p-1">
              {commandesFiltrees.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  {commandes.length === 0
                    ? "Aucune commande dans ce périmètre."
                    : "Aucun résultat."}
                </p>
              ) : (
                commandesFiltrees.slice(0, 300).map((o) => (
                  <label
                    key={o.orderNumber}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={cmdCochees.has(o.orderNumber)}
                      onChange={() => basculerCmd(o.orderNumber)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-mono text-xs">{o.orderNumber}</span>{" "}
                      <span className="text-xs text-muted-foreground">
                        · {o.clientName || o.clientCode || "—"} · {formatNumber(o.pieces)} pcs
                        {o.orderDate ? ` · ${o.orderDate}` : ""}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="mt-2 space-y-1.5">
            <label htmlFor="cp-numeros" className="text-xs font-medium text-muted-foreground">
              …ou tape directement un ou plusieurs numéros
            </label>
            <Input
              id="cp-numeros"
              value={cmdSaisies}
              onChange={(e) => setCmdSaisies(e.target.value)}
              placeholder="IS-455405299095, PO-754287027085…"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Le préfixe est facultatif : <span className="font-mono">754287027085</span> retrouve{" "}
              <span className="font-mono">PO-754287027085</span>. Plusieurs numéros se séparent
              par une virgule ou un espace.
            </p>
          </div>

          <p className="mt-1 text-xs text-muted-foreground">
            {numeros.length === 0
              ? "Aucune commande choisie = toutes celles du périmètre."
              : `${numeros.length} commande(s) demandée(s)${cmdCochees.size > 0 && cmdSaisies.trim() ? " (cochées + saisies)" : ""}.`}
          </p>
        </div>

        {autres.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Cette sélection de boutiques a{" "}
              <strong>
                {formatNumber(autres.reduce((n, a) => n + a.commandes, 0))} autre(s) commande(s)
              </strong>{" "}
              hors de ce que l&apos;export contiendra :{" "}
              {autres
                .map((a) =>
                  a.memeSaison
                    ? `${a.commandes} en ${a.saison} côté ${a.source} (source écartée)`
                    : `${a.commandes} en ${a.saison}`
                )
                .join(", ")}
              .{" "}
              {autres.some((a) => a.memeSaison) ? (
                <>
                  Une saison qui porte des commandes <strong>TEXAS</strong> et{" "}
                  <strong>TIO</strong> ne sort qu&apos;en TEXAS — les mêmes commandes y
                  figurent deux fois.{" "}
                </>
              ) : null}
              Pour les autres saisons, change la saison en haut de la page.
            </span>
          </div>
        )}

        {compte && compte.numerosInconnus?.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>
                {compte.numerosInconnus.length} numéro(s) sans correspondance
              </strong>{" "}
              : <span className="font-mono">{compte.numerosInconnus.join(", ")}</span>. Vérifie la
              saisie, la saison et la boutique — ces numéros n&apos;ajoutent aucune ligne.
            </span>
          </div>
        )}

        {/* Le prix wholesale n'a pas une seule définition — et sur TEXAS il n'en a qu'une. */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Prix wholesale</p>
          <div className="inline-flex rounded-md border p-0.5">
            {(
              [
                { v: "commande", label: "Prix de la commande" },
                { v: "catalogue", label: "Tarif de gros du catalogue" },
              ] as const
            ).map((o) => (
              <button
                key={o.v}
                type="button"
                disabled={o.v === "commande" && prixCommandeKo}
                onClick={() => setWholesale(o.v)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs transition-colors",
                  wholesale === o.v
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent",
                  o.v === "commande" && prixCommandeKo && "cursor-not-allowed opacity-40 hover:bg-transparent"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {wholesale === "commande" ? (
              <>
                Prix unitaire net de la ligne, <strong>reconstruit</strong> depuis le CA de la
                commande (<code>amount / totalQuantity</code>). Il suit le tarif catalogue et
                descend quand la commande porte une remise.
              </>
            ) : (
              <>
                <strong>Tarif de gros du catalogue</strong> (<code>Product.costPrice</code>),
                identique pour toutes les commandes — <strong>hors</strong> remise.
              </>
            )}
          </p>
        </div>

        {compte && prixCommandeKo && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>Prix de la commande indisponible sur {compte.seasonName}</strong> (source{" "}
              {compte.source}). {compte.raisonPrix}
            </span>
          </div>
        )}

        {/* Volume annoncé avant le clic. */}
        <div className="grid gap-3 sm:grid-cols-4">
          <Chiffre valeur={compte?.lignes ?? 0} legende="lignes à produire" occupe={comptage} />
          <Chiffre valeur={compte?.pieces ?? 0} legende="pièces commandées" occupe={comptage} />
          <Chiffre valeur={compte?.commandes ?? 0} legende="commandes" occupe={comptage} />
          <Chiffre valeur={compte?.references ?? 0} legende="références" occupe={comptage} />
        </div>

        <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          Colonnes : {COLONNES.join(" · ")}. Quantités <strong>commandées</strong> — les pièces
          soldées ne sont pas déduites, et les commandes VSS sont hors périmètre. Source lue :{" "}
          <strong>{compte?.source ?? "—"}</strong> ; sur une saison qui porte des commandes
          TEXAS <em>et</em> TIO, seules les TEXAS sortent, pour ne pas compter deux fois.
        </div>

        {compte && compte.lignes > compte.plafond && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>{formatNumber(compte.lignes)} lignes</strong> dépassent le plafond de{" "}
              {formatNumber(compte.plafond)} : le fichier sera <strong>tronqué</strong>. Filtre
              par catalogue, par boutique ou par référence.
            </span>
          </div>
        )}

        <Button
          onClick={exporter}
          disabled={!seasonId || busy || (compte?.lignes ?? 0) === 0}
          className="gap-2"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Générer le fichier Excel
        </Button>
        {compte?.lignes === 0 && !comptage && (
          <p className="text-xs text-muted-foreground">
            Aucune ligne pour cette sélection — élargis les filtres.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Chiffre({
  valeur,
  legende,
  occupe,
}: {
  valeur: number;
  legende: string;
  occupe: boolean;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className={cn("text-xl font-bold tabular-nums", occupe && "opacity-40")}>
        {formatNumber(valeur)}
      </div>
      <p className="text-xs text-muted-foreground">{legende}</p>
    </div>
  );
}

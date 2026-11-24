"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { AlertTriangle, CheckCircle2, Download, Loader2, RefreshCw, Search, ShoppingBag, Undo2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/utils";
import { fileStamp } from "@/lib/file-stamp";
import { marketplaceLabel } from "@/lib/marketplace";
import { ANOMALY_KINDS, KIND_LABELS, USUAL_GAP_PER_ITEM, type Kind, type ReconRow } from "@/lib/marketplace-reconcile";

interface Data {
  from: string;
  to: string;
  lastWooSync: string | null;
  lastSfSync: string | null;
  wooFirstOrder: string | null;
  counts: Partial<Record<Kind, number>>;
  anomalies: number;
  sfOrders: number;
  sfAmount: number;
  wooAmount: number;
  rows: ReconRow[];
}

const PAGE = 100;
const fr = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const frTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" }) : "jamais";
const euros = (n: number | null) =>
  n === null ? "—" : `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const SF_STATUS: Record<string, string> = {
  created: "créée",
  waiting_store_acceptance: "à accepter",
  refused: "refusée",
  waiting_shipment: "à expédier",
  shipped: "expédiée",
  cancelled: "annulée",
  refunded: "remboursée",
  partially_refunded: "remb. partiel",
  partially_shipped: "expédiée en partie",
};
const WOO_STATUS: Record<string, string> = {
  pending: "en attente",
  processing: "en cours",
  "on-hold": "en attente",
  completed: "terminée",
  cancelled: "annulée",
  refunded: "remboursée",
  failed: "échouée",
  lpc_transit: "en transit",
  lpc_delivered: "livrée",
  lpc_ready_to_ship: "prête",
};

const KIND_STYLE: Record<Kind, string> = {
  ok: "text-muted-foreground",
  ecart: "text-amber-600 dark:text-amber-400",
  absente_woo: "text-red-600 dark:text-red-400",
  absente_sf: "text-red-600 dark:text-red-400",
  en_attente: "text-muted-foreground",
  annulee: "text-muted-foreground",
  traitee: "text-emerald-600 dark:text-emerald-400",
};

type Filter = "anomalies" | "all" | Kind;

export function MarketplaceControl() {
  const [data, setData] = useState<Data | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filter, setFilter] = useState<Filter>("anomalies");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [tick, setTick] = useState(0); // force le rechargement (actualisation, commande traitée)
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // n° marketplace en cours de marquage
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const queryKey = (() => {
    const p = new URLSearchParams();
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    return p.toString();
  })();
  const loadKey = `${queryKey}#${tick}`;
  const loading = loadedKey !== loadKey;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/btoc/marketplaces?${queryKey}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d: Data) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => console.error("Erreur chargement contrôle marketplaces:", e))
      .finally(() => {
        if (!cancelled) setLoadedKey(loadKey);
      });
    return () => {
      cancelled = true;
    };
  }, [queryKey, loadKey]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/btoc/marketplaces/refresh", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      const failed = [!d.woo && "WooCommerce", !d.shoppingFeed && "Shopping Feed"].filter(Boolean);
      setMessage(
        failed.length
          ? { text: `Actualisation incomplète : ${failed.join(" et ")} n'a pas répondu. Réessayez dans quelques minutes.`, error: true }
          : { text: "Commandes WooCommerce (3 derniers jours) et Shopping Feed relues." }
      );
    } catch (e) {
      setMessage({ text: `Actualisation impossible : ${(e as Error).message}`, error: true });
    } finally {
      setRefreshing(false);
      setTick((t) => t + 1);
    }
  };

  const saveResolution = async (reference: string) => {
    setSaving(true);
    try {
      const res = await fetch("/api/btoc/marketplaces/resolutions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reference, note }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setEditing(null);
      setNote("");
      setTick((t) => t + 1);
    } catch (e) {
      setMessage({ text: `Enregistrement impossible : ${(e as Error).message}`, error: true });
    } finally {
      setSaving(false);
    }
  };

  const undoResolution = async (reference: string) => {
    if (!confirm(`Remettre la commande ${reference} dans les anomalies ?`)) return;
    const res = await fetch(`/api/btoc/marketplaces/resolutions?reference=${encodeURIComponent(reference)}`, { method: "DELETE" });
    if (!res.ok) setMessage({ text: "Annulation impossible.", error: true });
    setTick((t) => t + 1);
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.rows ?? []).filter(
      (r) =>
        (filter === "all" || (filter === "anomalies" ? ANOMALY_KINDS.includes(r.kind) : r.kind === filter)) &&
        (!q || [r.reference, r.wooNumber, r.wooId].some((v) => String(v ?? "").toLowerCase().includes(q)))
    );
  }, [data, filter, search]);

  const handleExport = () => {
    if (!data) return;
    const sheet = XLSX.utils.json_to_sheet(
      rows.map((r) => ({
        Date: fr(r.day),
        Marketplace: marketplaceLabel(r.channel),
        "N° marketplace": r.reference ?? "",
        "N° commande Woo": r.wooNumber ?? "",
        "Id Woo": r.wooId ?? "",
        Résultat: KIND_LABELS[r.kind],
        Détail: r.issues.join(" ; "),
        "Statut marketplace": r.sfStatus ? (SF_STATUS[r.sfStatus] ?? r.sfStatus) : "",
        "Statut Woo": r.wooStatus ? (WOO_STATUS[r.wooStatus] ?? r.wooStatus) : "",
        "Montant marketplace": r.sfTotal ?? "",
        "Montant Woo": r.wooTotal ?? "",
        "Remboursé Woo": r.wooRefunded ?? "",
        "Articles marketplace": r.sfQty ?? "",
        "Articles Woo": r.wooQty ?? "",
        "Traitée : note": r.resolution?.note ?? "",
        "Traitée par": r.resolution?.by ?? "",
        "Traitée le": r.resolution ? frTime(r.resolution.at) : "",
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Contrôle");
    XLSX.writeFile(wb, `Contrôle marketplaces ${data.from} au ${data.to} ${fileStamp()}.xlsx`);
  };

  const c = data?.counts ?? {};
  const chips: { key: Filter; label: string; n: number }[] = [
    { key: "anomalies", label: "Anomalies", n: data?.anomalies ?? 0 },
    { key: "absente_woo", label: KIND_LABELS.absente_woo, n: c.absente_woo ?? 0 },
    { key: "ecart", label: "Écarts", n: c.ecart ?? 0 },
    { key: "absente_sf", label: KIND_LABELS.absente_sf, n: c.absente_sf ?? 0 },
    { key: "traitee", label: "Traitées à la main", n: c.traitee ?? 0 },
    { key: "ok", label: "Cohérentes", n: c.ok ?? 0 },
    { key: "en_attente", label: "En attente", n: c.en_attente ?? 0 },
    { key: "annulee", label: "Annulées avant import", n: c.annulee ?? 0 },
    { key: "all", label: "Toutes", n: data?.rows.length ?? 0 },
  ];

  return (
    <div className="space-y-6">
      <Card className="overflow-visible">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">Commandé du</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40 h-9" />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">au</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40 h-9" />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">N° de commande</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setShown(PAGE);
                  }}
                  placeholder="LRFR…, 87897…"
                  className="w-56 h-9 pl-8"
                />
              </div>
            </div>
            <Button onClick={handleExport} disabled={loading || !rows.length}>
              <Download className="h-4 w-4 mr-2" />
              Export Excel
            </Button>
            <Button variant="outline" onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              {refreshing ? "Actualisation… (1 à 2 min)" : "Actualiser maintenant"}
            </Button>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          {message && (
            <p className={`text-sm mt-3 ${message.error ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
              {message.text}
            </p>
          )}
          <div className="flex flex-wrap gap-2 mt-3">
            {chips.map((ch) => (
              <Button
                key={ch.key}
                variant={filter === ch.key ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setFilter(ch.key);
                  setShown(PAGE);
                }}
              >
                {ch.label} ({formatNumber(ch.n)})
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShoppingBag className="h-4 w-4" />
            Synthèse {data ? `du ${fr(data.from)} au ${fr(data.to)}` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <Tile label="Commandes marketplace" value={formatNumber(data?.sfOrders ?? 0)} />
            <Tile label="Cohérentes" value={formatNumber(c.ok ?? 0)} />
            <Tile label="Anomalies" value={formatNumber(data?.anomalies ?? 0)} alert={!!data?.anomalies} />
            <Tile label="Montant marketplace" value={euros(data?.sfAmount ?? 0)} />
            <Tile label="Montant Woo" value={euros(data?.wooAmount ?? 0)} />
          </div>
          <p className="text-sm text-muted-foreground">
            Commandes lues dans Shopping Feed (dernière lecture : {frTime(data?.lastSfSync ?? null)}) et rapprochées des
            commandes WooCommerce (dernière synchro : {frTime(data?.lastWooSync ?? null)}) par le n° de commande La Redoute,
            à défaut par le n° de commande Woo. « Actualiser maintenant » relit tout de suite les deux côtés, sans attendre la
            nuit. Une anomalie réglée à la main (ex. commande recréée dans Woo) peut être marquée « traitée » avec une note. La Redoute vend chaque article un peu plus cher que le site (jusqu&apos;à{" "}
            {USUAL_GAP_PER_ITEM.toLocaleString("fr-FR")} € par article) : cet écart habituel n&apos;est pas compté comme anomalie.
            {data?.wooFirstOrder
              ? ` Les commandes d'avant le ${frTime(data.wooFirstOrder).split(" ")[0]} (début de l'historique Woo dans GestLog) ne sont pas contrôlées.`
              : ""}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 overflow-x-auto">
          {!rows.length ? (
            <p className="text-sm text-muted-foreground">{loading ? "Chargement…" : "Aucune commande dans ce filtre."}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">N° marketplace</th>
                  <th className="py-2 pr-3">Commande Woo</th>
                  <th className="py-2 pr-3">Résultat</th>
                  <th className="py-2 pr-3">Statuts (marketplace / Woo)</th>
                  <th className="py-2 pr-3 text-right">Montants</th>
                  <th className="py-2 text-right">Articles</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map((r, i) => (
                  <tr key={`${r.reference}-${r.wooId}-${i}`} className="border-b last:border-0 align-top">
                    <td className="py-2 pr-3 whitespace-nowrap">{fr(r.day)}</td>
                    <td className="py-2 pr-3">
                      <div className="font-mono text-xs">{r.reference ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{marketplaceLabel(r.channel)}</div>
                    </td>
                    <td className="py-2 pr-3">{r.wooNumber ?? "—"}</td>
                    <td className={`py-2 pr-3 ${KIND_STYLE[r.kind]}`}>
                      <div className="flex items-center gap-1 font-medium">
                        {ANOMALY_KINDS.includes(r.kind) && <AlertTriangle className="h-3.5 w-3.5" />}
                        {KIND_LABELS[r.kind]}
                      </div>
                      {r.issues.length > 0 && <div className="text-xs">{r.issues.join(" ; ")}</div>}
                      {r.resolution && (
                        <div className="text-xs text-foreground mt-1">
                          <CheckCircle2 className="inline h-3 w-3 mr-1 text-emerald-600" />
                          {r.resolution.note}
                          <span className="text-muted-foreground">
                            {" "}
                            — {r.resolution.by}, {frTime(r.resolution.at)}
                          </span>
                          <button
                            type="button"
                            className="ml-2 inline-flex items-center gap-0.5 text-muted-foreground underline hover:text-foreground"
                            onClick={() => r.reference && undoResolution(r.reference)}
                          >
                            <Undo2 className="h-3 w-3" />
                            annuler
                          </button>
                        </div>
                      )}
                      {ANOMALY_KINDS.includes(r.kind) && r.reference && editing !== r.reference && (
                        <button
                          type="button"
                          className="mt-1 text-xs text-muted-foreground underline hover:text-foreground"
                          onClick={() => {
                            setEditing(r.reference);
                            setNote("");
                          }}
                        >
                          Marquer comme traitée
                        </button>
                      )}
                      {editing === r.reference && r.reference && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Input
                            autoFocus
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && note.trim()) saveResolution(r.reference as string);
                              if (e.key === "Escape") setEditing(null);
                            }}
                            placeholder="Ex. recréée à la main, commande Woo 87123"
                            className="h-8 w-72 text-xs"
                            maxLength={500}
                          />
                          <Button size="sm" disabled={!note.trim() || saving} onClick={() => saveResolution(r.reference as string)}>
                            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Valider"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                            Annuler
                          </Button>
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {r.sfStatus ? <Badge variant="secondary">{SF_STATUS[r.sfStatus] ?? r.sfStatus}</Badge> : "—"}
                      {" / "}
                      {r.wooStatus ? <Badge variant="outline">{WOO_STATUS[r.wooStatus] ?? r.wooStatus}</Badge> : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                      {euros(r.sfTotal)} / {euros(r.wooTotal)}
                      {r.wooRefunded ? <div className="text-xs text-muted-foreground">remb. Woo {euros(r.wooRefunded)}</div> : null}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {r.sfQty ?? "—"} / {r.wooQty ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {rows.length > shown && (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setShown((n) => n + PAGE)}>
              Afficher {Math.min(PAGE, rows.length - shown)} de plus ({formatNumber(rows.length - shown)} restantes)
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${alert ? "text-red-600 dark:text-red-400" : ""}`}>{value}</div>
    </div>
  );
}

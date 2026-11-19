"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, Download, Loader2, Mail, Search, X } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import * as XLSX from "xlsx";
import { formatNumber } from "@/lib/utils";
import { fileStamp } from "@/lib/file-stamp";
import { newsletterSheetRow, type NewsletterListItem } from "@/lib/btoc-newsletter";

interface NewsletterData {
  items: NewsletterListItem[];
  total: number;
  page: number;
  limit: number;
  summary: {
    subscribed: number;
    unsubscribed: number;
    subscribedNoOrder: number;
    byList: { id: number; label: string; count: number }[];
    monthly: { month: string; subscribed: number; unsubscribed: number }[];
  };
  lists: { id: number; label: string }[];
  lastSync: { syncedAt: string; itemCount: number; errorCount: number } | null;
}

const STATUS_LABELS: Record<string, string> = { subscribed: "Inscrits", unsubscribed: "Désinscrits", all: "Tous" };
const ORDERED_LABELS: Record<string, string> = { all: "Tous", no: "Sans commande", yes: "Ont commandé" };

const fr = (ymd: string | null) => (ymd ? ymd.split("-").reverse().join("/") : "—");
const euro = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
const monthLabel = (m: string) => {
  const [y, mo] = m.split("-");
  return `${["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"][Number(mo) - 1]} ${y.slice(2)}`;
};

export function BtocNewsletterTab() {
  const [data, setData] = useState<NewsletterData | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState("subscribed");
  const [ordered, setOrdered] = useState("all");
  const [list, setList] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const filterParams = useCallback(() => {
    const params = new URLSearchParams({ status, ordered });
    if (list !== "all") params.set("list", list);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (q) params.set("q", q);
    return params;
  }, [status, ordered, list, dateFrom, dateTo, q]);

  // Clé de la requête courante : « en chargement » tant que la réponse reçue
  // ne correspond pas à cette clé (pas de setState synchrone dans l'effet).
  const queryKey = (() => {
    const params = filterParams();
    params.set("page", String(page));
    params.set("limit", "50");
    return params.toString();
  })();
  const loading = loadedKey !== queryKey;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/btoc/newsletter?${queryKey}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d: NewsletterData) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => console.error("Erreur chargement newsletter:", e))
      .finally(() => {
        if (!cancelled) setLoadedKey(queryKey);
      });
    return () => {
      cancelled = true;
    };
  }, [queryKey]);

  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = filterParams();
      params.set("export", "1");
      const res = await fetch(`/api/btoc/newsletter?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d: { items: NewsletterListItem[] } = await res.json();
      if (d.items.length === 0) {
        alert("Aucune donnée à exporter.");
        return;
      }
      const rows = d.items.map(newsletterSheetRow);
      const ws = XLSX.utils.json_to_sheet(rows);
      ws["!cols"] = Object.keys(rows[0]).map((k) => ({
        wch: Math.min(40, Math.max(k.length + 2, ...rows.slice(0, 2000).map((r) => String(r[k as keyof typeof r] ?? "").length))),
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Newsletter");
      XLSX.writeFile(wb, `newsletter-btoc-${fileStamp()}.xlsx`);
    } catch (e) {
      console.error("Erreur export newsletter:", e);
      alert("Erreur pendant l'export.");
    } finally {
      setExporting(false);
    }
  };

  const s = data?.summary;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const hasFilters = ordered !== "all" || list !== "all" || dateFrom || dateTo || q;
  const listName = (id: string) => data?.lists.find((l) => String(l.id) === id)?.label ?? id;

  return (
    <div className="space-y-6 mt-4">
      {/* ─── Synthèse ─────────────────────────────── */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Inscrits", value: s?.subscribed },
          { label: "Inscrits sans commande", value: s?.subscribedNoOrder },
          { label: "Inscrits clients", value: s ? s.subscribed - s.subscribedNoOrder : undefined },
          { label: "Désinscrits", value: s?.unsubscribed },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">{k.label}</p>
              <p className="text-2xl font-semibold tabular-nums">{k.value === undefined ? "—" : formatNumber(k.value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Inscriptions et désinscriptions par mois</CardTitle>
          </CardHeader>
          <CardContent>
            {s && s.monthly.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={s.monthly.map((m) => ({ ...m, label: monthLabel(m.month) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip formatter={(v) => formatNumber(Number(v))} />
                  <Legend />
                  <Bar dataKey="subscribed" name="Nouveaux inscrits" fill="#0284c7" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="unsubscribed" name="Désinscriptions" fill="#f97316" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground">Pas encore de données — la 1re synchro Brevo n&apos;a pas tourné.</p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Date d&apos;inscription = création du contact dans Brevo. Les désinscriptions sont datées par la synchro
              (fiables à partir de sa mise en route, le 19/11/2026).
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inscrits par liste Brevo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {s?.byList.map((l) => (
              <div key={l.id} className="flex items-center justify-between text-sm">
                <span>{l.label}</span>
                <span className="tabular-nums font-medium">{formatNumber(l.count)}</span>
              </div>
            ))}
            <p className="pt-2 text-xs text-muted-foreground">
              Un contact peut être dans plusieurs listes.
              {data?.lastSync &&
                ` Dernière synchro : ${new Date(data.lastSync.syncedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}.`}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ─── Filtres ──────────────────────────────── */}
      <Card>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">Statut</label>
              <Select value={status} onValueChange={(v) => resetPage(setStatus)(v || "subscribed")}>
                <SelectTrigger className="w-36 h-9">
                  <span className="text-sm">{STATUS_LABELS[status]}</span>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">Commandes</label>
              <Select value={ordered} onValueChange={(v) => resetPage(setOrdered)(v || "all")}>
                <SelectTrigger className="w-40 h-9">
                  <span className="text-sm">{ORDERED_LABELS[ordered]}</span>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ORDERED_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">Liste</label>
              <Select value={list} onValueChange={(v) => resetPage(setList)(v || "all")}>
                <SelectTrigger className="w-44 h-9">
                  <span className="text-sm truncate">{list === "all" ? "Toutes" : listName(list)}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes</SelectItem>
                  {data?.lists.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">Inscrit du</label>
              <Input type="date" value={dateFrom} onChange={(e) => resetPage(setDateFrom)(e.target.value)} className="w-40 h-9" />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">au</label>
              <Input type="date" value={dateTo} onChange={(e) => resetPage(setDateTo)(e.target.value)} className="w-40 h-9" />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-muted-foreground">Recherche</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && resetPage(setQ)(search.trim())}
                  onBlur={() => search.trim() !== q && resetPage(setQ)(search.trim())}
                  placeholder="Email, nom…"
                  className="w-52 h-9 pl-8"
                />
              </div>
            </div>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 gap-1"
                onClick={() => {
                  setOrdered("all");
                  setList("all");
                  setDateFrom("");
                  setDateTo("");
                  setSearch("");
                  setQ("");
                  setPage(1);
                }}
              >
                <X className="h-4 w-4" /> Effacer
              </Button>
            )}
            <Button onClick={handleExport} disabled={exporting || !data?.total} className="gap-2 h-9 ml-auto">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Exporter ({formatNumber(data?.total ?? 0)})
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ─── Liste ────────────────────────────────── */}
      <Card>
        <CardContent className="pt-6">
          {loading && !data ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
              <Mail className="h-10 w-10 opacity-40" />
              Aucun contact pour ces filtres.
            </div>
          ) : (
            <div className={`overflow-x-auto ${loading ? "opacity-60" : ""}`}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contact</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Listes</TableHead>
                    <TableHead>Inscrit le</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="text-right">Commandes</TableHead>
                    <TableHead className="text-right">Total dépensé</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((r) => (
                    <TableRow key={r.email}>
                      <TableCell className="font-medium">{[r.firstName, r.lastName].filter(Boolean).join(" ") || "—"}</TableCell>
                      <TableCell className="text-sm">{r.email}</TableCell>
                      <TableCell className="text-sm">{r.lists || "—"}</TableCell>
                      <TableCell className="text-sm tabular-nums">{fr(r.subscribedAt)}</TableCell>
                      <TableCell>
                        {r.subscribed ? (
                          <Badge variant="secondary">Inscrit</Badge>
                        ) : (
                          <Badge variant="outline">Désinscrit{r.unsubscribedAt ? ` le ${fr(r.unsubscribedAt)}` : ""}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.ordersCount || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.ordersCount ? euro(r.totalSpent) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {data && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} sur {totalPages} — {formatNumber(data.total)} contacts
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="gap-1">
              <ChevronLeft className="h-4 w-4" /> Précédent
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="gap-1">
              Suivant <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Download, Loader2, Search, X } from "lucide-react";
import { formatNumber } from "@/lib/utils";
import {
  clientDisplayName, clientSheetRows,
  type SegmentedClient, type SegmentedSummary,
} from "@/lib/btoc-clients";
import * as XLSX from "xlsx";

const euro = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "—");

/** Un bloc de l'écran sur lequel on a cliqué : son libellé et le filtre qu'il représente. */
export interface Segment {
  title: string;
  hint?: string;
  /** Nom de fichier (sans extension) pour l'export de ce détail. */
  slug: string;
  params: Record<string, string>;
}

const PAGE = 200;

export function SegmentDetailDialog({
  segment, onClose, dateFrom, dateTo,
}: { segment: Segment | null; onClose: () => void; dateFrom: string; dateTo: string }) {
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [clients, setClients] = useState<SegmentedClient[]>([]);
  const [summary, setSummary] = useState<SegmentedSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const reqId = useRef(0);

  // Nouveau bloc ouvert → on repart d'une recherche vide.
  useEffect(() => {
    if (segment) { setQ(""); setLimit(PAGE); setClients([]); setSummary(null); }
  }, [segment]);

  const baseQuery = useMemo(() => {
    const p = new URLSearchParams(segment?.params ?? {});
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    return p;
  }, [segment, dateFrom, dateTo]);

  useEffect(() => {
    if (!segment) return;
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const p = new URLSearchParams(baseQuery);
        if (q.trim()) p.set("q", q.trim());
        p.set("limit", String(limit));
        const res = await fetch(`/api/btoc/segmentation/clients?${p}`);
        const d = await res.json();
        if (id !== reqId.current) return; // réponse périmée
        if (res.ok) { setClients(d.clients); setSummary(d.summary); }
      } catch {
        /* on garde la liste précédente */
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [segment, baseQuery, q, limit]);

  const exportExcel = useCallback(async () => {
    if (!segment) return;
    setExporting(true);
    try {
      const p = new URLSearchParams(baseQuery);
      if (q.trim()) p.set("q", q.trim());
      const res = await fetch(`/api/btoc/segmentation/clients?${p}`);
      const d = await res.json();
      if (!res.ok) return;
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(clientSheetRows(d.clients)), "Clients");
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet([
          { Critère: "Segment", Valeur: segment.title },
          { Critère: "Période", Valeur: dateFrom || dateTo ? `${dateFrom || "début"} → ${dateTo || "aujourd'hui"}` : "Tout l'historique" },
          { Critère: "Recherche", Valeur: q.trim() || "—" },
          { Critère: "Clients retenus", Valeur: String(d.clients.length) },
        ]),
        "Critères"
      );
      XLSX.writeFile(wb, `${segment.slug}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setExporting(false);
    }
  }, [segment, baseQuery, q, dateFrom, dateTo]);

  const total = summary?.clients ?? 0;

  return (
    <Dialog open={!!segment} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[88vh] w-full flex-col gap-4 p-0 sm:max-w-5xl"
      >
        <DialogHeader className="border-b px-5 pt-5 pb-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base">{segment?.title}</DialogTitle>
              {segment?.hint && (
                <p className="mt-0.5 text-xs text-muted-foreground">{segment.hint}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Fermer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="relative min-w-56 flex-1">
              <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }}
                placeholder="Rechercher un e-mail ou un nom…"
                className="h-9 pl-8"
              />
            </div>
            <span className="text-sm text-muted-foreground">
              {loading ? (
                <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Recherche…</span>
              ) : (
                <>
                  <strong className="text-foreground">{formatNumber(total)}</strong> client
                  {total > 1 ? "s" : ""} · {formatNumber(summary?.orders ?? 0)} cmd ·{" "}
                  {euro(summary?.revenue ?? 0)}
                </>
              )}
            </span>
            <Button onClick={exportExcel} disabled={exporting || !total} size="sm" className="ml-auto gap-2">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Exporter
            </Button>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto px-5">
          {!loading && clients.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {q ? `Aucun client ne correspond à « ${q} ».` : "Aucun client dans ce segment."}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3 text-left font-medium">Client</th>
                  <th className="px-3 py-2 text-left font-medium">Ville</th>
                  <th className="px-3 py-2 text-right font-medium">Cmd</th>
                  <th className="px-3 py-2 text-right font-medium">Dépensé</th>
                  <th className="px-3 py-2 text-right font-medium">Panier moy.</th>
                  <th className="px-3 py-2 text-left font-medium">Tailles</th>
                  <th className="px-3 py-2 text-left font-medium">Dernier achat</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.email} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-1.5 font-medium">
                        {clientDisplayName(c)}
                        {c.isVip && (
                          <Badge className="h-4 bg-amber-100 px-1 text-[10px] text-amber-700 hover:bg-amber-100">
                            VIP
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{c.email}</div>
                      {c.phone && <div className="text-xs text-muted-foreground">{c.phone}</div>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {[c.billingPostcode, c.billingCity, c.billingCountry].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td className="px-3 py-2 text-right">{c.orders}</td>
                    <td className="px-3 py-2 text-right font-medium">{euro(c.spent)}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{euro(c.averageBasket)}</td>
                    <td className="max-w-56 px-3 py-2 text-xs text-muted-foreground">{c.sizes || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{day(c.lastOrder)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t px-5 pt-3 pb-4">
          <p className="text-xs text-muted-foreground">
            {clients.length < total
              ? `${formatNumber(clients.length)} affichés sur ${formatNumber(total)} — l'export contient tout.`
              : `${formatNumber(clients.length)} client${clients.length > 1 ? "s" : ""} affiché${clients.length > 1 ? "s" : ""}.`}
          </p>
          {clients.length < total && (
            <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)} disabled={loading}>
              Afficher {Math.min(PAGE, total - clients.length)} de plus
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

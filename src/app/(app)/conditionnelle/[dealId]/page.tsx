"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ArrowLeft, Upload, Download, AlertTriangle, Trash2, Loader2, Search, Lock, LockOpen,
} from "lucide-react";
import { toast } from "sonner";
import { cn, formatNumber } from "@/lib/utils";
import * as XLSX from "xlsx";

const euro = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);

type MovementType = "LIVRAISON" | "VENTE" | "RETOUR";

interface BalanceLine {
  key: string; productId: string | null; ean: string | null;
  reference: string; color: string; size: string;
  delivered: number; sold: number; returned: number; remaining: number;
  neverDelivered: boolean; label: string | null; colorLabel: string | null;
  costPrice: number | null;
}
interface Movement {
  id: string; type: MovementType; fileName: string | null; importedBy: string | null;
  movementDate: string; lines: number; pieces: number;
}
interface DealData {
  deal: { id: string; label: string; status: string; client: { code: string; name: string } };
  movements: Movement[];
  balance: BalanceLine[];
  summary: {
    delivered: number; sold: number; returned: number; remaining: number;
    neverDeliveredLines: number; neverDeliveredPieces: number;
    overDeclaredLines: number; overDeclaredPieces: number; openLines: number;
  };
  invoice: { pieces: number; amount: number; piecesWithoutPrice: number };
}

const TYPE_META: Record<MovementType, { title: string; hint: string; color: string }> = {
  LIVRAISON: {
    title: "1. Livraison",
    hint: "Ce qu'on dépose chez le client. Peut être importé plusieurs fois pour recompléter.",
    color: "bg-blue-50 text-blue-600",
  },
  VENTE: {
    title: "2. Ventes déclarées",
    hint: "Ce que le client déclare avoir vendu. À importer à chaque relevé — les imports se cumulent.",
    color: "bg-emerald-50 text-emerald-600",
  },
  RETOUR: {
    title: "3. Retour",
    hint: "Ce que le client nous rend en fin d'opération. Doit normalement solder le reste.",
    color: "bg-amber-50 text-amber-600",
  },
};

export default function ConditionnelleDetailPage() {
  const { dealId } = useParams<{ dealId: string }>();
  const router = useRouter();
  const [data, setData] = useState<DealData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<MovementType | null>(null);
  const [search, setSearch] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const inputs = {
    LIVRAISON: useRef<HTMLInputElement>(null),
    VENTE: useRef<HTMLInputElement>(null),
    RETOUR: useRef<HTMLInputElement>(null),
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/conditional/${dealId}`);
      const d = await res.json();
      if (res.ok) setData(d);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    load();
  }, [load]);

  const upload = async (type: MovementType, file: File) => {
    setBusy(type);
    setWarnings([]);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", type);
      const res = await fetch(`/api/conditional/${dealId}/import`, { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Erreur");
      toast.success(`${d.data.pieces} pièce(s) importée(s)`, {
        description: `${d.data.lines} ligne(s) — ${TYPE_META[type].title}`,
      });
      if (d.data.warnings?.length) setWarnings(d.data.warnings);
      load();
    } catch (e) {
      toast.error("Import impossible", { description: String(e) });
    } finally {
      setBusy(null);
      if (inputs[type].current) inputs[type].current.value = "";
    }
  };

  const removeMovement = async (m: Movement) => {
    if (!window.confirm(`Annuler cet import (${m.pieces} pièces) ? Le solde sera recalculé.`)) return;
    try {
      const res = await fetch(`/api/conditional/${dealId}/movements/${m.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Erreur");
      toast.success("Import annulé");
      load();
    } catch (e) {
      toast.error("Suppression impossible", { description: String(e) });
    }
  };

  const toggleStatus = async () => {
    if (!data) return;
    const next = data.deal.status === "CLOTUREE" ? "EN_COURS" : "CLOTUREE";
    if (next === "CLOTUREE" && data.summary.remaining !== 0) {
      if (!window.confirm(
        `Il reste ${data.summary.remaining} pièce(s) non soldée(s). Clôturer quand même ?`
      )) return;
    }
    try {
      await fetch(`/api/conditional/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      load();
    } catch {
      toast.error("Impossible de changer le statut");
    }
  };

  const visible = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.balance;
    return data.balance.filter((r) =>
      [r.reference, r.color, r.size, r.ean, r.label, r.colorLabel]
        .some((v) => v && String(v).toLowerCase().includes(q))
    );
  }, [data, search]);

  /** Export EAN des ventes déclarées — le fichier de facturation. */
  const exportSales = () => {
    if (!data) return;
    const rows = data.balance
      .filter((r) => r.sold > 0)
      .map((r) => ({
        EAN: r.ean || "",
        "Référence": r.reference,
        "Couleur": [r.color, r.colorLabel].filter(Boolean).join(" "),
        "Taille": r.size,
        "Désignation": r.label || "",
        "Quantité vendue": r.sold,
        "Prix de gros": r.costPrice ?? "",
        "Montant": r.costPrice != null ? Math.round(r.costPrice * r.sold * 100) / 100 : "",
      }));
    if (rows.length === 0) {
      toast.error("Aucune vente déclarée à exporter");
      return;
    }
    rows.push({
      EAN: "TOTAL", "Référence": "", "Couleur": "", "Taille": "", "Désignation": "",
      "Quantité vendue": data.invoice.pieces, "Prix de gros": "", "Montant": data.invoice.amount,
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 16 }, { wch: 18 }, { wch: 20 }, { wch: 8 }, { wch: 32 }, { wch: 14 }, { wch: 12 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ventes déclarées");
    XLSX.writeFile(wb, `Conditionnelle - ventes - ${data.deal.client.name} - ${data.deal.label}.xlsx`);
  };

  /** Rapport d'écarts : ce qui reste dû, sur-déclaré ou jamais livré. */
  const exportReport = () => {
    if (!data) return;
    const rows = data.balance
      .filter((r) => r.remaining !== 0 || r.neverDelivered)
      .map((r) => ({
        "Anomalie": r.neverDelivered
          ? "Jamais livré"
          : r.remaining < 0
            ? "Déclaré au-delà du livré"
            : "Reste non soldé",
        EAN: r.ean || "",
        "Référence": r.reference,
        "Couleur": [r.color, r.colorLabel].filter(Boolean).join(" "),
        "Taille": r.size,
        "Livré": r.delivered, "Vendu": r.sold, "Rendu": r.returned, "Reste": r.remaining,
      }));
    if (rows.length === 0) {
      toast.success("Aucun écart : l'opération est parfaitement soldée");
      return;
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Écarts");
    XLSX.writeFile(wb, `Conditionnelle - écarts - ${data.deal.client.name} - ${data.deal.label}.xlsx`);
  };

  if (loading) {
    return (
      <div>
        <Topbar title="Vente en conditionnelle" />
        <p className="p-8 text-sm text-muted-foreground">Chargement…</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div>
        <Topbar title="Vente en conditionnelle" />
        <p className="p-8 text-sm text-muted-foreground">Opération introuvable.</p>
      </div>
    );
  }

  const s = data.summary;
  const closed = data.deal.status === "CLOTUREE";
  const hasAnomaly = s.neverDeliveredLines > 0 || s.overDeclaredLines > 0;

  return (
    <div>
      <Topbar title="Vente en conditionnelle" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title={data.deal.label}
          description={`${data.deal.client.name} (${data.deal.client.code})`}
          action={
            <div className="flex items-center gap-2">
              <Link href="/conditionnelle">
                <Button variant="outline" size="sm" className="gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  Retour
                </Button>
              </Link>
              <Button variant="outline" size="sm" onClick={toggleStatus} className="gap-2">
                {closed ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                {closed ? "Rouvrir" : "Clôturer"}
              </Button>
            </div>
          }
        />

        {/* ── Totaux ── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { l: "Livré", v: s.delivered, c: "" },
            { l: "Vendu", v: s.sold, c: "text-emerald-600" },
            { l: "Rendu", v: s.returned, c: "" },
            { l: "Reste", v: s.remaining, c: s.remaining < 0 ? "text-red-600" : s.remaining === 0 ? "text-emerald-600" : "text-amber-600" },
          ].map((t) => (
            <Card key={t.l}>
              <CardContent className="pt-6">
                <div className={cn("text-2xl font-bold", t.c)}>{formatNumber(t.v)}</div>
                <p className="text-sm text-muted-foreground">{t.l}</p>
              </CardContent>
            </Card>
          ))}
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{euro(data.invoice.amount)}</div>
              <p className="text-sm text-muted-foreground">À facturer ({data.invoice.pieces} pcs)</p>
              {data.invoice.piecesWithoutPrice > 0 && (
                <p className="mt-1 text-[11px] text-amber-600">
                  {data.invoice.piecesWithoutPrice} pièce(s) sans prix
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Alertes ── */}
        {(hasAnomaly || warnings.length > 0 || (closed && s.remaining !== 0)) && (
          <Card className="border-amber-300 bg-amber-50/60">
            <CardContent className="space-y-1.5 pt-6 text-sm">
              {closed && s.remaining !== 0 && (
                <p className="flex items-start gap-2 font-medium text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  Opération clôturée avec <strong className="mx-1">{s.remaining}</strong> pièce(s)
                  non soldée(s) — le retour n&apos;a pas tout couvert.
                </p>
              )}
              {s.neverDeliveredLines > 0 && (
                <p className="flex items-start gap-2 text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <strong>{s.neverDeliveredLines}</strong> ligne(s) portent des produits
                    <strong> jamais livrés</strong> dans cette opération
                    ({s.neverDeliveredPieces} pièce(s)).
                  </span>
                </p>
              )}
              {s.overDeclaredLines > 0 && (
                <p className="flex items-start gap-2 text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <strong>{s.overDeclaredLines}</strong> ligne(s) déclarées
                    <strong> au-delà du livré</strong> ({s.overDeclaredPieces} pièce(s) en trop).
                  </span>
                </p>
              )}
              {warnings.map((w, i) => (
                <p key={i} className="flex items-start gap-2 text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{w}</span>
                </p>
              ))}
            </CardContent>
          </Card>
        )}

        {/* ── Les 3 imports ── */}
        <div className="grid gap-4 lg:grid-cols-3">
          {(Object.keys(TYPE_META) as MovementType[]).map((type) => {
            const meta = TYPE_META[type];
            const mine = data.movements.filter((m) => m.type === type);
            return (
              <Card key={type}>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", meta.color)}>
                      <Upload className="h-4 w-4" />
                    </div>
                    <CardTitle className="text-base">{meta.title}</CardTitle>
                  </div>
                  <p className="pt-1 text-xs text-muted-foreground">{meta.hint}</p>
                </CardHeader>
                <CardContent className="space-y-2">
                  <label
                    className={cn(
                      "flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm transition-colors",
                      busy === type ? "opacity-60" : "hover:bg-muted/40"
                    )}
                  >
                    {busy === type ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span>{busy === type ? "Import…" : "Choisir un fichier"}</span>
                    <input
                      ref={inputs[type]}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      disabled={busy !== null}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) upload(type, f);
                      }}
                    />
                  </label>
                  {mine.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Aucun import.</p>
                  ) : (
                    mine.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{m.fileName || "fichier"}</p>
                          <p className="text-muted-foreground">
                            {new Date(m.movementDate).toLocaleDateString("fr-FR")} ·{" "}
                            {formatNumber(m.pieces)} pcs
                            {m.importedBy ? ` · ${m.importedBy}` : ""}
                          </p>
                        </div>
                        <button
                          onClick={() => removeMovement(m)}
                          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                          title="Annuler cet import"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* ── Solde ── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">
                Solde par produit et taille ({formatNumber(visible.length)})
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Référence, EAN…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-9 w-56 pl-9"
                  />
                </div>
                <Button variant="outline" size="sm" onClick={exportSales} className="gap-2">
                  <Download className="h-4 w-4" />
                  Ventes (EAN)
                </Button>
                <Button variant="outline" size="sm" onClick={exportReport} className="gap-2">
                  <Download className="h-4 w-4" />
                  Rapport d&apos;écarts
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {visible.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Aucune ligne — commencez par importer une livraison.
              </p>
            ) : (
              <ScrollArea>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Référence</TableHead>
                      <TableHead>Couleur</TableHead>
                      <TableHead>Taille</TableHead>
                      <TableHead className="whitespace-nowrap">EAN</TableHead>
                      <TableHead className="text-right">Livré</TableHead>
                      <TableHead className="text-right">Vendu</TableHead>
                      <TableHead className="text-right">Rendu</TableHead>
                      <TableHead className="text-right">Reste</TableHead>
                      <TableHead>État</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.slice(0, 400).map((r) => (
                      <TableRow
                        key={r.key}
                        className={cn(
                          r.neverDelivered && "bg-red-50/60",
                          !r.neverDelivered && r.remaining < 0 && "bg-amber-50/60"
                        )}
                      >
                        <TableCell className="whitespace-nowrap font-mono text-sm">
                          {r.reference}
                          {r.label && (
                            <span className="block font-sans text-[11px] text-muted-foreground">
                              {r.label}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {[r.color, r.colorLabel].filter(Boolean).join(" ")}
                        </TableCell>
                        <TableCell className="text-sm">{r.size}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {r.ean || "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.delivered}</TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-700">{r.sold}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.returned}</TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-semibold tabular-nums",
                            r.remaining < 0 ? "text-red-600" : r.remaining === 0 ? "text-muted-foreground" : ""
                          )}
                        >
                          {r.remaining}
                        </TableCell>
                        <TableCell>
                          {r.neverDelivered ? (
                            <Badge variant="destructive">Jamais livré</Badge>
                          ) : r.remaining < 0 ? (
                            <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                              Déclaré en trop
                            </Badge>
                          ) : r.remaining === 0 ? (
                            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                              Soldé
                            </Badge>
                          ) : (
                            <Badge variant="outline">En dépôt</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
            {visible.length > 400 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Aperçu des 400 premières lignes — les exports contiennent tout.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

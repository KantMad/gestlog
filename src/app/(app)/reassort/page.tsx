"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Package,
  Truck,
  CircleSlash,
  ChevronRight,
  ChevronDown,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { formatNumber } from "@/lib/utils";

interface Doc {
  id: string;
  orderNumber: string;
  clientCode: string;
  clientName: string;
  catalog: string | null;
  seasonName: string;
  orderDate: string | null;
  ordered: number;
  delivered: number;
  missing: number;
  docCount: number;
  status: "NON_LIVREE" | "PARTIELLE" | "LIVREE";
}
interface Line {
  reference: string;
  color: string;
  colorLabel: string;
  size: string;
  ordered: number;
  delivered: number;
  missing: number;
}

const STATUS = {
  LIVREE: { label: "Livrée", cls: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  PARTIELLE: { label: "Partielle", cls: "bg-amber-100 text-amber-700", icon: AlertTriangle },
  NON_LIVREE: { label: "Non livrée", cls: "bg-zinc-100 text-zinc-600", icon: CircleSlash },
} as const;

function fmtDate(d: string | null) {
  return d ? new Date(d).toLocaleDateString("fr-FR") : "—";
}

export default function ReassortPage() {
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [summary, setSummary] = useState({ orders: 0, ordered: 0, delivered: 0, livree: 0, partielle: 0, nonLivree: 0 });
  const [clients, setClients] = useState<{ code: string; name: string }[]>([]);
  const [seasons, setSeasons] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [season, setSeason] = useState("Réassort");
  const [clientCode, setClientCode] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  const [expanded, setExpanded] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, Line[]>>({});
  const [loadingLines, setLoadingLines] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (season) p.set("season", season);
      if (clientCode) p.set("clientCode", clientCode);
      if (status) p.set("status", status);
      if (search) p.set("search", search);
      const d = await (await fetch(`/api/reassort?${p}`)).json();
      setDocuments(d.documents || []);
      setSummary(d.summary || { orders: 0, ordered: 0, delivered: 0, livree: 0, partielle: 0, nonLivree: 0 });
      setClients(d.clients || []);
      setSeasons(d.seasons || []);
    } catch (e) {
      console.error("Erreur chargement commandes:", e);
    } finally {
      setLoading(false);
    }
  }, [season, clientCode, status, search]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (doc: Doc) => {
    if (expanded === doc.id) return setExpanded(null);
    setExpanded(doc.id);
    if (!lines[doc.id]) {
      setLoadingLines(true);
      try {
        const d = await (await fetch(`/api/reassort/lines?orderId=${doc.id}`)).json();
        setLines((prev) => ({ ...prev, [doc.id]: d.lines || [] }));
      } finally {
        setLoadingLines(false);
      }
    }
  };

  const clientLabel = clientCode ? clients.find((c) => c.code === clientCode)?.name || clientCode : "Tous";

  return (
    <>
      <Topbar title="Commandes client" />
      <div className="p-8 space-y-6">
        <PageHeader
          title="Commandes client"
          description="Commandes B2B (TIO) par saison, confrontées aux livraisons (BL/Factures) — livré vs commandé"
        />

        <div className="grid grid-cols-4 gap-4">
          <Card><CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50"><Package className="h-5 w-5 text-blue-600" /></div>
            <div><p className="text-2xl font-bold">{formatNumber(summary.orders)}</p><p className="text-xs text-muted-foreground">Commandes</p></div>
          </CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50"><CheckCircle2 className="h-5 w-5 text-emerald-600" /></div>
            <div><p className="text-2xl font-bold">{formatNumber(summary.livree)}</p><p className="text-xs text-muted-foreground">Livrées</p></div>
          </CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50"><AlertTriangle className="h-5 w-5 text-amber-600" /></div>
            <div><p className="text-2xl font-bold">{formatNumber(summary.partielle)}</p><p className="text-xs text-muted-foreground">Partielles</p></div>
          </CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100"><Truck className="h-5 w-5 text-zinc-500" /></div>
            <div><p className="text-2xl font-bold">{formatNumber(summary.delivered)}/{formatNumber(summary.ordered)}</p><p className="text-xs text-muted-foreground">Pièces livrées / commandées</p></div>
          </CardContent></Card>
        </div>

        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">Saison</label>
                <Select value={season || "all"} onValueChange={(v) => setSeason(!v || v === "all" ? "" : v)}>
                  <SelectTrigger className="w-44 h-9">
                    <span className={`text-sm truncate ${!season ? "text-muted-foreground" : ""}`}>
                      {season || "Toutes"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes</SelectItem>
                    {seasons.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">Client</label>
                <Select value={clientCode || "all"} onValueChange={(v) => setClientCode(!v || v === "all" ? "" : v)}>
                  <SelectTrigger className="w-56 h-9">
                    <span className={`text-sm truncate ${!clientCode ? "text-muted-foreground" : ""}`}>{clientLabel}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous</SelectItem>
                    {clients.map((c) => (<SelectItem key={c.code} value={c.code}>{c.name || c.code}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">Statut</label>
                <Select value={status || "all"} onValueChange={(v) => setStatus(!v || v === "all" ? "" : v)}>
                  <SelectTrigger className="w-40 h-9">
                    <span className={`text-sm truncate ${!status ? "text-muted-foreground" : ""}`}>
                      {status ? STATUS[status as keyof typeof STATUS].label : "Tous"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous</SelectItem>
                    <SelectItem value="LIVREE">Livrées</SelectItem>
                    <SelectItem value="PARTIELLE">Partielles</SelectItem>
                    <SelectItem value="NON_LIVREE">Non livrées</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">Recherche</label>
                <Input placeholder="N° commande, client..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-56 h-9" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : documents.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">Aucune commande.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>N° Commande</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Catalogue</TableHead>
                    <TableHead className="text-right">Commandé</TableHead>
                    <TableHead className="text-right">Livré</TableHead>
                    <TableHead className="text-right">Manquant</TableHead>
                    <TableHead>Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((doc) => {
                    const S = STATUS[doc.status];
                    return (
                      <Fragment key={doc.id}>
                        <TableRow className="cursor-pointer" onClick={() => toggle(doc)}>
                          <TableCell>{expanded === doc.id ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}</TableCell>
                          <TableCell className="font-mono text-xs font-medium">{doc.orderNumber}</TableCell>
                          <TableCell>
                            <div>{doc.clientName || doc.clientCode}</div>
                            <div className="text-xs text-muted-foreground">{doc.clientCode}</div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{doc.catalog || "—"}</TableCell>
                          <TableCell className="text-right font-medium">{formatNumber(doc.ordered)}</TableCell>
                          <TableCell className="text-right">{formatNumber(doc.delivered)}</TableCell>
                          <TableCell className={`text-right font-medium ${doc.missing > 0 ? "text-amber-600" : "text-muted-foreground"}`}>{doc.missing > 0 ? formatNumber(doc.missing) : "—"}</TableCell>
                          <TableCell>
                            <Badge className={`gap-1 ${S.cls}`}><S.icon className="h-3 w-3" />{S.label}</Badge>
                          </TableCell>
                        </TableRow>
                        {expanded === doc.id && (
                          <TableRow>
                            <TableCell colSpan={8} className="bg-muted/30 p-0">
                              {loadingLines && !lines[doc.id] ? (
                                <div className="flex items-center justify-center py-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
                              ) : (
                                <div className="p-4">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>Référence</TableHead>
                                        <TableHead>Couleur</TableHead>
                                        <TableHead>Taille</TableHead>
                                        <TableHead className="text-right">Commandé</TableHead>
                                        <TableHead className="text-right">Livré</TableHead>
                                        <TableHead className="text-right">Manquant</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {(lines[doc.id] || []).map((l, idx) => (
                                        <TableRow key={idx} className={l.missing > 0 ? "bg-amber-50/50" : ""}>
                                          <TableCell className="font-mono text-xs">{l.reference}</TableCell>
                                          <TableCell className="text-sm">{l.colorLabel ? `${l.color} — ${l.colorLabel}` : l.color}</TableCell>
                                          <TableCell className="text-sm">{l.size}</TableCell>
                                          <TableCell className="text-right">{l.ordered}</TableCell>
                                          <TableCell className="text-right">{l.delivered}</TableCell>
                                          <TableCell className={`text-right font-medium ${l.missing > 0 ? "text-amber-600" : "text-muted-foreground"}`}>{l.missing > 0 ? l.missing : "—"}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

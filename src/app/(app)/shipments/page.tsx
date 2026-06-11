"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import { toast } from "sonner";
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
  FileText,
  Receipt,
  Package,
  Users,
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { formatNumber } from "@/lib/utils";

interface Doc {
  id: string;
  docType: string;
  documentNumber: string;
  tioOrderNumber: string | null;
  orderSeason: string | null;
  season: string | null;
  clientCode: string | null;
  clientName: string | null;
  documentDate: string | null;
  totalQuantity: number;
  lineCount: number;
  clientKnown: boolean;
}

interface Line {
  id: string;
  lineNo: string | null;
  reference: string | null;
  productLabel: string | null;
  colorCode: string | null;
  colorLabel: string | null;
  size: string | null;
  ean: string | null;
  quantity: number;
  parcelNo: string | null;
  refKnown: boolean;
  eanKnown: boolean;
}

interface Group {
  key: string;
  orderNumber: string | null;
  orderSeason: string | null;
  clientCode: string | null;
  clientName: string | null;
  clientKnown: boolean;
  docs: Doc[];
  totalQuantity: number;
  blCount: number;
  facCount: number;
  lastDate: string | null;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR");
}

// Regroupe les documents par n° de commande TIO (sinon document isolé).
function groupDocs(docs: Doc[]): Group[] {
  const map = new Map<string, Group>();
  for (const d of docs) {
    const key = d.tioOrderNumber || `doc:${d.id}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        orderNumber: d.tioOrderNumber,
        orderSeason: d.orderSeason,
        clientCode: d.clientCode,
        clientName: d.clientName,
        clientKnown: d.clientKnown,
        docs: [],
        totalQuantity: 0,
        blCount: 0,
        facCount: 0,
        lastDate: null,
      });
    }
    const g = map.get(key)!;
    g.docs.push(d);
    g.totalQuantity += d.totalQuantity;
    if (d.docType === "FAC") g.facCount++;
    else g.blCount++;
    if (d.documentDate && (!g.lastDate || d.documentDate > g.lastDate)) g.lastDate = d.documentDate;
  }
  return Array.from(map.values());
}

export default function ShipmentsPage() {
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [summary, setSummary] = useState({ docs: 0, qty: 0, clients: 0 });
  const [clients, setClients] = useState<{ clientCode: string; clientName: string | null }[]>([]);
  const [seasons, setSeasons] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [docType, setDocType] = useState("");
  const [clientCode, setClientCode] = useState("");
  const [orderSeason, setOrderSeason] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Expansion (par groupe) + lignes (par document)
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, Line[]>>({});
  const [loadingLines, setLoadingLines] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (docType) p.set("docType", docType);
      if (clientCode) p.set("clientCode", clientCode);
      if (orderSeason) p.set("orderSeason", orderSeason);
      if (search) p.set("search", search);
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
      const res = await fetch(`/api/shipments?${p}`);
      if (!res.ok) throw new Error();
      const d = await res.json();
      setDocuments(d.documents || []);
      setSummary(d.summary || { docs: 0, qty: 0, clients: 0 });
      setClients(d.clients || []);
      setSeasons(d.seasons || []);
    } catch {
      toast.error("Impossible de charger les livraisons");
    } finally {
      setLoading(false);
    }
  }, [docType, clientCode, orderSeason, search, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = groupDocs(documents);

  const toggle = async (group: Group) => {
    if (expanded === group.key) {
      setExpanded(null);
      return;
    }
    setExpanded(group.key);
    // Charge les lignes de tous les documents du groupe pas encore chargés
    const missing = group.docs.filter((d) => !lines[d.id]);
    if (missing.length > 0) {
      setLoadingLines(true);
      try {
        const results = await Promise.all(
          missing.map((d) =>
            fetch(`/api/shipments/lines?documentId=${d.id}`)
              .then((r) => r.json())
              .then((j) => [d.id, j.lines || []] as [string, Line[]])
          )
        );
        setLines((prev) => {
          const next = { ...prev };
          for (const [id, ls] of results) next[id] = ls;
          return next;
        });
      } catch (e) {
        console.error("Erreur chargement lignes:", e);
      } finally {
        setLoadingLines(false);
      }
    }
  };

  const clientLabel = clientCode
    ? clients.find((c) => c.clientCode === clientCode)?.clientName || clientCode
    : "Tous";

  // Rendu d'un document (en-tête + lignes) dans la zone dépliée
  const renderDoc = (d: Doc) => (
    <div key={d.id} className="rounded-md border bg-background">
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <Badge variant={d.docType === "BL" ? "default" : "secondary"} className="gap-1">
          {d.docType === "BL" ? <FileText className="h-3 w-3" /> : <Receipt className="h-3 w-3" />}
          {d.docType}
        </Badge>
        <span className="font-medium text-sm">N° {d.documentNumber}</span>
        <span className="text-xs text-muted-foreground">{fmtDate(d.documentDate)}</span>
        <span className="ml-auto text-xs text-muted-foreground">{formatNumber(d.totalQuantity)} pièces · {d.lineCount} lignes</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Référence</TableHead>
            <TableHead>Produit</TableHead>
            <TableHead>Couleur</TableHead>
            <TableHead>Taille</TableHead>
            <TableHead>EAN</TableHead>
            <TableHead className="text-right">Qté</TableHead>
            <TableHead>Colis</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(lines[d.id] || []).map((l) => (
            <TableRow key={l.id}>
              <TableCell className="font-mono text-xs">
                <div className="flex items-center gap-1.5">
                  {l.reference || "—"}
                  {l.reference && !l.refKnown && (
                    <span title="Référence inconnue"><AlertTriangle className="h-3.5 w-3.5 text-amber-500" /></span>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-sm">{l.productLabel || "—"}</TableCell>
              <TableCell className="text-sm">{l.colorLabel || l.colorCode || "—"}</TableCell>
              <TableCell className="text-sm">{l.size || "—"}</TableCell>
              <TableCell className="font-mono text-xs">{l.ean || "—"}</TableCell>
              <TableCell className="text-right font-medium">{l.quantity}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{l.parcelNo || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <>
      <Topbar title="Livraisons" />
      <div className="p-8 space-y-6">
        <PageHeader
          title="Livraisons"
          description="Bons de livraison et factures importés de l'entrepôt, regroupés par commande TIO"
        />

        {/* Résumé */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50">
                <Package className="h-5 w-5 text-indigo-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{formatNumber(groups.length)}</p>
                <p className="text-xs text-muted-foreground">Commandes livrées</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                <FileText className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{formatNumber(summary.docs)}</p>
                <p className="text-xs text-muted-foreground">Documents (BL/FAC)</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50">
                <Package className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{formatNumber(summary.qty)}</p>
                <p className="text-xs text-muted-foreground">Pièces livrées</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50">
                <Users className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{formatNumber(summary.clients)}</p>
                <p className="text-xs text-muted-foreground">Clients</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filtres */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">Type</label>
                <Select value={docType || "all"} onValueChange={(v) => setDocType(!v || v === "all" ? "" : v)}>
                  <SelectTrigger className="w-32 h-9">
                    <span className={`text-sm truncate ${!docType ? "text-muted-foreground" : ""}`}>
                      {docType === "BL" ? "BL" : docType === "FAC" ? "Factures" : "Tous"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous</SelectItem>
                    <SelectItem value="BL">BL</SelectItem>
                    <SelectItem value="FAC">Factures</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">Client</label>
                <Select value={clientCode || "all"} onValueChange={(v) => setClientCode(!v || v === "all" ? "" : v)}>
                  <SelectTrigger className="w-56 h-9">
                    <span className={`text-sm truncate ${!clientCode ? "text-muted-foreground" : ""}`}>
                      {clientLabel}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous</SelectItem>
                    {clients.map((c) => (
                      <SelectItem key={c.clientCode} value={c.clientCode}>
                        {c.clientName || c.clientCode}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">Saison</label>
                <Select value={orderSeason || "all"} onValueChange={(v) => setOrderSeason(!v || v === "all" ? "" : v)}>
                  <SelectTrigger className="w-40 h-9">
                    <span className={`text-sm truncate ${!orderSeason ? "text-muted-foreground" : ""}`}>
                      {orderSeason || "Toutes"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes</SelectItem>
                    {seasons.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">Date début</label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40 h-9" />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">Date fin</label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40 h-9" />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">Recherche</label>
                <Input
                  placeholder="N° doc/commande, réf, EAN, client..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-56 h-9"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tableau groupé par commande */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : groups.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">Aucune livraison.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>N° Commande</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Saison</TableHead>
                    <TableHead>Documents</TableHead>
                    <TableHead>Dernière</TableHead>
                    <TableHead className="text-right">Pièces</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => (
                    <Fragment key={g.key}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => toggle(g)}
                        role="button"
                        tabIndex={0}
                        aria-expanded={expanded === g.key}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggle(g);
                          }
                        }}
                      >
                        <TableCell>
                          {expanded === g.key ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-medium">
                          {g.orderNumber || <span className="text-muted-foreground">(sans commande)</span>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span>{g.clientName || g.clientCode || "—"}</span>
                            {g.clientCode && !g.clientKnown && (
                              <span title="Client absent de l'outil"><AlertTriangle className="h-3.5 w-3.5 text-amber-500" /></span>
                            )}
                          </div>
                          {g.clientCode && <span className="text-xs text-muted-foreground">{g.clientCode}</span>}
                        </TableCell>
                        <TableCell>
                          {g.orderSeason ? <Badge variant="secondary" className="text-xs">{g.orderSeason}</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {g.blCount > 0 && <Badge className="gap-1"><FileText className="h-3 w-3" />{g.blCount} BL</Badge>}
                            {g.facCount > 0 && <Badge variant="secondary" className="gap-1"><Receipt className="h-3 w-3" />{g.facCount} FAC</Badge>}
                          </div>
                        </TableCell>
                        <TableCell>{fmtDate(g.lastDate)}</TableCell>
                        <TableCell className="text-right font-medium">{formatNumber(g.totalQuantity)}</TableCell>
                      </TableRow>
                      {expanded === g.key && (
                        <TableRow>
                          <TableCell colSpan={7} className="bg-muted/30 p-0">
                            {loadingLines && g.docs.some((d) => !lines[d.id]) ? (
                              <div className="flex items-center justify-center py-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
                            ) : (
                              <div className="p-4 space-y-4">
                                {g.blCount > 0 && (
                                  <div className="space-y-2">
                                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Bons de livraison</p>
                                    {g.docs.filter((d) => d.docType !== "FAC").map(renderDoc)}
                                  </div>
                                )}
                                {g.facCount > 0 && (
                                  <div className="space-y-2">
                                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Factures</p>
                                    {g.docs.filter((d) => d.docType === "FAC").map(renderDoc)}
                                  </div>
                                )}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

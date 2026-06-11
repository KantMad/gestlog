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
  FileText,
  Receipt,
  Package,
  Users,
  ChevronRight,
  ChevronDown,
  Loader2,
  CheckCircle2,
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

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR");
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

  // Expansion
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
      const d = await res.json();
      setDocuments(d.documents || []);
      setSummary(d.summary || { docs: 0, qty: 0, clients: 0 });
      setClients(d.clients || []);
      setSeasons(d.seasons || []);
    } catch (e) {
      console.error("Erreur chargement livraisons:", e);
    } finally {
      setLoading(false);
    }
  }, [docType, clientCode, orderSeason, search, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (doc: Doc) => {
    if (expanded === doc.id) {
      setExpanded(null);
      return;
    }
    setExpanded(doc.id);
    if (!lines[doc.id]) {
      setLoadingLines(true);
      try {
        const res = await fetch(`/api/shipments/lines?documentId=${doc.id}`);
        const d = await res.json();
        setLines((prev) => ({ ...prev, [doc.id]: d.lines || [] }));
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

  return (
    <>
      <Topbar title="Livraisons" />
      <div className="p-8 space-y-6">
        <PageHeader
          title="Livraisons"
          description="Bons de livraison et factures importés de l'entrepôt, liés aux commandes TIO"
        />

        {/* Résumé */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                <FileText className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{formatNumber(summary.docs)}</p>
                <p className="text-xs text-muted-foreground">Documents</p>
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
                <p className="text-xs text-muted-foreground">Quantité totale</p>
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
                  placeholder="N° doc, réf, EAN, client..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-56 h-9"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tableau */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : documents.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                Aucun document.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>N° Document</TableHead>
                    <TableHead>Commande</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Qté</TableHead>
                    <TableHead className="text-right">Lignes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((doc) => (
                    <Fragment key={doc.id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => toggle(doc)}
                      >
                        <TableCell>
                          {expanded === doc.id ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={doc.docType === "BL" ? "default" : "secondary"} className="gap-1">
                            {doc.docType === "BL" ? <FileText className="h-3 w-3" /> : <Receipt className="h-3 w-3" />}
                            {doc.docType}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{doc.documentNumber}</TableCell>
                        <TableCell>
                          {doc.tioOrderNumber ? (
                            <div>
                              <div className="font-mono text-xs">{doc.tioOrderNumber}</div>
                              {doc.orderSeason && (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{doc.orderSeason}</Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span>{doc.clientName || doc.clientCode || "—"}</span>
                            {doc.clientCode && !doc.clientKnown && (
                              <span title="Client absent de l'outil">
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                              </span>
                            )}
                          </div>
                          {doc.clientCode && (
                            <span className="text-xs text-muted-foreground">{doc.clientCode}</span>
                          )}
                        </TableCell>
                        <TableCell>{fmtDate(doc.documentDate)}</TableCell>
                        <TableCell className="text-right font-medium">{formatNumber(doc.totalQuantity)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{doc.lineCount}</TableCell>
                      </TableRow>
                      {expanded === doc.id && (
                        <TableRow>
                          <TableCell colSpan={8} className="bg-muted/30 p-0">
                            {loadingLines && !lines[doc.id] ? (
                              <div className="flex items-center justify-center py-6 text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                              </div>
                            ) : (
                              <div className="p-4">
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
                                    {(lines[doc.id] || []).map((l) => (
                                      <TableRow key={l.id}>
                                        <TableCell className="font-mono text-xs">
                                          <div className="flex items-center gap-1.5">
                                            {l.reference || "—"}
                                            {l.reference && (l.refKnown ? (
                                              <span title="Référence connue dans l'outil">
                                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                                              </span>
                                            ) : (
                                              <span title="Référence inconnue">
                                                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                                              </span>
                                            ))}
                                          </div>
                                        </TableCell>
                                        <TableCell className="text-sm">{l.productLabel || "—"}</TableCell>
                                        <TableCell className="text-sm">
                                          {l.colorLabel || l.colorCode || "—"}
                                        </TableCell>
                                        <TableCell className="text-sm">{l.size || "—"}</TableCell>
                                        <TableCell className="font-mono text-xs">
                                          <div className="flex items-center gap-1.5">
                                            {l.ean || "—"}
                                            {l.ean && !l.eanKnown && (
                                              <span title="EAN inconnu dans l'outil">
                                                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                                              </span>
                                            )}
                                          </div>
                                        </TableCell>
                                        <TableCell className="text-right font-medium">{l.quantity}</TableCell>
                                        <TableCell className="text-sm text-muted-foreground">{l.parcelNo || "—"}</TableCell>
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

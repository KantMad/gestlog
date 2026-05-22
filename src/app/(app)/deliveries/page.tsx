"use client";

import { useEffect, useState, useCallback } from "react";
import { useSeason } from "@/lib/season-context";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Truck,
  Package,
  Download,
  FileSpreadsheet,
  ChevronDown,
  ChevronRight,
  Plus,
  CheckCircle,
  Clock,
  Send,
} from "lucide-react";
import { cn, formatNumber, parseSizeScale, type SizeQuantities } from "@/lib/utils";
import { toast } from "sonner";

interface DeliveryLine {
  id: string;
  productId: string;
  reference: string;
  color: string;
  sizeScale: string;
  quantities: SizeQuantities;
  totalQuantity: number;
}

interface DeliveryData {
  id: string;
  deliveryNumber: number;
  clientId: string;
  clientName: string;
  clientCode: string;
  status: string;
  colorCode: string;
  catalog: { id: string; name: string } | null;
  eanExportGenerated: boolean;
  eanExportCount: number;
  lineCount: number;
  totalQuantity: number;
  shippedAt: string | null;
  createdAt: string;
  lines: DeliveryLine[];
}

interface CatalogEntry {
  id: string;
  name: string;
  orderCount: number;
}

interface SessionEntry {
  id: string;
  status: string;
  sessionDate: string;
  _count: { lines: number };
}

function StatusBadge({ status }: { status: string }) {
  if (status === "PLANIFIEE")
    return (
      <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 gap-1">
        <Clock className="h-3 w-3" />
        Planifiée
      </Badge>
    );
  if (status === "EN_PREPARATION")
    return (
      <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 gap-1">
        <Package className="h-3 w-3" />
        En préparation
      </Badge>
    );
  return (
    <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 gap-1">
      <Send className="h-3 w-3" />
      Expédiée
    </Badge>
  );
}

function DeliveryCard({
  delivery,
  onStatusChange,
  onExportEan,
}: {
  delivery: DeliveryData;
  onStatusChange: (id: string, status: string) => void;
  onExportEan: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sizes = delivery.lines.length > 0
    ? parseSizeScale(delivery.lines[0].sizeScale)
    : [];

  return (
    <Card className="overflow-hidden">
      <div
        className="flex items-center gap-0"
        style={{ borderLeft: `4px solid ${delivery.colorCode}` }}
      >
        <div
          className="flex-1 flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-3">
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
              style={{ backgroundColor: delivery.colorCode }}
            >
              {delivery.deliveryNumber}
            </div>
            <div>
              <span className="font-medium text-sm">{delivery.clientName}</span>
              <span className="text-muted-foreground text-xs ml-2">
                ({delivery.clientCode})
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {delivery.lineCount} réf. · {formatNumber(delivery.totalQuantity)} pcs
            </span>
            <StatusBadge status={delivery.status} />
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t">
          <div className="px-4 py-3 bg-muted/30 flex items-center justify-between">
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>
                Créée le{" "}
                {new Date(delivery.createdAt).toLocaleDateString("fr-FR")}
              </span>
              {delivery.shippedAt && (
                <span>
                  Expédiée le{" "}
                  {new Date(delivery.shippedAt).toLocaleDateString("fr-FR")}
                </span>
              )}
              {delivery.eanExportGenerated && (
                <Badge
                  variant="outline"
                  className="text-xs border-emerald-300 text-emerald-700"
                >
                  <FileSpreadsheet className="h-3 w-3 mr-1" />
                  EAN exporté
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {delivery.status !== "EXPEDIEE" && (
                <Select
                  value={delivery.status}
                  onValueChange={(v) => v && onStatusChange(delivery.id, v)}
                >
                  <SelectTrigger className="h-8 w-[160px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PLANIFIEE">Planifiée</SelectItem>
                    <SelectItem value="EN_PREPARATION">
                      En préparation
                    </SelectItem>
                    <SelectItem value="EXPEDIEE">Expédiée</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1 text-xs"
                onClick={() => onExportEan(delivery.id)}
              >
                <Download className="h-3 w-3" />
                Export EAN
              </Button>
            </div>
          </div>

          <ScrollArea>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">Référence</TableHead>
                  <TableHead className="w-[100px]">Couleur</TableHead>
                  {sizes.map((s) => (
                    <TableHead key={s} className="text-center w-[50px]">
                      {s}
                    </TableHead>
                  ))}
                  <TableHead className="text-right w-[70px]">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {delivery.lines.map((line) => {
                  const lineSizes = parseSizeScale(line.sizeScale);
                  return (
                    <TableRow key={line.id}>
                      <TableCell className="font-mono text-sm">
                        {line.reference}
                      </TableCell>
                      <TableCell className="text-sm">{line.color}</TableCell>
                      {(sizes.length > 0 ? sizes : lineSizes).map((size) => (
                        <TableCell
                          key={size}
                          className="text-center text-sm"
                        >
                          {line.quantities[size] || "-"}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-medium text-sm">
                        {formatNumber(line.totalQuantity)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      )}
    </Card>
  );
}

export default function DeliveriesPage() {
  const { activeSeason } = useSeason();
  const [deliveries, setDeliveries] = useState<DeliveryData[]>([]);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [catalogs, setCatalogs] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [filterCatalog, setFilterCatalog] = useState<string>("ALL");

  const loadDeliveries = useCallback(async () => {
    if (!activeSeason) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/deliveries?seasonId=${activeSeason.id}`);
      const data = await res.json();
      setDeliveries(data.data || []);
    } catch {} finally {
      setLoading(false);
    }
  }, [activeSeason]);

  const loadSessions = useCallback(async () => {
    if (!activeSeason) return;
    try {
      const res = await fetch(
        `/api/allocation/sessions?seasonId=${activeSeason.id}`
      );
      const data = await res.json();
      setSessions(
        (data.data || []).filter(
          (s: SessionEntry) => s.status === "VALIDATED"
        )
      );
    } catch {}
  }, [activeSeason]);

  const loadCatalogs = useCallback(async () => {
    if (!activeSeason) return;
    try {
      const res = await fetch(`/api/catalogs?seasonId=${activeSeason.id}`);
      const data = await res.json();
      setCatalogs(data.data || []);
    } catch {}
  }, [activeSeason]);

  useEffect(() => {
    setDeliveries([]);
    setSessions([]);
    setCatalogs([]);
    setFilterCatalog("ALL");
    loadDeliveries();
    loadSessions();
    loadCatalogs();
  }, [activeSeason, loadDeliveries, loadSessions, loadCatalogs]);

  const generateFromSession = async (sessionId: string) => {
    setGenerating(true);
    try {
      const res = await fetch("/api/deliveries/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocationSessionId: sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      toast.success("Livraisons générées", {
        description: `${data.deliveryCount} livraison(s) créée(s)`,
      });
      loadDeliveries();
    } catch (e) {
      toast.error("Erreur", { description: String(e) });
    } finally {
      setGenerating(false);
    }
  };

  const updateStatus = async (deliveryId: string, status: string) => {
    try {
      const res = await fetch(`/api/deliveries/${deliveryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Erreur mise à jour");
      toast.success("Statut mis à jour");
      loadDeliveries();
    } catch (e) {
      toast.error("Erreur", { description: String(e) });
    }
  };

  const exportEan = async (deliveryId: string) => {
    try {
      const res = await fetch(`/api/deliveries/${deliveryId}/ean`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erreur");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const fileNameMatch = disposition.match(/filename="(.+)"/);
      const fileName = fileNameMatch ? fileNameMatch[1] : "export_ean.csv";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("Export EAN téléchargé", { description: fileName });
      loadDeliveries();
    } catch (e) {
      toast.error("Erreur export EAN", { description: String(e) });
    }
  };

  const filtered = deliveries.filter((d) => {
    if (filterStatus !== "ALL" && d.status !== filterStatus) return false;
    if (filterCatalog !== "ALL" && d.catalog?.id !== filterCatalog) return false;
    return true;
  });

  const stats = {
    total: deliveries.length,
    planned: deliveries.filter((d) => d.status === "PLANIFIEE").length,
    inPrep: deliveries.filter((d) => d.status === "EN_PREPARATION").length,
    shipped: deliveries.filter((d) => d.status === "EXPEDIEE").length,
    totalPcs: deliveries.reduce((s, d) => s + d.totalQuantity, 0),
  };

  return (
    <div>
      <Topbar title="Livraisons" />
      <div className="p-8 space-y-6">
        <PageHeader
          title="Livraisons"
          description="Suivez les livraisons, gérez les statuts et exportez les fichiers EAN"
          action={
            sessions.length > 0 ? (
              <Select
                onValueChange={(v: string | null) => v && generateFromSession(v)}
              >
                <SelectTrigger className="w-[260px] gap-2" disabled={generating}>
                  <Plus className="h-4 w-4" />
                  <SelectValue
                    placeholder={
                      generating
                        ? "Génération..."
                        : "Générer depuis une session"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {sessions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {new Date(s.sessionDate).toLocaleDateString("fr-FR")} —{" "}
                      {s._count.lines} lignes
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : undefined
          }
        />

        {!activeSeason ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <p className="text-sm text-muted-foreground">
                Sélectionnez une saison pour voir les livraisons
              </p>
            </CardContent>
          </Card>
        ) : loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground animate-pulse">
              Chargement des livraisons...
            </p>
          </div>
        ) : deliveries.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
              <Truck className="h-12 w-12 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground text-center">
                Aucune livraison pour cette saison.
                <br />
                Validez une répartition puis générez les livraisons.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Stats */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold">{stats.total}</div>
                  <p className="text-sm text-muted-foreground">
                    Total livraisons
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold text-blue-600">
                    {stats.planned}
                  </div>
                  <p className="text-sm text-muted-foreground">Planifiées</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold text-amber-600">
                    {stats.inPrep}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    En préparation
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold text-emerald-600">
                    {stats.shipped}
                  </div>
                  <p className="text-sm text-muted-foreground">Expédiées</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold">
                    {formatNumber(stats.totalPcs)}
                  </div>
                  <p className="text-sm text-muted-foreground">Pièces total</p>
                </CardContent>
              </Card>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Statut :</span>
                {[
                  { value: "ALL", label: "Tout" },
                  { value: "PLANIFIEE", label: "Planifiées" },
                  { value: "EN_PREPARATION", label: "En préparation" },
                  { value: "EXPEDIEE", label: "Expédiées" },
                ].map((f) => (
                  <Button
                    key={f.value}
                    variant={filterStatus === f.value ? "default" : "outline"}
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => setFilterStatus(f.value)}
                  >
                    {f.label}
                  </Button>
                ))}
              </div>
              {catalogs.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Catalogue :</span>
                  <Select
                    value={filterCatalog}
                    onValueChange={(v: string | null) => v && setFilterCatalog(v)}
                  >
                    <SelectTrigger className="h-7 w-[220px] text-xs">
                      <SelectValue placeholder="Tous les catalogues" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">Tous les catalogues</SelectItem>
                      {catalogs.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} ({c.orderCount})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Delivery cards */}
            <div className="space-y-3">
              {filtered.map((delivery) => (
                <DeliveryCard
                  key={delivery.id}
                  delivery={delivery}
                  onStatusChange={updateStatus}
                  onExportEan={exportEan}
                />
              ))}
              {filtered.length === 0 && (
                <Card className="border-dashed">
                  <CardContent className="flex items-center justify-center py-12">
                    <p className="text-sm text-muted-foreground">
                      Aucune livraison avec ce filtre
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

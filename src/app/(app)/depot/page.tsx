"use client";

import { useEffect, useState, useCallback } from "react";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Warehouse,
  CheckCircle2,
  AlertTriangle,
  Package,
  Truck,
  ChevronDown,
  ChevronRight,
  Clock,
} from "lucide-react";
import { cn, formatNumber, parseSizeScale, type SizeQuantities } from "@/lib/utils";
import { toast } from "sonner";

interface DeliveryLine {
  id: string;
  reference: string;
  color: string;
  sizeScale: string;
  quantities: SizeQuantities;
  totalQuantity: number;
}

interface DepotDelivery {
  id: string;
  deliveryNumber: number;
  clientName: string;
  clientCode: string;
  status: string;
  colorCode: string;
  depotStatus: string | null;
  nbColis: number | null;
  nbPieces: number | null;
  blNumber: string | null;
  carrier: string | null;
  comment: string | null;
  sentToDepotAt: string | null;
  totalQuantity: number;
  lineCount: number;
  lines: DeliveryLine[];
}

function DepotStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const map: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
    EN_ATTENTE: {
      label: "En attente",
      icon: <Clock className="h-3 w-3" />,
      className: "bg-zinc-100 text-zinc-600",
    },
    RECU: {
      label: "Reçu",
      icon: <Package className="h-3 w-3" />,
      className: "bg-blue-100 text-blue-700",
    },
    VALIDE: {
      label: "Validé",
      icon: <CheckCircle2 className="h-3 w-3" />,
      className: "bg-emerald-100 text-emerald-700",
    },
    ANOMALIE: {
      label: "Anomalie",
      icon: <AlertTriangle className="h-3 w-3" />,
      className: "bg-red-100 text-red-700",
    },
  };
  const info = map[status] || { label: status, icon: null, className: "bg-zinc-100 text-zinc-600" };
  return (
    <Badge className={cn("gap-1", info.className)}>
      {info.icon}
      {info.label}
    </Badge>
  );
}

function DepotDeliveryCard({
  delivery,
  onValidate,
  onAnomaly,
  onUpdateColis,
}: {
  delivery: DepotDelivery;
  onValidate: (id: string) => void;
  onAnomaly: (id: string, comment: string) => void;
  onUpdateColis: (id: string, nbColis: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [anomalyComment, setAnomalyComment] = useState("");
  const [showAnomaly, setShowAnomaly] = useState(false);
  const [colisValue, setColisValue] = useState(
    delivery.nbColis != null ? String(delivery.nbColis) : ""
  );
  const sizes =
    delivery.lines.length > 0
      ? parseSizeScale(delivery.lines[0].sizeScale)
      : [];

  const isValidated = delivery.depotStatus === "VALIDE";
  const isAnomaly = delivery.depotStatus === "ANOMALIE";

  return (
    <Card
      className={cn(
        "overflow-hidden transition-all",
        isValidated && "opacity-60",
        isAnomaly && "ring-2 ring-red-300"
      )}
    >
      <div
        className="flex items-center gap-0"
        style={{ borderLeft: `4px solid ${delivery.colorCode}` }}
      >
        <div
          className="flex-1 flex items-center justify-between px-4 py-4 cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-3">
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold"
              style={{ backgroundColor: delivery.colorCode }}
            >
              {delivery.deliveryNumber}
            </div>
            <div>
              <div className="font-semibold">{delivery.clientName}</div>
              <div className="text-xs text-muted-foreground">
                {delivery.clientCode}
                {delivery.blNumber && ` · BL: ${delivery.blNumber}`}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm font-medium">
                {formatNumber(delivery.totalQuantity)} pcs
              </div>
              <div className="text-xs text-muted-foreground">
                {delivery.lineCount} réf.
              </div>
            </div>
            {delivery.nbColis != null && (
              <div className="text-right">
                <div className="text-sm font-medium">{delivery.nbColis}</div>
                <div className="text-xs text-muted-foreground">colis</div>
              </div>
            )}
            <DepotStatusBadge status={delivery.depotStatus} />
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t">
          {/* Actions */}
          {!isValidated && (
            <div className="px-4 py-3 bg-muted/30 space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground shrink-0">
                    Nb colis reçus :
                  </Label>
                  <Input
                    type="number"
                    className="h-8 w-20 text-sm"
                    value={colisValue}
                    onChange={(e) => setColisValue(e.target.value)}
                    onBlur={() => {
                      if (colisValue && parseInt(colisValue) >= 0) {
                        onUpdateColis(delivery.id, parseInt(colisValue));
                      }
                    }}
                  />
                </div>
                <div className="flex-1" />
                {!showAnomaly ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={() => setShowAnomaly(true)}
                    >
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Signaler anomalie
                    </Button>
                    <Button
                      size="sm"
                      className="gap-1 text-xs bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => onValidate(delivery.id)}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Valider la réception
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      className="h-8 text-xs flex-1"
                      placeholder="Décrivez l'anomalie..."
                      value={anomalyComment}
                      onChange={(e) => setAnomalyComment(e.target.value)}
                      autoFocus
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => setShowAnomaly(false)}
                    >
                      Annuler
                    </Button>
                    <Button
                      size="sm"
                      className="gap-1 text-xs bg-red-600 hover:bg-red-700"
                      onClick={() => {
                        onAnomaly(delivery.id, anomalyComment);
                        setShowAnomaly(false);
                        setAnomalyComment("");
                      }}
                    >
                      Confirmer
                    </Button>
                  </div>
                )}
              </div>

              {delivery.comment && (
                <div className="text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded p-2">
                  <span className="font-medium">Note :</span>{" "}
                  {delivery.comment}
                </div>
              )}
            </div>
          )}

          {/* Lines table */}
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
                        <TableCell key={size} className="text-center text-sm">
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

export default function DepotPage() {
  const [deliveries, setDeliveries] = useState<DepotDelivery[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>("ALL");

  const loadDeliveries = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch all deliveries with status ENVOYEE_DEPOT or VALIDEE_DEPOT
      const res = await fetch("/api/depot/deliveries");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setDeliveries(data.data || []);
    } catch {
      toast.error("Impossible de charger les livraisons");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDeliveries();
  }, [loadDeliveries]);

  const handleValidate = async (id: string) => {
    try {
      const res = await fetch(`/api/deliveries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          depotStatus: "VALIDE",
          status: "VALIDEE_DEPOT",
        }),
      });
      if (!res.ok) throw new Error("Erreur");
      toast.success("Livraison validée");
      loadDeliveries();
    } catch {
      toast.error("Échec de la validation");
    }
  };

  const handleAnomaly = async (id: string, comment: string) => {
    try {
      const res = await fetch(`/api/deliveries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          depotStatus: "ANOMALIE",
          comment: comment || "Anomalie signalée",
        }),
      });
      if (!res.ok) throw new Error("Erreur");
      toast.success("Anomalie signalée");
      loadDeliveries();
    } catch {
      toast.error("Échec du signalement");
    }
  };

  const handleUpdateColis = async (id: string, nbColis: number) => {
    try {
      const res = await fetch(`/api/deliveries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nbColis }),
      });
      if (!res.ok) throw new Error("Erreur");
    } catch {
      toast.error("Erreur mise à jour");
    }
  };

  const filtered = deliveries.filter((d) => {
    if (filter === "ALL") return true;
    return d.depotStatus === filter;
  });

  const stats = {
    total: deliveries.length,
    pending: deliveries.filter((d) => d.depotStatus === "EN_ATTENTE").length,
    validated: deliveries.filter((d) => d.depotStatus === "VALIDE").length,
    anomaly: deliveries.filter((d) => d.depotStatus === "ANOMALIE").length,
  };

  return (
    <div>
      <Topbar title="Vue dépôt" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="Vue dépôt"
          description="Validez les livraisons reçues et signalez les anomalies"
        />

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground animate-pulse">
              Chargement...
            </p>
          </div>
        ) : deliveries.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
              <Warehouse className="h-12 w-12 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground text-center">
                Aucune livraison en attente au dépôt
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Stats */}
            <div className="grid gap-4 sm:grid-cols-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold">{stats.total}</div>
                  <p className="text-sm text-muted-foreground">
                    Total au dépôt
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold text-amber-600">
                    {stats.pending}
                  </div>
                  <p className="text-sm text-muted-foreground">En attente</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold text-emerald-600">
                    {stats.validated}
                  </div>
                  <p className="text-sm text-muted-foreground">Validées</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold text-red-600">
                    {stats.anomaly}
                  </div>
                  <p className="text-sm text-muted-foreground">Anomalies</p>
                </CardContent>
              </Card>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2">
              {[
                { value: "ALL", label: "Tout" },
                { value: "EN_ATTENTE", label: "En attente" },
                { value: "VALIDE", label: "Validées" },
                { value: "ANOMALIE", label: "Anomalies" },
              ].map((f) => (
                <Button
                  key={f.value}
                  variant={filter === f.value ? "default" : "outline"}
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setFilter(f.value)}
                >
                  {f.label}
                </Button>
              ))}
            </div>

            {/* Cards */}
            <div className="space-y-3">
              {filtered.map((d) => (
                <DepotDeliveryCard
                  key={d.id}
                  delivery={d}
                  onValidate={handleValidate}
                  onAnomaly={handleAnomaly}
                  onUpdateColis={handleUpdateColis}
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

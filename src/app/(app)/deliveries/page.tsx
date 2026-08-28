"use client";

import { useEffect, useState, useCallback } from "react";
import { useSeason } from "@/lib/season-context";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
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
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Truck,
  Package,
  Download,
  FileSpreadsheet,
  ChevronDown,
  ChevronRight,
  Plus,
  Clock,
  Send,
  Warehouse,
  CheckCircle2,
  MessageSquare,
  PackageOpen,
  Layers,
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
  // New depot fields
  nbColis: number | null;
  nbPieces: number | null;
  blNumber: string | null;
  carrier: string | null;
  depotStatus: string | null;
  comment: string | null;
  sentToDepotAt: string | null;
  validatedAt: string | null;
  shipmentGroupId: string | null;
  shipmentGroupName: string | null;
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

interface ShipmentGroupEntry {
  id: string;
  name: string;
  carrier: string | null;
  _count: { deliveries: number };
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<
    string,
    { label: string; icon: React.ReactNode; className: string }
  > = {
    PLANIFIEE: {
      label: "Planifiée",
      icon: <Clock className="h-3 w-3" />,
      className: "bg-blue-100 text-blue-700 hover:bg-blue-100",
    },
    EN_PREPARATION: {
      label: "En préparation",
      icon: <Package className="h-3 w-3" />,
      className: "bg-amber-100 text-amber-700 hover:bg-amber-100",
    },
    ENVOYEE_DEPOT: {
      label: "Envoyée au dépôt",
      icon: <Warehouse className="h-3 w-3" />,
      className: "bg-purple-100 text-purple-700 hover:bg-purple-100",
    },
    VALIDEE_DEPOT: {
      label: "Validée dépôt",
      icon: <CheckCircle2 className="h-3 w-3" />,
      className: "bg-teal-100 text-teal-700 hover:bg-teal-100",
    },
    EXPEDIEE: {
      label: "Expédiée",
      icon: <Send className="h-3 w-3" />,
      className: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
    },
  };
  const info = map[status] || {
    label: status,
    icon: null,
    className: "bg-zinc-100 text-zinc-700",
  };
  return (
    <Badge className={cn("gap-1", info.className)}>
      {info.icon}
      {info.label}
    </Badge>
  );
}

function DepotStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const map: Record<string, { label: string; className: string }> = {
    EN_ATTENTE: { label: "En attente", className: "bg-zinc-100 text-zinc-600" },
    RECU: { label: "Reçu", className: "bg-blue-100 text-blue-700" },
    VALIDE: { label: "Validé", className: "bg-emerald-100 text-emerald-700" },
    ANOMALIE: { label: "Anomalie", className: "bg-red-100 text-red-700" },
  };
  const info = map[status] || { label: status, className: "bg-zinc-100 text-zinc-600" };
  return (
    <Badge variant="outline" className={cn("text-xs", info.className)}>
      {info.label}
    </Badge>
  );
}

function DeliveryCard({
  delivery,
  onUpdate,
  onExportEan,
  shipmentGroups,
}: {
  delivery: DeliveryData;
  onUpdate: (id: string, data: Record<string, unknown>) => Promise<void>;
  onExportEan: (id: string) => void;
  shipmentGroups: ShipmentGroupEntry[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [fieldValue, setFieldValue] = useState("");
  const sizes =
    delivery.lines.length > 0
      ? parseSizeScale(delivery.lines[0].sizeScale)
      : [];

  const saveField = async (field: string, value: unknown) => {
    await onUpdate(delivery.id, { [field]: value });
    setEditingField(null);
  };

  const canSendToDepot =
    delivery.status === "EN_PREPARATION" && delivery.eanExportGenerated;

  const handleSendToDepot = async () => {
    await onUpdate(delivery.id, {
      status: "ENVOYEE_DEPOT",
      depotStatus: "EN_ATTENTE",
    });
  };

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
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">
                  {delivery.clientName}
                </span>
                <span className="text-muted-foreground text-xs">
                  ({delivery.clientCode})
                </span>
                {delivery.shipmentGroupName && (
                  <Badge
                    variant="outline"
                    className="text-xs gap-1 border-indigo-300 text-indigo-700"
                  >
                    <Layers className="h-3 w-3" />
                    {delivery.shipmentGroupName}
                  </Badge>
                )}
              </div>
              {delivery.blNumber && (
                <span className="text-xs text-muted-foreground">
                  BL: {delivery.blNumber}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {delivery.nbColis != null && (
              <span className="text-xs text-muted-foreground">
                {delivery.nbColis} colis
              </span>
            )}
            <span className="text-sm text-muted-foreground">
              {delivery.lineCount} réf. ·{" "}
              {formatNumber(delivery.totalQuantity)} pcs
            </span>
            <StatusBadge status={delivery.status} />
            <DepotStatusBadge status={delivery.depotStatus} />
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t">
          <div className="px-4 py-3 bg-muted/30 space-y-3">
            {/* Top row: dates + actions */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                <span>
                  Créée le{" "}
                  {new Date(delivery.createdAt).toLocaleDateString("fr-FR")}
                </span>
                {delivery.sentToDepotAt && (
                  <span>
                    Envoyée dépôt :{" "}
                    {new Date(delivery.sentToDepotAt).toLocaleDateString(
                      "fr-FR"
                    )}
                  </span>
                )}
                {delivery.validatedAt && (
                  <span>
                    Validée :{" "}
                    {new Date(delivery.validatedAt).toLocaleDateString("fr-FR")}
                  </span>
                )}
                {delivery.shippedAt && (
                  <span>
                    Expédiée :{" "}
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
                {canSendToDepot && (
                  <Button
                    variant="default"
                    size="sm"
                    className="h-8 gap-1 text-xs bg-purple-600 hover:bg-purple-700"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSendToDepot();
                    }}
                  >
                    <Warehouse className="h-3 w-3" />
                    Envoyer au dépôt
                  </Button>
                )}
                {delivery.status !== "EXPEDIEE" && (
                  <Select
                    value={delivery.status}
                    onValueChange={(v) =>
                      v && onUpdate(delivery.id, { status: v })
                    }
                  >
                    <SelectTrigger className="h-8 w-[180px] text-xs">
                      <span className="text-xs truncate">
                        {{ PLANIFIEE: "Planifiée", EN_PREPARATION: "En préparation", ENVOYEE_DEPOT: "Envoyée au dépôt", VALIDEE_DEPOT: "Validée dépôt", EXPEDIEE: "Expédiée" }[delivery.status] || delivery.status}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PLANIFIEE">Planifiée</SelectItem>
                      <SelectItem value="EN_PREPARATION">
                        En préparation
                      </SelectItem>
                      <SelectItem value="ENVOYEE_DEPOT">
                        Envoyée au dépôt
                      </SelectItem>
                      <SelectItem value="VALIDEE_DEPOT">
                        Validée dépôt
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

            {/* Editable depot fields */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {/* BL Number */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">N° BL</Label>
                {editingField === "blNumber" ? (
                  <div className="flex gap-1">
                    <Input
                      className="h-7 text-xs"
                      value={fieldValue}
                      onChange={(e) => setFieldValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          saveField("blNumber", fieldValue || null);
                        if (e.key === "Escape") setEditingField(null);
                      }}
                      autoFocus
                    />
                    <Button
                      size="sm"
                      className="h-7 text-xs px-2"
                      onClick={() =>
                        saveField("blNumber", fieldValue || null)
                      }
                    >
                      OK
                    </Button>
                  </div>
                ) : (
                  <button
                    className="text-sm text-left w-full px-2 py-1 rounded hover:bg-accent transition-colors"
                    onClick={() => {
                      setFieldValue(delivery.blNumber || "");
                      setEditingField("blNumber");
                    }}
                  >
                    {delivery.blNumber || (
                      <span className="text-muted-foreground italic">
                        Non renseigné
                      </span>
                    )}
                  </button>
                )}
              </div>

              {/* Nb colis */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Nb colis
                </Label>
                {editingField === "nbColis" ? (
                  <div className="flex gap-1">
                    <Input
                      type="number"
                      className="h-7 text-xs"
                      value={fieldValue}
                      onChange={(e) => setFieldValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          saveField(
                            "nbColis",
                            fieldValue ? parseInt(fieldValue) : null
                          );
                        if (e.key === "Escape") setEditingField(null);
                      }}
                      autoFocus
                    />
                    <Button
                      size="sm"
                      className="h-7 text-xs px-2"
                      onClick={() =>
                        saveField(
                          "nbColis",
                          fieldValue ? parseInt(fieldValue) : null
                        )
                      }
                    >
                      OK
                    </Button>
                  </div>
                ) : (
                  <button
                    className="text-sm text-left w-full px-2 py-1 rounded hover:bg-accent transition-colors"
                    onClick={() => {
                      setFieldValue(
                        delivery.nbColis != null
                          ? String(delivery.nbColis)
                          : ""
                      );
                      setEditingField("nbColis");
                    }}
                  >
                    {delivery.nbColis != null ? (
                      delivery.nbColis
                    ) : (
                      <span className="text-muted-foreground italic">—</span>
                    )}
                  </button>
                )}
              </div>

              {/* Transporteur */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Transporteur
                </Label>
                {editingField === "carrier" ? (
                  <div className="flex gap-1">
                    <Input
                      className="h-7 text-xs"
                      value={fieldValue}
                      onChange={(e) => setFieldValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          saveField("carrier", fieldValue || null);
                        if (e.key === "Escape") setEditingField(null);
                      }}
                      autoFocus
                    />
                    <Button
                      size="sm"
                      className="h-7 text-xs px-2"
                      onClick={() =>
                        saveField("carrier", fieldValue || null)
                      }
                    >
                      OK
                    </Button>
                  </div>
                ) : (
                  <button
                    className="text-sm text-left w-full px-2 py-1 rounded hover:bg-accent transition-colors"
                    onClick={() => {
                      setFieldValue(delivery.carrier || "");
                      setEditingField("carrier");
                    }}
                  >
                    {delivery.carrier || (
                      <span className="text-muted-foreground italic">—</span>
                    )}
                  </button>
                )}
              </div>

              {/* Groupe d'envoi */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Groupe d&apos;envoi
                </Label>
                <Select
                  value={delivery.shipmentGroupId || "NONE"}
                  onValueChange={(v) =>
                    onUpdate(delivery.id, {
                      shipmentGroupId: v === "NONE" ? null : v,
                    })
                  }
                >
                  <SelectTrigger className="h-7 text-xs">
                    <span className={`text-xs truncate ${!delivery.shipmentGroupId ? "text-muted-foreground" : ""}`}>
                      {delivery.shipmentGroupId
                        ? shipmentGroups.find((g) => g.id === delivery.shipmentGroupId)?.name || "Groupe"
                        : "Aucun"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Aucun</SelectItem>
                    {shipmentGroups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Comment */}
            {(delivery.comment || editingField === "comment") && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" />
                  Commentaire
                </Label>
                {editingField === "comment" ? (
                  <div className="flex gap-1">
                    <Input
                      className="h-7 text-xs flex-1"
                      value={fieldValue}
                      onChange={(e) => setFieldValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          saveField("comment", fieldValue || null);
                        if (e.key === "Escape") setEditingField(null);
                      }}
                      autoFocus
                    />
                    <Button
                      size="sm"
                      className="h-7 text-xs px-2"
                      onClick={() =>
                        saveField("comment", fieldValue || null)
                      }
                    >
                      OK
                    </Button>
                  </div>
                ) : (
                  <button
                    className="text-sm text-left w-full px-2 py-1 rounded hover:bg-accent transition-colors"
                    onClick={() => {
                      setFieldValue(delivery.comment || "");
                      setEditingField("comment");
                    }}
                  >
                    {delivery.comment}
                  </button>
                )}
              </div>
            )}
            {!delivery.comment && editingField !== "comment" && (
              <button
                className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                onClick={() => {
                  setFieldValue("");
                  setEditingField("comment");
                }}
              >
                <Plus className="h-3 w-3" />
                Ajouter un commentaire
              </button>
            )}
          </div>

          {/* Product lines table */}
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

function CreateShipmentGroupDialog({
  onCreated,
}: {
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [carrier, setCarrier] = useState("");
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/shipment-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), carrier: carrier.trim() || undefined }),
      });
      if (!res.ok) throw new Error("Erreur création");
      toast.success("Groupe créé");
      setOpen(false);
      setName("");
      setCarrier("");
      onCreated();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1 text-xs"
        onClick={() => setOpen(true)}
      >
        <Layers className="h-3.5 w-3.5" />
        Nouveau groupe d&apos;envoi
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Créer un groupe d&apos;envoi</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nom du groupe</Label>
              <Input
                placeholder="ex: PAMAZO S22"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Transporteur (optionnel)</Label>
              <Input
                placeholder="ex: Chronopost"
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleCreate} disabled={!name.trim() || saving}>
              {saving ? "Création..." : "Créer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function DeliveriesPage() {
  const { activeSeason } = useSeason();
  const [deliveries, setDeliveries] = useState<DeliveryData[]>([]);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [catalogs, setCatalogs] = useState<CatalogEntry[]>([]);
  const [shipmentGroups, setShipmentGroups] = useState<ShipmentGroupEntry[]>(
    []
  );
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [filterCatalog, setFilterCatalog] = useState<string>("ALL");

  const loadDeliveries = useCallback(async () => {
    if (!activeSeason) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/deliveries?seasonId=${activeSeason.id}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setDeliveries(data.data || []);
    } catch {
      toast.error("Impossible de charger les livraisons");
    } finally {
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

  const loadShipmentGroups = useCallback(async () => {
    try {
      const res = await fetch("/api/shipment-groups");
      const data = await res.json();
      setShipmentGroups(data.data || []);
    } catch {}
  }, []);

  useEffect(() => {
    setDeliveries([]);
    setSessions([]);
    setCatalogs([]);
    setFilterCatalog("ALL");
    loadDeliveries();
    loadSessions();
    loadCatalogs();
    loadShipmentGroups();
  }, [
    activeSeason,
    loadDeliveries,
    loadSessions,
    loadCatalogs,
    loadShipmentGroups,
  ]);

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

  const updateDelivery = async (
    deliveryId: string,
    data: Record<string, unknown>
  ) => {
    try {
      const res = await fetch(`/api/deliveries/${deliveryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Erreur mise à jour");
      toast.success("Livraison mise à jour");
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
    if (filterCatalog !== "ALL" && d.catalog?.id !== filterCatalog)
      return false;
    return true;
  });

  const stats = {
    total: deliveries.length,
    planned: deliveries.filter((d) => d.status === "PLANIFIEE").length,
    inPrep: deliveries.filter((d) => d.status === "EN_PREPARATION").length,
    atDepot: deliveries.filter(
      (d) => d.status === "ENVOYEE_DEPOT" || d.status === "VALIDEE_DEPOT"
    ).length,
    shipped: deliveries.filter((d) => d.status === "EXPEDIEE").length,
    totalPcs: deliveries.reduce((s, d) => s + d.totalQuantity, 0),
  };

  return (
    <div>
      <Topbar title="Préparation" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="Préparation"
          description="Gérez le flux de préparation : envoi au dépôt, expédition et export EAN"
          action={
            <div className="flex items-center gap-2">
              <CreateShipmentGroupDialog
                onCreated={loadShipmentGroups}
              />
              {sessions.length > 0 && (
                <Select
                  onValueChange={(v: string | null) =>
                    v && generateFromSession(v)
                  }
                >
                  <SelectTrigger
                    className="w-[260px] gap-2"
                    disabled={generating}
                  >
                    <Plus className="h-4 w-4" />
                    <span className="text-sm text-muted-foreground truncate">
                      {generating ? "Génération..." : "Générer depuis une session"}
                    </span>
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
              )}
            </div>
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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
              <Card>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.total}</div>
                  <p className="text-sm text-muted-foreground">Total</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent>
                  <div className="text-2xl font-bold text-blue-600">
                    {stats.planned}
                  </div>
                  <p className="text-sm text-muted-foreground">Planifiées</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent>
                  <div className="text-2xl font-bold text-amber-600">
                    {stats.inPrep}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    En préparation
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent>
                  <div className="text-2xl font-bold text-purple-600">
                    {stats.atDepot}
                  </div>
                  <p className="text-sm text-muted-foreground">Au dépôt</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent>
                  <div className="text-2xl font-bold text-emerald-600">
                    {stats.shipped}
                  </div>
                  <p className="text-sm text-muted-foreground">Expédiées</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {formatNumber(stats.totalPcs)}
                  </div>
                  <p className="text-sm text-muted-foreground">Pièces</p>
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
                  { value: "EN_PREPARATION", label: "En prép." },
                  { value: "ENVOYEE_DEPOT", label: "Au dépôt" },
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
                  <span className="text-sm text-muted-foreground">
                    Catalogue :
                  </span>
                  <Select
                    value={filterCatalog}
                    onValueChange={(v: string | null) =>
                      v && setFilterCatalog(v)
                    }
                  >
                    <SelectTrigger className="h-7 w-[220px] text-xs">
                      <span className="text-xs truncate">
                        {filterCatalog === "ALL"
                          ? "Tous les catalogues"
                          : catalogs.find((c) => c.id === filterCatalog)?.name || "Tous"}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">
                        Tous les catalogues
                      </SelectItem>
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
                  onUpdate={updateDelivery}
                  onExportEan={exportEan}
                  shipmentGroups={shipmentGroups}
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

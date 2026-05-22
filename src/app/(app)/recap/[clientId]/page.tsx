"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useSeason } from "@/lib/season-context";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  Package,
  Truck,
  AlertCircle,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { cn, formatNumber, parseSizeScale } from "@/lib/utils";
import Link from "next/link";

interface ComparisonLine {
  productId: string;
  reference: string;
  color: string;
  sizeScale: string;
  category: string | null;
  ordered: Record<string, number>;
  orderedTotal: number;
  delivered: Record<string, number>;
  deliveredTotal: number;
  diff: Record<string, number>;
  remainingTotal: number;
  status: string;
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  orderType: string;
  status: string;
  catalogName: string | null;
  clientName: string;
  clientCode: string;
  tioOrderNumber: string | null;
  paymentStatus: string;
  deliveryWindow: string | null;
  totalAmount: number | null;
  createdAt: string;
  comparison: ComparisonLine[];
  summary: {
    totalProducts: number;
    totalOrdered: number;
    totalDelivered: number;
    totalRemaining: number;
    fullyDelivered: number;
    partiallyDelivered: number;
    notDelivered: number;
  };
}

interface ClientOrder {
  id: string;
  orderNumber: string;
  orderType: string;
  status: string;
  catalogName: string | null;
  totalOrdered: number;
  tioOrderNumber: string | null;
}

function LineStatusBadge({ status }: { status: string }) {
  if (status === "COMPLET")
    return (
      <Badge className="bg-emerald-100 text-emerald-700 gap-1 text-xs">
        <CheckCircle2 className="h-3 w-3" />
        Complet
      </Badge>
    );
  if (status === "PARTIEL")
    return (
      <Badge className="bg-amber-100 text-amber-700 gap-1 text-xs">
        <Clock className="h-3 w-3" />
        Partiel
      </Badge>
    );
  return (
    <Badge className="bg-red-100 text-red-700 gap-1 text-xs">
      <AlertCircle className="h-3 w-3" />
      Non livré
    </Badge>
  );
}

export default function ClientRecapDetailPage() {
  const params = useParams();
  const clientId = params.clientId as string;
  const { activeSeason } = useSeason();
  const [orders, setOrders] = useState<ClientOrder[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadOrders = useCallback(async () => {
    if (!activeSeason) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/recap?seasonId=${activeSeason.id}`);
      const data = await res.json();
      const client = (data.data || []).find(
        (c: { clientId: string }) => c.clientId === clientId
      );
      if (client) {
        setOrders(client.orders);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [activeSeason, clientId]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const loadOrderDetail = async (orderId: string) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      const data = await res.json();
      setSelectedOrder(data.data || null);
    } catch {
    } finally {
      setLoadingDetail(false);
    }
  };

  const allSizes = selectedOrder
    ? Array.from(
        new Set(
          selectedOrder.comparison.flatMap((c) => parseSizeScale(c.sizeScale))
        )
      )
    : [];

  return (
    <div>
      <Topbar title="Détail client" />
      <div className="p-8 space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/recap">
            <Button variant="ghost" size="sm" className="gap-1">
              <ArrowLeft className="h-4 w-4" />
              Retour
            </Button>
          </Link>
        </div>

        <PageHeader
          title={
            selectedOrder
              ? `${selectedOrder.clientName} — Commande ${selectedOrder.orderNumber}`
              : "Détail commande"
          }
          description="Comparaison commandé vs livré, avec mise en évidence des écarts"
        />

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground animate-pulse">
              Chargement...
            </p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
            {/* Order list sidebar */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground mb-3">
                Commandes
              </h3>
              {orders.map((o) => (
                <button
                  key={o.id}
                  onClick={() => loadOrderDetail(o.id)}
                  className={cn(
                    "w-full text-left rounded-lg border p-3 transition-all hover:bg-accent",
                    selectedOrder?.id === o.id &&
                      "ring-2 ring-primary bg-primary/5"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-medium">
                      {o.orderNumber}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-xs",
                        o.orderType === "VSS"
                          ? "border-purple-300 text-purple-700"
                          : ""
                      )}
                    >
                      {o.orderType}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-muted-foreground">
                      {o.catalogName || "—"}
                    </span>
                    <span className="text-xs font-medium">
                      {formatNumber(o.totalOrdered)} pcs
                    </span>
                  </div>
                  {o.tioOrderNumber && (
                    <div className="text-xs text-muted-foreground mt-1">
                      TIO: {o.tioOrderNumber}
                    </div>
                  )}
                </button>
              ))}
              {orders.length === 0 && (
                <p className="text-sm text-muted-foreground italic">
                  Aucune commande
                </p>
              )}
            </div>

            {/* Order detail */}
            <div>
              {loadingDetail ? (
                <div className="flex items-center justify-center py-16">
                  <p className="text-sm text-muted-foreground animate-pulse">
                    Chargement...
                  </p>
                </div>
              ) : selectedOrder ? (
                <div className="space-y-6">
                  {/* Summary cards */}
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Card>
                      <CardContent className="pt-6">
                        <div className="flex items-center gap-2 mb-1">
                          <Package className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">
                            Commandé
                          </span>
                        </div>
                        <div className="text-2xl font-bold">
                          {formatNumber(selectedOrder.summary.totalOrdered)}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-6">
                        <div className="flex items-center gap-2 mb-1">
                          <Truck className="h-4 w-4 text-emerald-500" />
                          <span className="text-sm text-muted-foreground">
                            Livré
                          </span>
                        </div>
                        <div className="text-2xl font-bold text-emerald-600">
                          {formatNumber(selectedOrder.summary.totalDelivered)}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-6">
                        <div className="text-sm text-muted-foreground mb-1">
                          Reste à livrer
                        </div>
                        <div className="text-2xl font-bold text-amber-600">
                          {formatNumber(selectedOrder.summary.totalRemaining)}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-6">
                        <div className="text-sm text-muted-foreground mb-1">
                          Taux livraison
                        </div>
                        <div className="text-2xl font-bold">
                          {selectedOrder.summary.totalOrdered > 0
                            ? Math.round(
                                (selectedOrder.summary.totalDelivered /
                                  selectedOrder.summary.totalOrdered) *
                                  100
                              )
                            : 0}
                          %
                        </div>
                        <Progress
                          value={
                            selectedOrder.summary.totalOrdered > 0
                              ? (selectedOrder.summary.totalDelivered /
                                  selectedOrder.summary.totalOrdered) *
                                100
                              : 0
                          }
                          className="h-2 mt-2"
                        />
                      </CardContent>
                    </Card>
                  </div>

                  {/* Legend */}
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-300" />
                      Complet ({selectedOrder.summary.fullyDelivered})
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded bg-amber-100 border border-amber-300" />
                      Partiel ({selectedOrder.summary.partiallyDelivered})
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded bg-red-100 border border-red-300" />
                      Non livré ({selectedOrder.summary.notDelivered})
                    </div>
                  </div>

                  {/* Comparison table */}
                  <Card>
                    <ScrollArea className="max-h-[600px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="sticky left-0 bg-card z-10 w-[100px]">
                              Référence
                            </TableHead>
                            <TableHead className="w-[80px]">Couleur</TableHead>
                            {allSizes.map((s) => (
                              <TableHead
                                key={s}
                                className="text-center w-[60px]"
                              >
                                <div className="text-xs">{s}</div>
                              </TableHead>
                            ))}
                            <TableHead className="text-right w-[80px]">
                              Commandé
                            </TableHead>
                            <TableHead className="text-right w-[80px]">
                              Livré
                            </TableHead>
                            <TableHead className="w-[90px]">Statut</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedOrder.comparison.map((line) => {
                            const lineSizes = parseSizeScale(line.sizeScale);
                            const useSizes =
                              allSizes.length > 0 ? allSizes : lineSizes;
                            return (
                              <TableRow
                                key={line.productId}
                                className={cn(
                                  line.status === "NON_LIVRE" &&
                                    "bg-red-50/50",
                                  line.status === "PARTIEL" &&
                                    "bg-amber-50/30"
                                )}
                              >
                                <TableCell className="sticky left-0 bg-inherit font-mono text-sm">
                                  {line.reference}
                                </TableCell>
                                <TableCell className="text-sm">
                                  {line.color}
                                </TableCell>
                                {useSizes.map((size) => {
                                  const ordered = line.ordered[size] || 0;
                                  const delivered = line.delivered[size] || 0;
                                  const diff = delivered - ordered;
                                  const isShort = ordered > 0 && delivered < ordered;
                                  const isCancelled = ordered > 0 && delivered === 0;

                                  return (
                                    <TableCell
                                      key={size}
                                      className={cn(
                                        "text-center text-xs p-1",
                                        isCancelled &&
                                          "bg-red-100 text-red-700 font-medium",
                                        isShort &&
                                          !isCancelled &&
                                          "bg-amber-100 text-amber-700"
                                      )}
                                    >
                                      {ordered > 0 ? (
                                        <div>
                                          <div className="font-medium">
                                            {delivered}
                                          </div>
                                          <div className="text-[10px] text-muted-foreground line-through">
                                            {ordered}
                                          </div>
                                        </div>
                                      ) : delivered > 0 ? (
                                        <span className="text-emerald-600 font-medium">
                                          +{delivered}
                                        </span>
                                      ) : (
                                        "—"
                                      )}
                                    </TableCell>
                                  );
                                })}
                                <TableCell className="text-right text-sm font-medium">
                                  {formatNumber(line.orderedTotal)}
                                </TableCell>
                                <TableCell
                                  className={cn(
                                    "text-right text-sm font-medium",
                                    line.deliveredTotal < line.orderedTotal
                                      ? "text-amber-600"
                                      : "text-emerald-600"
                                  )}
                                >
                                  {formatNumber(line.deliveredTotal)}
                                </TableCell>
                                <TableCell>
                                  <LineStatusBadge status={line.status} />
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </Card>
                </div>
              ) : (
                <Card className="border-dashed">
                  <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
                    <Package className="h-12 w-12 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">
                      Sélectionnez une commande pour voir la comparaison
                      commandé vs livré
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

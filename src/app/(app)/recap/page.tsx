"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSeason } from "@/lib/season-context";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Users,
  Package,
  Truck,
  TrendingUp,
  Search,
  ChevronDown,
  ChevronRight,
  FileText,
  ClipboardList,
  ExternalLink,
} from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";

interface OrderEntry {
  id: string;
  orderNumber: string;
  orderType: string;
  status: string;
  catalogName: string | null;
  totalOrdered: number;
  paymentStatus: string;
  tioOrderNumber: string | null;
}

interface DeliveryEntry {
  id: string;
  deliveryNumber: number;
  status: string;
  colorCode: string;
  totalQuantity: number;
  shippedAt: string | null;
  createdAt: string;
}

interface ClientRecap {
  clientId: string;
  clientName: string;
  clientCode: string;
  ranking: number;
  orders: OrderEntry[];
  totalOrdered: number;
  totalDelivered: number;
  totalRemaining: number;
  deliveryCount: number;
  deliveries: DeliveryEntry[];
}

interface RecapStats {
  totalClients: number;
  totalOrdered: number;
  totalDelivered: number;
  totalRemaining: number;
  totalDeliveries: number;
}

function OrderStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    EN_COURS: { label: "En cours", className: "bg-blue-100 text-blue-700" },
    VALIDEE: { label: "Validée", className: "bg-emerald-100 text-emerald-700" },
    SOLDEE: { label: "Soldée", className: "bg-zinc-100 text-zinc-600" },
    ANNULEE: { label: "Annulée", className: "bg-red-100 text-red-700" },
  };
  const info = map[status] || { label: status, className: "bg-zinc-100 text-zinc-600" };
  return <Badge className={cn("text-xs", info.className)}>{info.label}</Badge>;
}

function PaymentBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    EN_ATTENTE: { label: "En attente", className: "bg-amber-100 text-amber-700" },
    VALIDE: { label: "Validé", className: "bg-emerald-100 text-emerald-700" },
    REFUSE: { label: "Refusé", className: "bg-red-100 text-red-700" },
  };
  const info = map[status] || { label: status, className: "bg-zinc-100 text-zinc-600" };
  return (
    <Badge variant="outline" className={cn("text-xs", info.className)}>
      {info.label}
    </Badge>
  );
}

function DeliveryStatusDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    PLANIFIEE: "bg-blue-500",
    EN_PREPARATION: "bg-amber-500",
    ENVOYEE_DEPOT: "bg-purple-500",
    VALIDEE_DEPOT: "bg-teal-500",
    EXPEDIEE: "bg-emerald-500",
  };
  return <span className={cn("inline-block w-2 h-2 rounded-full", map[status] || "bg-zinc-400")} />;
}

function ClientRecapCard({ client }: { client: ClientRecap }) {
  const [expanded, setExpanded] = useState(false);
  const deliveryPercent =
    client.totalOrdered > 0
      ? Math.round((client.totalDelivered / client.totalOrdered) * 100)
      : 0;

  return (
    <Card className="overflow-hidden">
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-4">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{client.clientName}</span>
              <span className="text-xs text-muted-foreground">
                ({client.clientCode})
              </span>
              <Badge variant="outline" className="text-xs">
                Rang {client.ranking}
              </Badge>
            </div>
            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <ClipboardList className="h-3 w-3" />
                {client.orders.length} commande(s)
              </span>
              <span className="flex items-center gap-1">
                <Truck className="h-3 w-3" />
                {client.deliveryCount} livraison(s)
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Commandé</div>
            <div className="font-semibold text-sm">
              {formatNumber(client.totalOrdered)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Livré</div>
            <div className="font-semibold text-sm text-emerald-600">
              {formatNumber(client.totalDelivered)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Reste</div>
            <div
              className={cn(
                "font-semibold text-sm",
                client.totalRemaining > 0 ? "text-amber-600" : "text-zinc-400"
              )}
            >
              {formatNumber(client.totalRemaining)}
            </div>
          </div>
          <div className="w-24">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">Taux</span>
              <span className="font-medium">{deliveryPercent}%</span>
            </div>
            <Progress value={deliveryPercent} className="h-2" />
          </div>
          <Link
            href={`/recap/${client.clientId}`}
            onClick={(e) => e.stopPropagation()}
          >
            <Button variant="ghost" size="sm" className="gap-1 text-xs text-muted-foreground">
              <ExternalLink className="h-3 w-3" />
              Détail
            </Button>
          </Link>
        </div>
      </div>

      {expanded && (
        <div className="border-t">
          {/* Orders section */}
          <div className="px-5 py-3 bg-muted/30">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <FileText className="h-3 w-3" />
              Commandes
            </h4>
            {client.orders.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                Aucune commande
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">N° commande</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Catalogue</TableHead>
                    <TableHead className="text-xs">TIO</TableHead>
                    <TableHead className="text-xs">Statut</TableHead>
                    <TableHead className="text-xs">Paiement</TableHead>
                    <TableHead className="text-xs text-right">
                      Quantité
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {client.orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="text-sm font-mono">
                        {o.orderNumber}
                      </TableCell>
                      <TableCell>
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
                      </TableCell>
                      <TableCell className="text-sm">
                        {o.catalogName || "—"}
                      </TableCell>
                      <TableCell className="text-sm font-mono">
                        {o.tioOrderNumber || "—"}
                      </TableCell>
                      <TableCell>
                        <OrderStatusBadge status={o.status} />
                      </TableCell>
                      <TableCell>
                        <PaymentBadge status={o.paymentStatus} />
                      </TableCell>
                      <TableCell className="text-sm text-right font-medium">
                        {formatNumber(o.totalOrdered)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {/* Deliveries section */}
          <div className="px-5 py-3">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Truck className="h-3 w-3" />
              Livraisons
            </h4>
            {client.deliveries.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                Aucune livraison
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {client.deliveries.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center gap-3 rounded-lg border p-3"
                    style={{ borderLeftColor: d.colorCode, borderLeftWidth: 3 }}
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                      style={{ backgroundColor: d.colorCode }}
                    >
                      {d.deliveryNumber}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <DeliveryStatusDot status={d.status} />
                        <span className="text-xs capitalize">
                          {d.status.toLowerCase().replace(/_/g, " ")}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {formatNumber(d.totalQuantity)} pcs ·{" "}
                        {new Date(d.createdAt).toLocaleDateString("fr-FR")}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

export default function RecapPage() {
  const { activeSeason } = useSeason();
  const [clients, setClients] = useState<ClientRecap[]>([]);
  const [stats, setStats] = useState<RecapStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!activeSeason) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/recap?seasonId=${activeSeason.id}`);
      const data = await res.json();
      setClients(data.data || []);
      setStats(data.stats || null);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [activeSeason]);

  useEffect(() => {
    setClients([]);
    setStats(null);
    load();
  }, [activeSeason, load]);

  const filtered = clients.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.clientName.toLowerCase().includes(q) ||
      c.clientCode.toLowerCase().includes(q)
    );
  });

  const deliveryRate =
    stats && stats.totalOrdered > 0
      ? Math.round((stats.totalDelivered / stats.totalOrdered) * 100)
      : 0;

  return (
    <div>
      <Topbar title="Récapitulatif clients" />
      <div className="p-8 space-y-6">
        <PageHeader
          title="Récapitulatif clients"
          description="Vue d'ensemble par client : commandes, livraisons et solde restant"
        />

        {!activeSeason ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <p className="text-sm text-muted-foreground">
                Sélectionnez une saison
              </p>
            </CardContent>
          </Card>
        ) : loading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground animate-pulse">
              Chargement...
            </p>
          </div>
        ) : (
          <>
            {/* Global stats */}
            {stats && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Clients
                      </span>
                    </div>
                    <div className="text-2xl font-bold mt-1">
                      {stats.totalClients}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Total commandé
                      </span>
                    </div>
                    <div className="text-2xl font-bold mt-1">
                      {formatNumber(stats.totalOrdered)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2">
                      <Truck className="h-4 w-4 text-emerald-500" />
                      <span className="text-sm text-muted-foreground">
                        Total livré
                      </span>
                    </div>
                    <div className="text-2xl font-bold mt-1 text-emerald-600">
                      {formatNumber(stats.totalDelivered)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-amber-500" />
                      <span className="text-sm text-muted-foreground">
                        Reste à livrer
                      </span>
                    </div>
                    <div className="text-2xl font-bold mt-1 text-amber-600">
                      {formatNumber(stats.totalRemaining)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-sm text-muted-foreground">
                      Taux de livraison
                    </div>
                    <div className="text-2xl font-bold mt-1">{deliveryRate}%</div>
                    <Progress value={deliveryRate} className="h-2 mt-2" />
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Search */}
            <div className="relative max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher un client..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>

            {/* Client cards */}
            <div className="space-y-3">
              {filtered.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="flex items-center justify-center py-12">
                    <p className="text-sm text-muted-foreground">
                      {clients.length === 0
                        ? "Aucun client pour cette saison"
                        : "Aucun résultat pour cette recherche"}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                filtered.map((client) => (
                  <ClientRecapCard key={client.clientId} client={client} />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

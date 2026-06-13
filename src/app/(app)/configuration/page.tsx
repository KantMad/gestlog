"use client";

import { useEffect, useState, useCallback } from "react";
import { useSeason, formatSeasonLabel } from "@/lib/season-context";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { ClientConfigTable } from "@/components/configuration/client-config-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users } from "lucide-react";
import type { ClientWithSeason } from "@/lib/types";

export default function ConfigurationPage() {
  const { activeSeason } = useSeason();
  const [clients, setClients] = useState<ClientWithSeason[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchClients = useCallback(() => {
    if (!activeSeason) {
      setClients([]);
      return;
    }
    setLoading(true);
    fetch(`/api/clients?seasonId=${activeSeason.id}`)
      .then((res) => res.json())
      .then((data) => setClients(data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeSeason]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const activeCount = clients.filter((c) => c.season?.isActive).length;

  return (
    <div>
      <Topbar title="Configuration" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-8">
        <PageHeader
          title="Configuration"
          description="Gérez le ranking et les seuils de répartition pour chaque client"
        />

        {!activeSeason ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <p className="text-sm text-muted-foreground">
                Sélectionnez une saison pour configurer les clients
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Clients — {formatSeasonLabel(activeSeason)}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {clients.length} client{clients.length > 1 ? "s" : ""}
                  </Badge>
                  <Badge variant="outline">
                    {activeCount} actif{activeCount > 1 ? "s" : ""}
                  </Badge>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Cliquez sur une valeur pour la modifier. Les changements sont
                sauvegardés automatiquement.
              </p>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <p className="text-sm text-muted-foreground animate-pulse">
                    Chargement...
                  </p>
                </div>
              ) : (
                <ClientConfigTable
                  clients={clients}
                  onUpdate={fetchClients}
                />
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

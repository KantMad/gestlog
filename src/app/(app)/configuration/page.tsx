"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSeason, formatSeasonLabel } from "@/lib/season-context";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { ClientConfigTable } from "@/components/configuration/client-config-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, HelpCircle, X } from "lucide-react";
import type { ClientWithSeason } from "@/lib/types";

// Bouton d'aide (?) + popover expliquant la répartition (rang, %, seuils…).
function ConfigHelp() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Aide sur la configuration de la répartition"
        className="flex h-8 w-8 items-center justify-center rounded-full border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <HelpCircle className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(92vw,480px)] rounded-lg border bg-popover p-4 text-sm shadow-lg">
          <div className="mb-2 flex items-start justify-between gap-2">
            <p className="font-semibold">Répartition — comment ça marche</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fermer"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mb-3 text-muted-foreground">
            Ces réglages pilotent la <strong>répartition automatique</strong> quand le stock reçu
            ne suffit pas à honorer toutes les commandes. Ils sont définis <strong>par client et
            par saison</strong>, et servent dans l&apos;écran <strong>Répartition</strong>.
          </p>
          <ul className="space-y-2">
            <li>
              <span className="font-medium">Rang</span> — priorité du client.{" "}
              <strong>Plus le rang est petit, plus il est servi tôt</strong> (rang 1 = prioritaire).
              Les mieux classés reçoivent leur commande complète avant les autres.
            </li>
            <li>
              <span className="font-medium">Rotation</span> — critère <em>secondaire</em>, à rang
              égal. Départage deux clients de même rang (le score le plus bas passe en premier).
            </li>
            <li>
              <span className="font-medium">% max commande</span> — coupe maximale autorisée sur{" "}
              <strong>l&apos;ensemble</strong> de la commande du client (ex. 20 % → il reçoit au
              moins 80 %). Une alerte s&apos;affiche si la répartition dépasse ce plafond.
            </li>
            <li>
              <span className="font-medium">% max ligne</span> — coupe maximale autorisée sur{" "}
              <strong>une ligne</strong> (un produit). Le moteur restaure des pièces pour respecter
              ce plafond quand le stock le permet.
            </li>
            <li>
              <span className="font-medium">Seuil min.</span> — quantité minimale pour livrer. En
              dessous, le client n&apos;est pas servi (évite les micro-livraisons non rentables).
            </li>
            <li>
              <span className="font-medium">Actif</span> — inclure ou non le client dans la
              répartition de cette saison.
            </li>
          </ul>
          <p className="mt-3 border-t pt-3 text-muted-foreground">
            <strong>À l&apos;usage :</strong> classez vos clients par rang (les plus importants en
            premier), fixez les % max pour protéger vos meilleurs clients d&apos;une coupe trop
            forte, et le seuil min. pour éviter d&apos;envoyer une poignée de pièces. Une valeur
            modifiée est enregistrée pour la saison active.
          </p>
        </div>
      )}
    </div>
  );
}

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
          action={<ConfigHelp />}
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

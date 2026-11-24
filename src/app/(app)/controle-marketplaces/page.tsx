"use client";

import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { MarketplaceControl } from "@/components/controle-marketplaces/marketplaces";

export default function ControleMarketplacesPage() {
  return (
    <div>
      <Topbar title="Contrôle marketplaces" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="Contrôle marketplaces"
          description="Commandes La Redoute (Shopping Feed) face aux commandes WooCommerce : absentes, écarts de montant, d'articles ou de statut"
        />
        <MarketplaceControl />
      </div>
    </div>
  );
}

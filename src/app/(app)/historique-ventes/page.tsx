"use client";

import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { SalesHistory } from "@/components/historique-ventes/sales-history";

export default function HistoriqueVentesPage() {
  return (
    <div>
      <Topbar title="Historique des ventes" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="Historique des ventes"
          description="Ventes par modèle, couleur et taille sur plusieurs années — site (BtoC) ou commandes clients (B2B)"
        />
        <SalesHistory />
      </div>
    </div>
  );
}

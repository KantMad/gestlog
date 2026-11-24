"use client";

import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Trends } from "@/components/tendances/trends";

export default function TendancesPage() {
  return (
    <div>
      <Topbar title="Tendances" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="Tendances : précommandes et commandes finales"
          description="Ce qui se perd entre la prise de commande (TIO) et la commande finale (Texas), par marque, catégorie, produit et coloris"
        />
        <Trends />
      </div>
    </div>
  );
}

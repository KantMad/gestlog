"use client";

import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { CollectionsTracking } from "@/components/suivi-collections/collections";

export default function SuiviCollectionsPage() {
  return (
    <div>
      <Topbar title="Suivi des collections" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="Suivi des collections"
          description="Produits et coloris présentés dans les catalogues TIO, retirés, commandés par les clients et commandés à l'usine"
        />
        <CollectionsTracking />
      </div>
    </div>
  );
}

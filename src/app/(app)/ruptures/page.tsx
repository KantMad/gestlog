"use client";

import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { StockOuts } from "@/components/ruptures/stock-outs";

export default function RupturesPage() {
  return (
    <div>
      <Topbar title="Ruptures de stock" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="Ruptures de stock"
          description="Couleurs et tailles en rupture sur le site, durée et ventes manquées estimées"
        />
        <StockOuts />
      </div>
    </div>
  );
}

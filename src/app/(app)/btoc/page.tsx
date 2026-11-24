"use client";

import { use, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BtocStatsTab } from "@/components/btoc/stats-tab";
import { BtocClientsTab } from "@/components/btoc/clients-tab";
import { BtocExportTab } from "@/components/btoc/export-tab";
import { BtocSegmentationTab } from "@/components/btoc/segmentation-tab";
import { BtocSettingsTab } from "@/components/btoc/settings-tab";
import { BtocNewsletterTab } from "@/components/btoc/newsletter-tab";
import { MarketplaceControl } from "@/components/controle-marketplaces/marketplaces";
import { BarChart3, Users, Download, Settings, PieChart, Mail, Scale } from "lucide-react";

const TABS = ["stats", "export", "segmentation", "clients", "marketplaces", "newsletter", "settings"];

export default function BtocPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Ouverture directe d'un onglet : /btoc?tab=marketplaces (ancienne adresse /controle-marketplaces).
  const tab = use(searchParams).tab;
  const [activeTab, setActiveTab] = useState(typeof tab === "string" && TABS.includes(tab) ? tab : "stats");

  return (
    <div>
      <Topbar title="BtoC" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="BtoC — WooCommerce"
          description="Statistiques, exports, clients, contrôle des marketplaces, newsletter et paramètres de votre boutique en ligne"
        />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="stats" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              Statistiques
            </TabsTrigger>
            <TabsTrigger value="export" className="gap-2">
              <Download className="h-4 w-4" />
              Export
            </TabsTrigger>
            <TabsTrigger value="segmentation" className="gap-2">
              <PieChart className="h-4 w-4" />
              Segmentation
            </TabsTrigger>
            <TabsTrigger value="clients" className="gap-2">
              <Users className="h-4 w-4" />
              Clients
            </TabsTrigger>
            <TabsTrigger value="marketplaces" className="gap-2">
              <Scale className="h-4 w-4" />
              Marketplaces
            </TabsTrigger>
            <TabsTrigger value="newsletter" className="gap-2">
              <Mail className="h-4 w-4" />
              Newsletter
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-2">
              <Settings className="h-4 w-4" />
              Paramètres
            </TabsTrigger>
          </TabsList>

          <TabsContent value="stats">
            <BtocStatsTab />
          </TabsContent>

          <TabsContent value="export">
            <BtocExportTab />
          </TabsContent>

          <TabsContent value="segmentation">
            <BtocSegmentationTab />
          </TabsContent>

          <TabsContent value="clients">
            <BtocClientsTab />
          </TabsContent>

          <TabsContent value="marketplaces">
            <MarketplaceControl />
          </TabsContent>

          <TabsContent value="newsletter">
            <BtocNewsletterTab />
          </TabsContent>

          <TabsContent value="settings">
            <BtocSettingsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BtocStatsTab } from "@/components/btoc/stats-tab";
import { BtocClientsTab } from "@/components/btoc/clients-tab";
import { BtocExportTab } from "@/components/btoc/export-tab";
import { BtocSettingsTab } from "@/components/btoc/settings-tab";
import { BarChart3, Users, Download, Settings } from "lucide-react";

export default function BtocPage() {
  const [activeTab, setActiveTab] = useState("stats");

  return (
    <div>
      <Topbar title="BtoC" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="BtoC — WooCommerce"
          description="Statistiques, exports, clients et paramètres de votre boutique en ligne"
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
            <TabsTrigger value="clients" className="gap-2">
              <Users className="h-4 w-4" />
              Clients
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

          <TabsContent value="clients">
            <BtocClientsTab />
          </TabsContent>

          <TabsContent value="settings">
            <BtocSettingsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

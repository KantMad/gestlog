import type { SizeQuantities } from "./utils";

export interface SeasonWithStats {
  id: string;
  name: string;
  year: number;
  type: string;
  isActive: boolean;
  isArchived: boolean;
  _count?: {
    clientOrders: number;
    supplierOrders: number;
  };
}

export interface ClientWithSeason {
  id: string;
  code: string;
  name: string;
  email: string | null;
  season?: {
    id: string;
    ranking: number;
    maxReductionOrder: number;
    maxReductionLine: number;
    minDeliveryThreshold: number;
    isActive: boolean;
    rotationScore: number;
  };
}

export interface ComparisonRow {
  productId: string;
  reference: string;
  color: string;
  sizeScale: string[];
  ordered: SizeQuantities;
  received: SizeQuantities;
  gap: SizeQuantities;
  totalOrdered: number;
  totalReceived: number;
  totalGap: number;
  gapPercent: number;
  status: "conforme" | "ecart_mineur" | "ecart_majeur";
}

export interface ComparisonSummary {
  supplierId: string;
  supplierName: string;
  totalOrdered: number;
  totalReceived: number;
  conformityRate: number;
  lineCount: number;
  anomalyCount: number;
}

export interface AllocationInput {
  seasonId: string;
  available: Map<string, SizeQuantities>;
  demands: AllocationDemand[];
  clientConfigs: Map<string, ClientConfig>;
}

export interface AllocationDemand {
  clientId: string;
  clientOrderId: string;
  productId: string;
  sizeScale: string[];
  requested: SizeQuantities;
}

export interface ClientConfig {
  ranking: number;
  maxReductionOrder: number;
  maxReductionLine: number;
  minDeliveryThreshold: number;
  rotationScore: number;
}

export interface AllocationResultLine {
  clientId: string;
  clientOrderId: string;
  productId: string;
  original: SizeQuantities;
  allocated: SizeQuantities;
  reduced: SizeQuantities;
  reductionReason: string;
  status: "LIVRABLE" | "EN_ATTENTE" | "ANNULE";
  isManualAdjustment: boolean;
}

export interface AllocationResult {
  lines: AllocationResultLine[];
  warnings: string[];
}

export interface DeliverySummary {
  id: string;
  deliveryNumber: number;
  clientId: string;
  clientName: string;
  clientCode: string;
  orderNumber: string | null;
  status: string;
  colorCode: string;
  totalPieces: number;
  lineCount: number;
  eanExportGenerated: boolean;
  shippedAt: string | null;
}

export interface DashboardKPIs {
  totalOrders: number;
  totalPieces: number;
  receptionRate: number;
  deliveryRate: number;
  pendingAllocations: number;
  activeClients: number;
}

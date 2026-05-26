import type { SizeQuantities } from "@/lib/utils";

export interface AllocationInput {
  seasonId: string;
  available: Map<string, SizeQuantities>;
  demands: AllocationDemand[];
  clientConfigs: Map<string, ClientConfig>;
  /** clientId → display name (e.g. "Boutique Rivoli") */
  clientNames?: Map<string, string>;
  /** productId → display label (e.g. "AMBELT_P003 / 208") */
  productNames?: Map<string, string>;
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

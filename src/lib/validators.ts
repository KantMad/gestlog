import { z } from "zod";

export const createSeasonSchema = z.object({
  name: z.string().min(1, "Le nom est requis"),
  year: z.number().int().min(2020).max(2050),
  type: z.enum(["AH", "PE"]),
});

export const createClientSchema = z.object({
  code: z.string().min(1, "Le code est requis"),
  name: z.string().min(1, "Le nom est requis"),
  email: z.string().email("Email invalide").optional().or(z.literal("")),
});

export const updateClientSeasonSchema = z.object({
  ranking: z.number().int().min(1).optional(),
  maxReductionOrder: z.number().min(0).max(100).optional(),
  maxReductionLine: z.number().min(0).max(100).optional(),
  minDeliveryThreshold: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const createSupplierSchema = z.object({
  code: z.string().min(1, "Le code est requis"),
  name: z.string().min(1, "Le nom est requis"),
});

export const updateDeliveryStatusSchema = z.object({
  status: z.enum(["PLANIFIEE", "EN_PREPARATION", "EXPEDIEE"]),
});

export const allocationSimulateSchema = z.object({
  seasonId: z.string().min(1),
  catalogId: z.string().optional(),
  supplierOrderId: z.string().optional(),
  productIds: z.array(z.string()).optional(),
});

export const allocationAdjustSchema = z.object({
  lineId: z.string().min(1),
  newAllocatedBySize: z.record(z.string(), z.number().int().min(0)),
});

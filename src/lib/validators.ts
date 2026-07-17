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
  rotationScore: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

// Réglages GLOBAUX d'une boutique (toutes saisons confondues).
export const updateClientSchema = z.object({
  // Tailles exclues du surplus (libellés de tailles : "4XL", "31"…).
  surplusExcludedSizes: z.array(z.string().min(1).max(10)).max(40).optional(),
});

export const createSupplierSchema = z.object({
  code: z.string().min(1, "Le code est requis"),
  name: z.string().min(1, "Le nom est requis"),
});

export const updateDeliveryStatusSchema = z.object({
  status: z.enum(["PLANIFIEE", "EN_PREPARATION", "ENVOYEE_DEPOT", "VALIDEE_DEPOT", "EXPEDIEE"]),
});

export const updateDeliveryDetailsSchema = z.object({
  status: z.enum(["PLANIFIEE", "EN_PREPARATION", "ENVOYEE_DEPOT", "VALIDEE_DEPOT", "EXPEDIEE"]).optional(),
  nbColis: z.number().int().min(0).optional().nullable(),
  nbPieces: z.number().int().min(0).optional().nullable(),
  blNumber: z.string().optional().nullable(),
  carrier: z.string().optional().nullable(),
  depotStatus: z.enum(["EN_ATTENTE", "RECU", "VALIDE", "ANOMALIE"]).optional().nullable(),
  comment: z.string().optional().nullable(),
  shipmentGroupId: z.string().optional().nullable(),
});

export const createShipmentGroupSchema = z.object({
  name: z.string().min(1, "Le nom est requis"),
  carrier: z.string().optional(),
  deliveryIds: z.array(z.string()).optional(),
});

export const allocationSimulateSchema = z.object({
  seasonId: z.string().min(1),
  catalogId: z.string().optional(),
  supplierOrderId: z.string().optional(),
  productIds: z.array(z.string()).optional(),
  clientIds: z.array(z.string()).optional(),
  supplierIds: z.array(z.string()).optional(),
  productReferences: z.array(z.string()).optional(),
  orderType: z.enum(["COMMANDE", "VSS", "ALL"]).optional(), // default COMMANDE
  // Reprise d'une répartition depuis son fichier EAN : si présent, l'alloué VIENT DU
  // FICHIER (aucun recalcul) et le reste de la réponse est construit normalement.
  // Borné à 50 000 lignes (le plus gros export observé : ~1 500).
  importedAllocation: z
    .array(
      z.object({
        clientCode: z.string().min(1),
        reference: z.string().min(1),
        color: z.string(),
        size: z.string().min(1),
        qty: z.number().int().min(0),
      })
    )
    .max(50000)
    .optional(),
});

export const allocationAdjustSchema = z.object({
  lineId: z.string().min(1),
  newAllocatedBySize: z.record(z.string(), z.number().int().min(0)),
});

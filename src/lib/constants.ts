export const DELIVERY_COLORS = [
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
  "#06B6D4",
  "#84CC16",
  "#F97316",
  "#6366F1",
] as const;

export const NAV_ITEMS = [
  { href: "/dashboard", label: "Tableau de bord", icon: "LayoutDashboard" },
  { href: "/import", label: "Import", icon: "Upload" },
  { href: "/comparison", label: "Comparaison", icon: "GitCompareArrows" },
  { href: "/allocation", label: "Répartition", icon: "Calculator" },
  { href: "/deliveries", label: "Livraisons", icon: "Truck" },
  { href: "/configuration", label: "Configuration", icon: "Settings" },
  { href: "/statistics", label: "Statistiques", icon: "BarChart3" },
] as const;

export const SUPPLIER_ORDER_STATUS = {
  EN_ATTENTE: "En attente",
  PARTIEL: "Partiel",
  COMPLET: "Complet",
  SOLDE: "Soldé",
} as const;

export const ALLOCATION_STATUS = {
  SIMULATION: "Simulation",
  VALIDATED: "Validé",
  CANCELLED: "Annulé",
} as const;

export const DELIVERY_STATUS = {
  PLANIFIEE: "Planifiée",
  EN_PREPARATION: "En préparation",
  EXPEDIEE: "Expédiée",
} as const;

export const LINE_STATUS = {
  LIVRABLE: "Livrable",
  EN_ATTENTE: "En attente",
  ANNULE: "Annulé",
} as const;

export const IMPORT_TYPES = {
  CLIENT_ORDER: "Commandes clients",
  SUPPLIER_ORDER: "Commandes fournisseurs",
  RECEPTION: "Réceptions",
  STOCK: "Stock",
} as const;

export const SEASON_TYPES = {
  AH: "Automne-Hiver",
  PE: "Printemps-Été",
} as const;

export const DEFAULT_CLIENT_CONFIG = {
  ranking: 5,
  maxReductionOrder: 30.0,
  maxReductionLine: 50.0,
  minDeliveryThreshold: 10,
} as const;

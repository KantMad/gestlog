import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type SizeQuantities = Record<string, number>;

export function parseSizeQuantities(json: string): SizeQuantities {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export function stringifySizeQuantities(quantities: SizeQuantities): string {
  return JSON.stringify(quantities);
}

export function sumQuantities(quantities: SizeQuantities): number {
  return Object.values(quantities).reduce((sum, qty) => sum + qty, 0);
}

export function subtractQuantities(
  a: SizeQuantities,
  b: SizeQuantities
): SizeQuantities {
  const result: SizeQuantities = { ...a };
  for (const [size, qty] of Object.entries(b)) {
    result[size] = Math.max(0, (result[size] || 0) - qty);
  }
  return result;
}

export function addQuantities(
  a: SizeQuantities,
  b: SizeQuantities
): SizeQuantities {
  const result: SizeQuantities = { ...a };
  for (const [size, qty] of Object.entries(b)) {
    result[size] = (result[size] || 0) + qty;
  }
  return result;
}

export function parseSizeScale(sizeScale: string): string[] {
  return sizeScale.split(",").map((s) => s.trim());
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n);
}

export function formatPercent(n: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n / 100);
}

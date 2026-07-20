// Bornes de dates BtoC en fuseau **Europe/Paris**.
//
// Les commandes (`BtocOrder.orderDate`) sont stockées en instants UTC. WooCommerce
// Analytics, lui, borne les périodes sur les **jours calendaires de Paris**. Deux bugs en
// découlaient côté GestLog :
//   1. `orderDate <= new Date(dateTo)` → borne à **minuit UTC** du jour de fin, ce qui
//      excluait quasi toute la journée `dateTo` ;
//   2. bornes à minuit UTC (et non Paris) → les 2 premières heures de chaque jour basculaient.
// On construit ici l'intervalle **[début du 1er jour Paris, début du lendemain du dernier
// jour Paris[** exprimé en instants UTC (borne haute EXCLUSIVE → jour de fin inclus en entier).

// Instant UTC correspondant à 00:00 (heure de Paris) du jour `ymd` ("YYYY-MM-DD").
// DST-safe : on lit le décalage réel de Paris à cette date via `Intl`.
export function parisDayStartUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0); // minuit "naïf" traité comme UTC
  // Heure murale de Paris à cet instant, réexprimée en ms UTC → permet d'extraire le décalage.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(guess));
  const o: Record<string, string> = {};
  for (const p of parts) o[p.type] = p.value;
  const wall = Date.UTC(
    Number(o.year),
    Number(o.month) - 1,
    Number(o.day),
    Number(o.hour) === 24 ? 0 : Number(o.hour),
    Number(o.minute),
    Number(o.second)
  );
  const offset = wall - guess; // décalage Paris (ms) à cet instant
  return new Date(guess - offset);
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

// Renvoie les bornes UTC { gte, lt } pour un intervalle de jours Paris (bornes incluses).
// gte/lt à utiliser avec `orderDate >= gte AND orderDate < lt` (lt exclusive).
export function parisRangeToUtc(
  dateFrom?: string | null,
  dateTo?: string | null
): { gte: Date | null; lt: Date | null } {
  return {
    gte: dateFrom ? parisDayStartUtc(dateFrom) : null,
    lt: dateTo ? parisDayStartUtc(addDays(dateTo, 1)) : null,
  };
}

// Expression SQL groupant `orderDate` (UTC) par jour/mois **de Paris**.
// `col AT TIME ZONE 'UTC'` : interprète le timestamp naïf comme UTC → timestamptz ;
// `... AT TIME ZONE 'Europe/Paris'` : le ramène à l'heure murale de Paris (timestamp naïf).
export function parisDayExpr(col: string): string {
  return `((${col} AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris')`;
}

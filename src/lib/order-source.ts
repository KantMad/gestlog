import { prisma } from "@/lib/prisma";

// Source B2B des commandes clients.
//  - TEXAS : données ERP (vérité) — prioritaires dès qu'elles existent pour la saison.
//  - TIO   : prise de commande (archive) — repli tant qu'aucune donnée Texas n'a été importée.
export type OrderSource = "TIO" | "TEXAS";

// Source active pour une saison : TEXAS si au moins une commande Texas y existe, sinon TIO.
// Sert à faire lire à TOUS les écrans B2B la bonne source, avec repli automatique.
export async function resolveOrderSource(seasonId: string): Promise<OrderSource> {
  const texas = await prisma.clientOrder.count({ where: { seasonId, source: "TEXAS" } });
  return texas > 0 ? "TEXAS" : "TIO";
}

// Variante multi-saisons (comparaisons) : renvoie la source par saison (par NOM de saison).
export async function resolveOrderSourceBySeasonName(
  seasonNames: string[]
): Promise<Map<string, OrderSource>> {
  const rows = await prisma.clientOrder.findMany({
    where: { source: "TEXAS", season: { name: { in: seasonNames } } },
    select: { season: { select: { name: true } } },
    distinct: ["seasonId"],
  });
  const withTexas = new Set(rows.map((r) => r.season.name));
  return new Map(seasonNames.map((n) => [n, withTexas.has(n) ? "TEXAS" : "TIO"]));
}

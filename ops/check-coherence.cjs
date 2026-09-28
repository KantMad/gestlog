#!/usr/bin/env node
// Diagnostic de cohérence des montants B2B — à lancer sur le VPS quand un chiffre en euros
// paraît faux :  node ops/check-coherence.cjs
//
// 🔴 Pourquoi ce script existe. Le 28/09/2026, l'écran de comparaison affichait 524 668 €
// pour « MCS Homme W25 » contre 1 633 676 € pour « MCS Homme W26 » — un CA apparemment
// triplé. En réalité 69 % des lignes de W25 n'ont AUCUN montant, et le prix unitaire là où
// il existe est presque identique (38,02 € contre 39,86 €). Aucun test unitaire ne pouvait
// l'attraper : le code était juste, les DONNÉES étaient trouées. Ce script mesure la
// couverture, saison par saison et catalogue par catalogue.
//
// Les seuils sont ceux de src/lib/amount-coverage.ts : ≥ 95 % fiable, < 70 % inexploitable.
// Lancé depuis /var/www/gestlog : `pg` se résout dans le node_modules du projet.
const { Client } = require("pg");
const fs = require("fs");

const APP = process.env.GESTLOG_DIR || "/var/www/gestlog";
const url = fs
  .readFileSync(`${APP}/.env`, "utf8")
  .match(/^DATABASE_URL=(.*)$/m)[1]
  .trim()
  .replace(/^["']|["']$/g, "");

const FIABLE = 95;
const INEXPLOITABLE = 70;
const verdict = (pct) => (pct >= FIABLE ? "fiable" : pct < INEXPLOITABLE ? "INEXPLOITABLE" : "partiel");

// Même règle de source active que resolveOrderSource : une seule source par saison.
const SRC = `co."source" = (CASE WHEN EXISTS (
  SELECT 1 FROM "ClientOrder" c2 WHERE c2."seasonId" = co."seasonId" AND c2."source" = 'TEXAS'
) THEN 'TEXAS' ELSE 'TIO' END)`;

const BASE = `
  SUM(col."totalQuantity")::int AS pieces,
  SUM(CASE WHEN col.amount > 0 THEN col."totalQuantity" ELSE 0 END)::int AS valorisees,
  COUNT(*)::int AS lignes,
  COUNT(CASE WHEN col.amount > 0 THEN 1 END)::int AS lignes_valorisees,
  COALESCE(SUM(col.amount), 0)::float8 AS ca`;

const ligne = (r) => {
  const pct = r.pieces > 0 ? Math.round((r.valorisees / r.pieces) * 1000) / 10 : 0;
  const pu = r.valorisees > 0 ? Math.round((r.ca / r.valorisees) * 100) / 100 : 0;
  return { pct, pu, v: verdict(pct) };
};

(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const bloc = async (titre, sql) => {
    const rows = (await c.query(sql)).rows;
    console.log(`\n══ ${titre} ══`);
    console.log(
      "  " +
        "élément".padEnd(34) +
        "pièces".padStart(8) +
        "valorisées".padStart(12) +
        "couvert".padStart(9) +
        "€/pièce".padStart(10) +
        "  verdict"
    );
    let alertes = 0;
    for (const r of rows) {
      const { pct, pu, v } = ligne(r);
      if (v !== "fiable") alertes++;
      console.log(
        "  " +
          String(r.nom).slice(0, 33).padEnd(34) +
          String(r.pieces).padStart(8) +
          String(r.valorisees).padStart(12) +
          `${pct} %`.padStart(9) +
          `${pu}`.padStart(10) +
          "  " +
          v
      );
    }
    return alertes;
  };

  let total = 0;
  total += await bloc(
    "Par saison (source active)",
    `SELECT se.type||se.year AS nom, ${BASE}
       FROM "ClientOrderLine" col
       JOIN "ClientOrder" co ON co.id = col."clientOrderId"
       JOIN "Season" se ON se.id = co."seasonId"
      WHERE co."orderType" = 'COMMANDE' AND ${SRC}
      GROUP BY se.type, se.year ORDER BY se.year DESC, se.type`
  );

  total += await bloc(
    "Par catalogue (les 20 plus gros)",
    `SELECT cat.name AS nom, ${BASE}
       FROM "ClientOrderLine" col
       JOIN "ClientOrder" co ON co.id = col."clientOrderId"
       JOIN "Catalog" cat ON cat.id = co."catalogId"
      WHERE co."orderType" = 'COMMANDE' AND ${SRC}
      GROUP BY cat.name ORDER BY SUM(col."totalQuantity") DESC LIMIT 20`
  );

  console.log(
    `\n${total} élément(s) dont le CA n'est pas pleinement fiable. Les écrans de statistiques ` +
      `l'affichent désormais eux-mêmes ; la correction de fond est à faire À LA SOURCE, dans TIO ` +
      `(colonne de montant vide à l'import).`
  );
  await c.end();
})().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});

// Logique PURE de parsing des BL (bons de livraison) PDF : transforme une liste
// d'items texte positionnés { x, y, s } (extraits via pdfjs) en lignes de livraison
// { reference, colorCode, colorLabel, size, quantity }.
// Aucune dépendance (pdfjs/pg) → testable unitairement avec des items synthétiques.

export const ALPHA = new Set([
  "XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL", "6XL", "7XL",
  "TU", "U", "T0", "T1", "T2", "T3", "T4", "T5",
]);

// Référence produit : code type SKU (lettres puis alphanum, underscore, alphanum).
// ex : QMTSMC_C312, CVMO_CHMC01, NMD201_D760 (denim).
export const REF_RE = /^[A-Z]{2,}[A-Z0-9]*_[A-Z0-9]{2,8}$/;

// Bloc récapitulatif / totaux du BL (fin de document) : "Tot. colis", "Nb de colis",
// "Qté pièce", "Qté unités", "Qté packs", "Récapitulatif"… Ces lignes portent des
// nombres (ex. le total de pièces) qui, mal placés dans les colonnes tailles, étaient
// captés comme une ligne produit fantôme → SUR-COMPTAGE du livré. On ignore toute
// ligne contenant un de ces marqueurs (ils n'apparaissent jamais sur une vraie ligne).
export const SUMMARY_RE = /qté|tot\.|colis|récapitul|\btotal\b/i;

// Regroupe les items en lignes par coordonnée y (tolérance), triées de haut en bas
// puis de gauche à droite.
export function groupRows(items, tol = 3) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  let cur = null;
  for (const it of sorted) {
    if (!cur || Math.abs(cur.y - it.y) > tol) {
      cur = { y: it.y, items: [] };
      rows.push(cur);
    }
    cur.items.push(it);
  }
  rows.forEach((r) => r.items.sort((a, b) => a.x - b.x));
  return rows;
}

export function parseLines(items) {
  const rows = groupRows(items);
  const lines = [];
  let curRef = null,
    sizeMap = null;
  for (const row of rows) {
    const toks = row.items;
    const refTok = toks.find((t) => REF_RE.test(t.s));
    if (refTok) curRef = refTok.s;
    // Bloc totaux/récapitulatif → ne jamais en extraire de quantités (sur-comptage).
    if (toks.some((t) => SUMMARY_RE.test(t.s))) continue;
    const codeTok = toks.find((t) => t.x < 40 && /^\d{2,3}$/.test(t.s)); // code couleur (gauche)
    // En-tête tailles : ligne SANS code couleur, avec des tailles à droite de la zone
    // libellé (x>=60). >=1 alpha (ex: TU) OU >=2 numériques (pantalons/denim).
    // Bornes x DYNAMIQUES : les templates de BL varient (tailles à x~107 ou x~196).
    const cands = toks.filter(
      (t) => t.x >= 60 && t.x < 420 && (ALPHA.has(t.s.toUpperCase()) || /^\d{2,3}$/.test(t.s))
    );
    const alphaH = cands.filter((t) => ALPHA.has(t.s.toUpperCase()));
    const numH = cands.filter((t) => /^\d{2,3}$/.test(t.s));
    if (!codeTok && (alphaH.length >= 1 || numH.length >= 2)) {
      sizeMap = cands.map((t) => ({ size: t.s.toUpperCase(), x: t.x })).sort((a, b) => a.x - b.x);
      continue;
    }
    // Ligne de quantités : code couleur (multi-coloris) ou sans (mono → "000").
    // Quantités = nombres dans la plage des colonnes tailles (exclut le total à droite).
    if (sizeMap && curRef) {
      const left = sizeMap[0].x,
        right = sizeMap[sizeMap.length - 1].x;
      // quantité = 1 à 4 chiffres max (exclut les EAN/codes à 8-13 chiffres parfois
      // positionnés près des colonnes tailles sur certains templates).
      const qtys = toks.filter((t) => /^\d{1,4}$/.test(t.s) && t.x >= left - 14 && t.x <= right + 14);
      const mapped = [];
      for (const q of qtys) {
        const sz = sizeMap.reduce((b, s) => (Math.abs(s.x - q.x) < Math.abs(b.x - q.x) ? s : b));
        if (Math.abs(sz.x - q.x) < 14) mapped.push({ size: sz.size, quantity: parseInt(q.s) });
      }
      if (mapped.length) {
        const colorCode = codeTok ? codeTok.s : "000";
        const colorLabel = codeTok
          ? toks
              .filter((t) => t.x >= 40 && t.x < left - 4 && !/^\d+$/.test(t.s))
              .map((t) => t.s)
              .join(" ")
              .trim()
          : "";
        for (const m of mapped)
          lines.push({ reference: curRef, colorCode, colorLabel, size: m.size, quantity: m.quantity });
      }
    }
  }
  // fusionne d'éventuels doublons (réf+couleur+taille)
  const m = new Map();
  for (const l of lines) {
    const k = `${l.reference}|${l.colorCode}|${l.size}`;
    if (m.has(k)) m.get(k).quantity += l.quantity;
    else m.set(k, { ...l });
  }
  return [...m.values()];
}

// Logique PURE de parsing des FAC (factures) PDF. Contrairement aux BL, la facture
// est RÉCAPITULATIVE : une seule quantité par (référence, coloris), SANS ventilation
// par taille (la colonne "Désignation / Tailles" n'affiche qu'une plage de tailles en
// texte, ex. "Tailles : S - 3XL"). Layout type :
//   réf@x17 | libellé@x103                                            (ligne référence)
//   codeCouleur@x17 | libellé@x49 | "Tailles : X - Y"@x103 | Qté@x≈471 | Pu@x498 | Montant@x554
// La quantité facturée est le SEUL entier pur (sans décimale) à x>200 de la ligne
// coloris (prix et montant portent toujours une décimale → exclus). size = plage de
// tailles ("S - 3XL"), à titre indicatif ; la réconciliation se fait par (réf, coloris).
export function parseFacLines(items) {
  const rows = groupRows(items);
  const lines = [];
  let curRef = null;
  for (const row of rows) {
    const toks = row.items;
    const refTok = toks.find((t) => REF_RE.test(t.s));
    if (refTok) {
      curRef = refTok.s;
      continue; // une ligne référence ne porte pas de quantité coloris
    }
    if (!curRef) continue;
    // Ligne coloris : code à 3 chiffres tout à gauche (ex. 001, 753, 000 mono).
    const codeTok = toks.find((t) => t.x < 40 && /^\d{3}$/.test(t.s));
    if (!codeTok) continue;
    // Quantité = entier pur (1-4 chiffres, sans décimale) dans la colonne Qté (x>200,
    // avant le prix). Prix/montant ont une décimale → exclus. On prend le plus à gauche.
    const qtyToks = toks
      .filter((t) => t.x > 200 && /^\d{1,4}$/.test(t.s))
      .sort((a, b) => a.x - b.x);
    if (!qtyToks.length) continue;
    const quantity = parseInt(qtyToks[0].s, 10);
    if (!quantity) continue;
    // Colonnes monétaires (x>200) : Prix unitaire (Pu, x~498) puis Montant HT (x~554),
    // toutes deux décimales. Le séparateur de milliers peut être un espace ("1 782,00").
    const money = (s) => parseFloat(s.replace(/[\s ]/g, "").replace(",", "."));
    const decToks = toks
      .filter((t) => t.x > 200 && /^\d[\d\s ]*[.,]\d{2}$/.test(t.s))
      .sort((a, b) => a.x - b.x);
    // Montant HT = décimale la plus à droite ; Pu = la plus à gauche s'il y en a ≥2.
    const amount = decToks.length ? money(decToks[decToks.length - 1].s) : 0;
    const unitPrice = decToks.length >= 2 ? money(decToks[0].s) : 0;
    // Libellé coloris : tokens entre le code et la colonne "Tailles" (x 40→100).
    const colorLabel = toks
      .filter((t) => t.x >= 40 && t.x < 100 && !/^\d+$/.test(t.s))
      .map((t) => t.s)
      .join(" ")
      .trim();
    // Plage de tailles indicative, ex. "Tailles : S - 3XL" → "S - 3XL".
    const sizeTok = toks.find((t) => /^Tailles\s*:/.test(t.s));
    const size = sizeTok ? sizeTok.s.replace(/^Tailles\s*:\s*/, "").trim() : "";
    lines.push({ reference: curRef, colorCode: codeTok.s, colorLabel, size, quantity, unitPrice, amount });
  }
  // fusionne d'éventuels doublons (réf+couleur) — quantités et montants cumulés.
  const m = new Map();
  for (const l of lines) {
    const k = `${l.reference}|${l.colorCode}`;
    if (m.has(k)) {
      m.get(k).quantity += l.quantity;
      m.get(k).amount += l.amount;
    } else m.set(k, { ...l });
  }
  return [...m.values()];
}

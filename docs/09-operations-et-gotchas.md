# 09 — Opérations courantes & pièges

## Tâches courantes

### Déployer
```bash
# 1) en local : build pour attraper les erreurs TS
npm run build
# 2) commit + push (la doc concernée AUSSI — cf. règle README)
git add -A && git commit -m "…" && git push origin main
# 3) déployer sur le VPS
ssh -o BatchMode=yes ubuntu@51.77.149.138 'cd /var/www/gestlog && bash deploy.sh'
```

### Lancer la synchro produits (manuel)
```bash
curl -s "https://centralway.pro/webhook/gestlog-test-products"   # async, traite par batches
```
Idem : autres synchros via leurs workflows n8n (cf. [`04`](04-sources-et-n8n.md)).

### Relancer les envois caisse en échec
```bash
ssh -o BatchMode=yes ubuntu@51.77.149.138 'bash /var/www/gestlog/caisse-retry.sh'
# (sinon : cron toutes les 15 min)
```

### Logs / état appli
```bash
ssh -o BatchMode=yes ubuntu@51.77.149.138 'pm2 logs gestlog --lines 100'
ssh -o BatchMode=yes ubuntu@51.77.149.138 'pm2 status'
```

### Requêter la base de prod (script Node + pg)
Pas de `psql` garanti. Pattern fiable (lire `DATABASE_URL` du `.env`, SSL permissif) :
```js
// /tmp/q.js  →  scp sur le VPS  →  node /tmp/q.js
const fs = require("fs");
const { Pool } = require("/var/www/gestlog/node_modules/pg");
const url = fs.readFileSync("/var/www/gestlog/.env","utf8")
  .match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,"");
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
(async () => { const r = await pool.query('SELECT count(*) FROM "Product"');
  console.log(r.rows); await pool.end(); })().catch(e=>{console.error(e.message);process.exit(1)});
```
Nettoie les fichiers `/tmp` après usage (local **et** VPS).

## Crons

| Où | Quoi | Fréquence |
|---|---|---|
| VPS | `caisse-retry.sh` (relance envois caisse `FAILED`) | toutes les **15 min** |
| VPS | `backup-db.sh` (dump base) | avant chaque déploiement (+ éventuel cron) |
| n8n | Sync produits + EAN (`NvAbzIgKKw5OvTk1`) | toutes les **6 h** |
| n8n | Sync commandes / BL-FAC / BtoC | selon planning des workflows |

## Pièges durement appris (gotchas)

1. **`prisma db push` = additif seulement.** Une suppression/renommage/NOT-NULL sur colonne
   remplie peut **détruire des données**. Jamais sans **autorisation explicite** + backup.
   (cf. [`03`](03-base-de-donnees.md))
2. **Ne jamais toucher la caisse** (`caissepro-api`, pm2 id 0). GestLog ne fait
   qu'**envoyer**. (cf. [`06`](06-integration-caisse.md))
3. **Secrets : extraire en Node, pas en shell.** `cut`/`tr` corrompt les secrets longs
   (64 → 56 car.). Les secrets du `.env` ne sont **pas** dans `/proc/<pid>/environ`.
4. **Ne pas mettre de secret dans la doc / le repo** (GitHub public). Noms de variables
   seulement.
5. **Couleur = CODE par défaut.** `Product.color`/`colorCode` = code ("213").
   `Product.colorLabel` = nom ("Chocolat"), rempli depuis TIO `lng_content.text2`. Pour la
   caisse : `color`=nom (repli code), `colorCode`=code.
6. **TVA absente de TIO** → toujours **0.20** par défaut.
5bis. **Accès écran & boucle de redirection** : un utilisateur dont `screenAccess` **exclut
   `/dashboard`** (ex. Audrey = `/repartition` seul) ne doit PAS être redirigé vers
   `/dashboard` (le middleware le refuserait → redirige vers `/dashboard` → **boucle infinie,
   ERR_TOO_MANY_REDIRECTS**). Règle : **toujours rediriger vers le 1er écran AUTORISÉ**
   (`firstAllowedScreen`, repli `/account`). Vu dans `middleware.ts`, `auth-context.login`,
   `login/page.tsx`. Symptôme corrigé le 23/06/2026.
6bis. **Imports MCS** : ne JAMAIS supposer que l'en-tête est en ligne 1. *StatGen* (commande
   fournisseur) = en-tête L0 + quantités **positionnelles** `Q.1..Q.16` décodées via
   `Product.sizeScale` (grille variable, pas une taille fixe). *Packing List* (réception) =
   en-tête ~L18, réf **tiret→underscore**, couleur = **code** (le nom peut comporter des
   fautes : « CHOCALAT », ou « BLEU DENIM » pour le 752). **Toujours matcher par CODE
   couleur, jamais par nom.** Détails : [`08`](08-fonctionnalites.md). Garde-fou : d'anciens
   imports ont créé des **doublons** `Product` (couleur=nom, `colorCode`=`REF-CODE`,
   `sizeScale` vide) — 275 supprimés le 19/06/2026 (backup `/var/backups/gestlog/junk-products-*.json`).
7. **`DeliveryLine.totalQuantity` est NOT NULL** — toujours le renseigner lors d'inserts de
   test.
8. **WooCommerce `total_spent` = 0** via REST → recalculer côté GestLog
   (`/api/sync/btoc/vip-recompute`). (cf. [`07`](07-btoc-brevo.md))
9. **Quoting SSH/heredoc** : les apostrophes/backticks cassent les heredocs imbriqués via
   SSH. Écrire le contenu dans un fichier `/tmp` puis `scp` (ou `git commit -F fichier`).
10. **Tests de connectivité caisse** : un EAN **réel** ajoute réellement du stock en caisse.
    Tester avec un EAN **bidon**.
11. **Cohérence durée de session** : si tu changes la durée, mets à jour `DEFAULT_TTL_MS`
    (`session.ts`) **et** `maxAge` (`auth.ts`) **et** `INACTIVITY_MS` (`auth-context.tsx`).
12. **PWA mobile** : le service worker peut servir une version en cache → recharger/rouvrir
    l'app après déploiement pour voir les changements.

## Répartitions validées en double (nettoyage du 24/07/2026)

Depuis que le **disponible déduit les répartitions validées** (cf. `08`/`10`), une même
répartition **validée deux fois** compte **deux fois** et fait disparaître du stock à tort.

- **Cas rencontré (AH26)** : deux sessions du **18/07** (16:20 et 18:58) portaient les **mêmes
  460 couples boutique+produit** — séquelle d'une revalidation d'avant le correctif de
  « mise à jour en place » (`sourceSessionId`, cf. `08`). Symptôme caractéristique :
  **`engagé` = 2 × `reçu`** sur des produits entiers.
- **Correction** : la plus **ancienne** est passée en **`status = 'CANCELLED'`** (réversible ;
  la déduction ne lit que les `VALIDATED`), **pas supprimée**. Sauvegarde JSON préalable :
  `/var/www/gestlog/AVANT-CANCEL-SESSION-DOUBLON-*.json`.
  Revenir en arrière : `UPDATE "AllocationSession" SET status='VALIDATED' WHERE id='…';`
- **Effet** : engagé 16 976 → **13 770**, disponible 8 971 → **9 268**, produits à dispo 0
  149 → **134**.
- **Contrôles à relancer** après ce type de nettoyage (script `pg` ad hoc) : **aucun produit
  avec `engagé > reçu`** et **aucun recouvrement de couples boutique+produit entre deux
  sessions `VALIDATED`** — les deux étaient à 0 après correction.

## Grilles de tailles abîmées (nettoyage du 04/08/2026)

`Product.sizeScale` était écrit par la synchro TIO en **`variations.map(v => v.size).join(",")`**
— **sans tri ni dédoublonnage**. L'ordre était donc celui, arbitraire, renvoyé par TIO.

- **Audit** : **893 produits sur 8 887 (10 %)** abîmés — **846 désordonnés**
  (`M,L,XL,S,2XL…` : le S en 4ᵉ position ; `42,30,31,…,28,44,29`) et **47 avec doublons**
  (`TU,TU`, jusqu'à `S,S,S,S,S,S,M,M,…` sur **42 entrées**).
- **Symptômes** : onglet à **42 colonnes** dans « Lancement de commande » (`S` répété 6 fois),
  `S` rangé après `XL`. ⚠️ Et surtout, en répartition, la règle « pas de trou de taille »
  raisonne sur l'**ordre** de la grille : elle plaçait le `S` après le `XL`.
- **Impact données** : **aucune donnée faussée** — 805 des 893 n'étaient **jamais utilisées**,
  et **0 ligne de commande** n'avait été décodée avec le motif `M,L,XL,S,…`.
- **Correction en deux temps** :
  1. **À la source** : la synchro assainit désormais à l'écriture (`sortSizeScale`,
     `src/lib/size-order.ts`).
  2. **Backfill unique** des 893 grilles, avec **simulation d'abord**, garde-fou « aucune
     taille perdue » (bloquant) et sauvegarde JSON préalable :
     `/var/www/gestlog/AVANT-FIX-SIZESCALE-*.json` (chaque entrée porte `before`/`after`).
- **Après** : **0 doublon, 0 désordre** sur 8 887 grilles. Et en répartition AH26, l'alloué
  passe de **7 494 à 9 749 pièces** (les trous de taille ne coupent plus à tort), tous les
  invariants restant à 0 (dépassement, alloué > demande, trou de taille).
- ⚠️ **Ne PAS brancher `sortSizeScale` dans `parseSizeScale`** : l'ORDRE de la grille sert
  aussi à **décoder les quantités par position** à l'import (`quantities[scale[i]]` dans
  `mcs-mapper`). Le tri s'applique à l'**écriture** et à l'affichage, pas en remplacement
  global de la lecture.

## Limites de l'environnement de dev local

- **La base locale pointe encore sur un backup Supabase obsolète** : les données locales ne
  reflètent pas la prod.
- **Les pages `(app)` exigent une session** → l'outil de **preview navigateur ne peut pas
  exercer l'app authentifiée** ici (et s'est révélé non fonctionnel). **Vérifier plutôt
  par : `npm run build` + déploiement + test réel** (sur le domaine / la PWA), ou par des
  requêtes ciblées (`curl`, script `pg`). Ne pas promettre une vérif visuelle locale.

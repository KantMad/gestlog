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
| VPS | **`backup-full.sh` (sauvegarde complète : base + configuration)** | **toutes les heures, à HH:12** |
| VPS | `backup-db.sh` (dump base seul) | avant chaque déploiement + cron 3 h |
| VPS | `parse-bl-pdfs.mjs` (lecture des BL PDF) | tous les jours à 4 h |
| n8n | Sync produits + EAN (`NvAbzIgKKw5OvTk1`) | toutes les **6 h** |
| n8n | Sync commandes / BL-FAC / BtoC | selon planning des workflows |

## Déploiement (`ops/deploy.sh`)

Sauvegarde → code → deps → **tests bloquants** → schéma → build → redémarrage →
**contrôle de santé** → **contrôle de fraîcheur**.

- 🔴 **Le script se détache tout seul du terminal appelant** (`setsid nohup`), et l'appelant
  ne fait que SUIVRE le journal `/var/backups/gestlog/deploy.log`. *Le 24/09/2026, une
  connexion SSH est tombée juste après `git pull` : le build et le redémarrage n'ont jamais
  tourné, et l'application a continué à servir un build vieux de deux heures.* Désormais
  une coupure tue le suivi, plus le déploiement.
  - Le **code de sortie** reste celui du travail réel : le processus détaché écrit le sien
    dans `deploy.status`, que l'appelant attend puis relaie. Un `tail` interrompu ne fait
    donc pas passer un échec pour un succès.
  - `flock` refuse un **second déploiement concurrent** : deux `npm ci` se marcheraient
    dessus.
- 🔴 **Contrôle de fraîcheur, parce qu'un HTTP 200 ne prouve rien sur la version servie** —
  l'ancienne répond tout aussi bien. Deux vérifications, exactement les deux indicateurs
  que personne n'avait regardés le 24/09 :
  1. `.next/BUILD_ID` doit être **postérieur au début du déploiement** — sinon le build n'a
     pas tourné ;
  2. l'heure de démarrage de **pm2** doit être **postérieure au build** — sinon le nouveau
     code est compilé mais pas servi.
  Le script affiche les trois horodatages (commit, build, démarrage pm2) et échoue en
  nommant le geste de rattrapage.
- ⚠️ **`git rev-parse` ne prouve rien.** Il dit que le code est arrivé sur le disque, pas
  qu'il est compilé ni servi. Ne jamais annoncer un déploiement sur cette seule base.
- **Essais à blanc** : `GESTLOG_DIR`, `GESTLOG_DEPLOY_LOG`, `GESTLOG_DEPLOY_STATUS` et
  `GESTLOG_DEPLOY_LOCK` permettent de rejouer le script sur des dossiers jetables, avec des
  leurres `git`/`npm`/`pm2`/`curl` dans le `PATH` — aucune de ces variables n'est définie en
  exploitation. Cas éprouvés : succès, build non produit, pm2 antérieur au build, tests en
  échec, santé HTTP non conforme, déploiement concurrent.

## Sauvegardes et reprise après sinistre

**`ops/backup-full.sh`, toutes les heures à HH:12.** Une exécution produit un
instantané autonome dans `/var/backups/gestlog/snapshots/AAAA-MM-JJ_HHMM/` :

| Fichier | Contenu | Taille |
|---|---|---|
| `base.dump` | `pg_dump -Fc` de la base Supabase | ~50 Mo |
| `config.tar.gz` | `.env`, scripts d'exploitation, nginx, pm2, crontab, commit git | ~10 Ko |
| `MANIFESTE.txt` | inventaire, empreintes SHA-256, commande de restauration | 1 Ko |

- **Coût** : 9 s de dump, 1 s de vérification. Indolore à la fréquence horaire.
- **Rotation dégressive** : tout pendant 48 h, puis un par jour pendant 30 jours,
  puis un par semaine pendant 12 semaines. Palier d'équilibre ≈ **90 instantanés,
  4,5 Go** (éprouvé à blanc sur 150 jours simulés : 1 200 → 55, rien au-delà de
  84 jours). Le disque fait 72 Go dont 60 libres.
- 🔴 **La rotation n'a lieu qu'APRÈS un instantané prouvé valide.** Une exécution
  ratée ne purge rien et ne laisse aucun résidu : le pire scénario est de vieillir
  d'une heure, jamais de perdre ce qui existe.
- 🔴 **La vérification DÉCODE l'archive en entier** (`pg_restore -f -` vers `wc`,
  rien écrit sur disque), pas seulement sa table des matières : *l'index d'un dump
  tronqué se lit encore très bien*. Contrôles : 42 tables de données minimum,
  `pg_restore` muet, empreintes SHA-256 au manifeste.
- **Garde-fous** : `flock` (deux exécutions ne se croisent jamais), arrêt si moins
  de 5 Go libres, journal raccourci sur place (`cat >`, pas `mv` — cron garde le
  fichier ouvert en ajout).
- ⚠️ **`config.tar.gz` contient les secrets** (`.env`). Instantanés en `0700`/`0600`,
  lisibles du seul compte `ubuntu`. Ne jamais les recopier ailleurs en clair.
- ⚠️ **Ne touche pas à la caisse** (`caissepro-api`), qui a sa propre sauvegarde
  (cron **root**, 3 h, `/var/backups/caissepro`).

### Où on en est, et comment on revient

```bash
/var/www/gestlog/restore-gestlog.sh --liste                    # inventaire + état
cat /var/backups/gestlog/ETAT.txt                              # dernière exécution
/var/www/gestlog/restore-gestlog.sh 2026-09-15_1506 --verifier # empreintes + relecture
/var/www/gestlog/restore-gestlog.sh 2026-09-15_1506 --extraire-config /tmp/reprise
/var/www/gestlog/restore-gestlog.sh 2026-09-15_1506 --restaurer-base   # ⚠️ ÉCRASE
```

`--restaurer-base` exige de taper `RESTAURER`, prend d'abord un dump de sécurité de
l'état courant (`AVANT-RESTAURATION-*.dump`), arrête pm2 le temps de l'opération et
contrôle le retour en HTTP 200. Le retour arrière reste donc possible.

⚠️ **`--extraire-config` : `chmod` APRÈS `tar`, jamais avant.** tar réapplique sur le
dossier de destination les droits portés par l'archive et écraserait un `chmod`
préalable — le dossier ressortait en `0775` alors que le script annonçait `0700`.

### Ce qui survit à quoi

| Sinistre | Ce qu'on perd | Ce qui sauve |
|---|---|---|
| Fausse manipulation, données écrasées | jusqu'à 1 h de saisie | instantané horaire local |
| Disque ou VPS détruit | **la configuration et les secrets** | copie hors-site chiffrée (Backblaze B2) |
| Perte du compte Supabase | la base | instantané horaire, local et hors-site |
| Perte du compte OVH | le serveur entier | hors-site chez un **autre** hébergeur |

🔴 **Une sauvegarde posée sur la machine qu'elle protège ne protège pas de la perte
de cette machine.** Le code vit sur GitHub et la base chez Supabase : un VPS détruit
ne fait perdre que `config.tar.gz` — **10 Ko, mais sans lesquels on ne redémarre
pas** (secrets, nginx, pm2, crons).

### Copie hors-site chiffrée (`ops/backup-offsite.sh`)

`backup-full.sh` appelle `backup-offsite.sh` en dernier, **après** avoir écrit l'état
local : un hors-site en panne ne doit jamais faire passer pour ratée une sauvegarde
locale valide. Tant que le remote n'existe pas, l'étape s'annonce et ne fait rien.

Le distant est un remote rclone **`crypt`** : noms de fichiers ET contenus sont
chiffrés **avant** de quitter le serveur — le fournisseur ne voit ni le `.env`, ni les
données clients. Destination retenue : **Backblaze B2**, chez un autre hébergeur que
le VPS (perdre le compte OVH ne doit pas emporter les deux), 10 Go gratuits pour un
besoin de ~4,5 Go.

Mise en service, **une seule fois, depuis le terminal de l'exploitant** :

```bash
ssh ubuntu@51.77.149.138
/var/www/gestlog/setup-hors-site.sh
```

⚠️ Ce script demande le `keyID` et l'`applicationKey` B2 : ils ne doivent transiter
par **aucune** conversation ni aucun fichier versionné. Il engendre lui-même le mot de
passe de chiffrement et l'affiche **une seule fois**.

🔴 **Ce mot de passe doit vivre dans un gestionnaire de mots de passe, hors du
serveur.** Il est aussi dans `~/.config/rclone/rclone.conf` — donc dans la sauvegarde,
elle-même chiffrée avec lui. C'est le seul secret racine : sans copie externe, un VPS
détruit rend la copie hors-site définitivement illisible.

⚠️ **`rclone sync` recopie aussi les suppressions** — c'est ce qui maintient le distant
à la même rotation que le local, mais un effacement accidentel se propagerait.
Deux filets : `--max-delete 5` (la rotation normale n'en retire qu'un ou deux par
heure) et, côté bucket, `hard_delete=false` + un cycle de vie « conserver les versions
précédentes 7 jours » à régler dans l'interface Backblaze.

Dépannage : `rclone listremotes`, `rclone lsd hors-site:`, `rclone size hors-site:`.

### Essais à blanc

`backup-full.sh` accepte `GESTLOG_DIR`, `GESTLOG_BACKUP_DIR` et `GESTLOG_LOCK` pour
être rejoué sur des dossiers jetables — **cron n'en définit aucune**. Cas éprouvés :
base injoignable, disque plein, exécutions concurrentes, rotation sur 150 jours.

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
13. **Changer les droits d'un utilisateur DÉJÀ CONNECTÉ** : `screenAccess` est **figé dans le
    jeton de session** (`scr`) à la connexion, alors que `/api/auth/me` — qui alimente le
    **menu** — le relit en **base**. Les deux divergeaient : le nouvel écran **apparaissait**
    dans le menu, mais le **middleware** (qui ne lit que le jeton) le refusait et renvoyait
    l'utilisateur sur son 1er écran autorisé. *Symptôme vécu (20/08/2026) : « j'ai donné
    l'accès À vendre à Nathalie, elle clique dessus et retombe sur le dashboard ».*
    → **Corrigé** : `/api/auth/me` **réémet le cookie** dès que le jeton est en retard sur la
    base (rôle ou écrans). Un simple **rechargement de page** suffit désormais, plus besoin de
    se déconnecter. ⚠️ Si tu ajoutes une autre donnée au jeton, pense à l'inclure dans cette
    comparaison — sinon le même décalage réapparaîtra.

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

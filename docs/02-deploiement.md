# 02 — Déploiement & infrastructure

## Où tourne GestLog

- **Hébergement** : VPS **OVH**, IP **`51.77.149.138`** (migré depuis Vercel — Phase 1).
- **Accès SSH** : `ssh -o BatchMode=yes ubuntu@51.77.149.138` (clé déjà en place ; pas de
  mot de passe).
- **Répertoire app** : **`/var/www/gestlog`**.
- **Process** : **pm2**, process nommé **`gestlog`**, port **3000**
  (`pm2 restart gestlog --update-env`, `pm2 logs gestlog`).
- **Domaine** : **`https://gestlog.techincash.app`** (reverse proxy en façade du port 3000).
- **Repo** : GitHub **`KantMad/gestlog`**, branche **`main`**. Le VPS fait `git pull` depuis
  `main`. **Pousser sur `main` ne déploie pas tout seul** : il faut lancer `deploy.sh`.

## ⚠️ Coexistence avec la caisse — NE PAS TOUCHER

Sur **le même VPS** tourne une **autre application**, la caisse **CaissePro** :
- pm2 **id 0**, répertoire **`/var/www/caissepro-api`**, domaine **`api.techincash.app`**,
  port **3500**.
- **Ne jamais modifier, redémarrer ni toucher** `caissepro-api`, son code ou sa base. GestLog
  ne fait que lui **envoyer** des données (intégration sortante, voir
  [`06-integration-caisse.md`](06-integration-caisse.md)).

## Déploiement : `deploy.sh`

Le script vit **sur le VPS** dans `/var/www/gestlog/deploy.sh` (il n'est pas dans le repo).
Lancer un déploiement :

```bash
ssh -o BatchMode=yes ubuntu@51.77.149.138 'cd /var/www/gestlog && bash deploy.sh'
```

Étapes (toutes bloquantes — si une échoue, l'ancienne version reste en ligne) :

1. **Sauvegarde base** : `./backup-db.sh` (dump avant toute modif).
2. **Code** : `git pull --ff-only` (fast-forward only ; pas de merge surprise).
3. **Dépendances** : `npm ci`.
4. **Client Prisma** : `npx prisma generate`.
5. **Tests unitaires (BLOQUANT)** : `npm test` (Vitest). En échec → **déploiement
   interrompu**.
6. **Schéma base (additif)** : `npx prisma db push`. ⚠️ **Additif seulement** — voir
   [`03-base-de-donnees.md`](03-base-de-donnees.md) sur les changements destructifs.
7. **Build** : `npm run build` (qui fait aussi `prisma generate`).
8. **Redémarrage** : `pm2 restart gestlog --update-env`, puis **contrôle de santé**
   (`curl localhost:3000/login` doit renvoyer **HTTP 200**).

Sortie attendue en fin : `✅ Déploiement réussi — GestLog répond (HTTP 200).`

### Bonnes pratiques de déploiement
- Toujours **`npm run build` en local** avant de pousser (attrape les erreurs TypeScript).
- Commiter, **pousser sur `main`**, puis lancer `deploy.sh`.
- Filtrer le bruit en lisant la sortie : `grep -iE "tests OK|HTTP|réussi|échou|Error|Redémarr"`.

## Variables d'environnement

Dans **`/var/www/gestlog/.env`** (chargées au runtime ; **absentes** de `/proc/<pid>/environ`).
**Ne jamais les afficher en clair ni les commiter.** Liste (noms uniquement) :

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | Connexion Postgres (Supabase) — voir [`03`](03-base-de-donnees.md) |
| `SESSION_SECRET` | Clé HMAC de signature des jetons de session |
| `SYNC_API_KEY` | Clé `x-api-key` attendue par les endpoints `/api/sync/*` (utilisée par n8n) |
| `GESTLOG_CAISSE_SECRET` | Secret partagé envoyé à la caisse (`X-Gestlog-Secret`) |
| `CAISSE_TRIGGER_STATUS` | Statut de livraison qui déclenche l'envoi caisse (défaut `EXPEDIEE`) |
| `CAISSE_STORE_ID` | (optionnel) id magasin envoyé à la caisse |
| `BREVO_API_KEY` | Clé API Brevo |
| `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME` | Expéditeur Brevo |
| `BREVO_VIP_LIST_ID` / `BREVO_VIP_THRESHOLD` | Liste VIP Brevo + seuil (€) |
| `NODE_ENV` | `production` sur le VPS (active cookies `secure`, etc.) |

### Manipuler un secret depuis le `.env` (piège)
L'extraction shell (`cut`/`tr`) **corrompt** les secrets longs (ex. le secret caisse 64
caractères devenait 56). **Parser en Node** :
```js
fs.readFileSync('/var/www/gestlog/.env','utf8').match(/^KEY=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'')
```

## Scripts présents sur le VPS (hors repo)
- `deploy.sh` — déploiement (ci-dessus).
- `backup-db.sh` — dump de la base (appelé par `deploy.sh`, logs dans `/var/backups/gestlog/`).
- `caisse-retry.sh` — relance les envois caisse en échec (cron */15 min). Voir
  [`06-integration-caisse.md`](06-integration-caisse.md) et
  [`09-operations-et-gotchas.md`](09-operations-et-gotchas.md).

## Crons
Voir [`09-operations-et-gotchas.md`](09-operations-et-gotchas.md) pour la liste complète
(retry caisse côté VPS + synchronisations planifiées côté n8n).

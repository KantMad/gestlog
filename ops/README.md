# ops/ — scripts d'exploitation du VPS

Ces scripts **tournent sur le VPS**, dans `/var/www/gestlog/`. Ils sont versionnés
ici parce qu'ils n'existaient nulle part ailleurs : un serveur perdu les emportait.

| Script | Rôle | Déclenché par |
|---|---|---|
| `backup-full.sh` | sauvegarde complète (base + configuration), vérifiée et tournante | cron, toutes les heures à HH:12 |
| `restore-gestlog.sh` | inventaire, vérification, extraction, restauration | à la main |
| `backup-offsite.sh` | copie chiffrée des instantanés vers Backblaze B2 | `backup-full.sh`, en fin de course |
| `setup-hors-site.sh` | mise en service du hors-site (une seule fois) | à la main, sur le VPS |
| `backup-db.sh` | dump de la base seul | `deploy.sh` + cron 3 h |
| `deploy.sh` | déploiement (sauvegarde → git → tests bloquants → build → pm2) | à la main |
| `caisse-retry.sh` | relance des envois caisse en échec | cron, toutes les 15 min |

⚠️ **La version qui fait foi est celle du serveur** — c'est elle que la sauvegarde
horaire capture. Ces copies sont la référence de lecture et de revue ; si elles
divergent, `backup-full.sh` le signale dans son journal.

Après modification ici, remonter le fichier :

```bash
scp ops/backup-full.sh ubuntu@51.77.149.138:/var/www/gestlog/
ssh ubuntu@51.77.149.138 'chmod +x /var/www/gestlog/backup-full.sh'
```

Tout est détaillé dans [`../docs/09-operations-et-gotchas.md`](../docs/09-operations-et-gotchas.md).

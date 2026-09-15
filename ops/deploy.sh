#!/bin/bash
# Déploiement GestLog : sauvegarde → code → deps → tests → schéma → build → redémarre → vérifie.
# Si un test échoue, on s'arrête AVANT le build/redémarrage (l'ancienne version reste en ligne).
# Usage : ./deploy.sh   (depuis /var/www/gestlog, sur le VPS)
set -euo pipefail
cd /var/www/gestlog

echo "▶ [1/8] Sauvegarde de la base…"
./backup-db.sh && echo "   ✓ sauvegarde OK"

echo "▶ [2/8] Récupération du code…"
git pull --ff-only

echo "▶ [3/8] Dépendances…"
npm ci

echo "▶ [4/8] Client Prisma…"
npx prisma generate

echo "▶ [5/8] Tests unitaires (bloquant)…"
if ! npm test; then
  echo "❌ Tests en échec — déploiement interrompu. L'ancienne version reste en ligne."
  exit 1
fi
echo "   ✓ tests OK"

echo "▶ [6/8] Schéma base (additif uniquement)…"
npx prisma db push

echo "▶ [7/8] Build…"
npm run build

echo "▶ [8/8] Redémarrage…"
pm2 restart gestlog --update-env

echo "▶ Contrôle de santé…"
sleep 3
CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/login || echo "000")
if [ "$CODE" = "200" ]; then
  echo "✅ Déploiement réussi — GestLog répond (HTTP 200)."
else
  echo "⚠️  GestLog répond HTTP $CODE — voir 'pm2 logs gestlog'."
  exit 1
fi

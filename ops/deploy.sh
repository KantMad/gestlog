#!/bin/bash
# Déploiement GestLog : sauvegarde → code → deps → tests → schéma → build → redémarre →
# vérifie la santé → vérifie la FRAÎCHEUR.
# Si un test échoue, on s'arrête AVANT le build/redémarrage (l'ancienne version reste en ligne).
# Usage : ./deploy.sh   (depuis /var/www/gestlog, sur le VPS)
#
# 🔴 LE SCRIPT SE DÉTACHE TOUT SEUL du terminal appelant. *Le 24/09/2026, une connexion SSH
# est tombée juste après `git pull` : le build et le redémarrage n'ont jamais tourné, et
# l'application a continué à servir un build vieux de deux heures — sans que rien ne le
# signale.* Désormais le travail se fait dans un processus `setsid`, et l'appelant ne fait
# que SUIVRE le journal : une coupure tue le suivi, plus le déploiement.
set -euo pipefail
# `GESTLOG_DIR` n'existe que pour les essais à blanc (cf. docs/09) ; en exploitation on
# déploie toujours /var/www/gestlog.
cd "${GESTLOG_DIR:-/var/www/gestlog}"

# Chemins surchargeables UNIQUEMENT pour les essais à blanc (cf. docs/09) : en
# exploitation, personne ne définit ces variables.
JOURNAL=${GESTLOG_DEPLOY_LOG:-/var/backups/gestlog/deploy.log}
ETAT=${GESTLOG_DEPLOY_STATUS:-/var/backups/gestlog/deploy.status}
VERROU=${GESTLOG_DEPLOY_LOCK:-/var/lock/gestlog-deploy.lock}

# ─── Étage 1 : l'appelant. Lance le détaché, suit le journal, rend SON code de sortie ───
if [ "${GESTLOG_DEPLOY_DETACHED:-}" != "1" ]; then
  # Un déploiement à la fois : deux `npm ci` concurrents se marcheraient dessus.
  exec 8>"$VERROU"
  if ! flock -n 8; then
    echo "⛔ Un déploiement est déjà en cours. Le suivre : tail -f $JOURNAL"
    exit 1
  fi

  rm -f "$ETAT"
  : > "$JOURNAL"
  GESTLOG_DEPLOY_DETACHED=1 setsid nohup bash "$0" "$@" >> "$JOURNAL" 2>&1 < /dev/null &
  echo "▶ Déploiement détaché (journal : $JOURNAL) — une coupure de connexion ne l'interrompra pas."

  tail -f -n +1 "$JOURNAL" &
  SUIVI=$!
  # ⚠️ On attend le FICHIER D'ÉTAT, pas la fin du `tail` : c'est le processus détaché qui
  # écrit son code de sortie, et lui seul fait foi.
  until [ -f "$ETAT" ]; do sleep 2; done
  sleep 1   # laisser le suivi vider son tampon
  kill "$SUIVI" 2>/dev/null || true
  wait "$SUIVI" 2>/dev/null || true
  exit "$(cat "$ETAT" 2>/dev/null || echo 1)"
fi

# ─── Étage 2 : le processus détaché ────────────────────────────────────────────────────
# Le code de sortie est publié quoi qu'il arrive — y compris sur un `set -e`.
publier() { echo "$?" > "$ETAT"; }
trap publier EXIT

# Repère de départ : tout artefact plus ancien que T0 n'a PAS été produit par ce
# déploiement. C'est la base du contrôle de fraîcheur.
T0=$(date +%s)
echo "── $(date '+%Y-%m-%d %H:%M:%S %Z') — déploiement de $(git rev-parse --short HEAD 2>/dev/null || echo '?') ──"

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
if [ "$CODE" != "200" ]; then
  echo "⚠️  GestLog répond HTTP $CODE — voir 'pm2 logs gestlog'."
  exit 1
fi
echo "   ✓ HTTP 200"

# ─── Contrôle de fraîcheur ─────────────────────────────────────────────────────────────
# 🔴 Un HTTP 200 ne prouve RIEN sur la version servie : l'ancienne répond tout aussi bien.
# Les deux seuls indicateurs qui le disent sont la date du BUILD et l'heure de démarrage
# de pm2. C'est précisément ce que personne n'avait regardé le 24/09/2026.
echo "▶ Contrôle de fraîcheur…"
COMMIT=$(git rev-parse --short HEAD)
BUILD=$(stat -c %Y .next/BUILD_ID 2>/dev/null || echo 0)
DEMARRAGE=$(pm2 jlist 2>/dev/null | python3 -c '
import sys, json
try:
    p = next(x for x in json.load(sys.stdin) if x["name"] == "gestlog")
    print(int(p["pm2_env"].get("pm_uptime", 0) // 1000))
except Exception:
    print(0)
' 2>/dev/null || echo 0)

# ⚠️ Le serveur tourne en UTC : on AFFICHE le fuseau, sinon un lecteur parisien croit
# lire son heure et se trompe de deux heures. La comparaison, elle, se fait sur des
# secondes epoch — indifférentes au fuseau.
dateh() { [ "$1" -gt 0 ] && date -d "@$1" '+%H:%M:%S %Z' || echo "inconnue"; }
echo "   commit $COMMIT · build $(dateh "$BUILD") · pm2 démarré $(dateh "$DEMARRAGE") · déploiement lancé $(dateh "$T0")"

if [ "$BUILD" -lt "$T0" ]; then
  echo "❌ Le build est ANTÉRIEUR au début du déploiement : il n'a pas tourné."
  echo "   L'application sert encore la version précédente. Relancer ./deploy.sh."
  exit 1
fi
if [ "$DEMARRAGE" -lt "$BUILD" ]; then
  echo "❌ pm2 a démarré AVANT le build : le nouveau code n'est pas servi."
  echo "   Relancer : pm2 restart gestlog --update-env"
  exit 1
fi

echo "✅ Déploiement réussi — commit $COMMIT compilé, servi et répondant (HTTP 200)."

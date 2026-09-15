#!/bin/bash
# ─── Restauration GestLog ────────────────────────────────────────────────────
# Une sauvegarde qu'on n'a jamais su relire n'est pas une sauvegarde. Ce script
# est le chemin de retour : il liste, vérifie, extrait, et — sur demande
# explicite — réécrit la base.
#
#   ./restore-gestlog.sh --liste
#   ./restore-gestlog.sh 2026-09-15_1500 --verifier
#   ./restore-gestlog.sh 2026-09-15_1500 --extraire-config /tmp/reprise
#   ./restore-gestlog.sh 2026-09-15_1500 --restaurer-base      ⚠️ ÉCRASE LA BASE
#
# ⚠️ `--restaurer-base` est IRRÉVERSIBLE : elle remplace le contenu de la base de
# production. Elle exige une confirmation tapée à la main et prend d'abord un
# dump de sécurité de l'état actuel — pour qu'une restauration ratée reste elle
# aussi rattrapable.
set -euo pipefail

APP_DIR=/var/www/gestlog
ROOT=/var/backups/gestlog/snapshots

rouge() { printf '\033[31m%s\033[0m\n' "$*"; }
vert()  { printf '\033[32m%s\033[0m\n' "$*"; }

usage() { sed -n '2,16p' "$0" | sed 's/^# \?//'; exit "${1:-0}"; }

SNAP_NAME=${1:-}
ACTION=${2:---verifier}

if [ -z "$SNAP_NAME" ] || [ "$SNAP_NAME" = "--aide" ] || [ "$SNAP_NAME" = "-h" ]; then usage 0; fi

if [ "$SNAP_NAME" = "--liste" ]; then
  echo "Instantanés disponibles dans $ROOT :"
  echo
  printf '  %-20s %8s %8s  %s\n' "INSTANTANÉ" "BASE" "CONFIG" "ÉTAT"
  for d in $(ls -1 "$ROOT" 2>/dev/null | sort -r); do
    b=$(du -h "$ROOT/$d/base.dump" 2>/dev/null | cut -f1 || echo "—")
    c=$(du -h "$ROOT/$d/config.tar.gz" 2>/dev/null | cut -f1 || echo "—")
    if pg_restore --list "$ROOT/$d/base.dump" >/dev/null 2>&1; then e="lisible"; else e="⚠ ILLISIBLE"; fi
    printf '  %-20s %8s %8s  %s\n' "$d" "$b" "$c" "$e"
  done
  echo
  cat /var/backups/gestlog/ETAT.txt 2>/dev/null || true
  exit 0
fi

SNAP=$ROOT/$SNAP_NAME
[ -d "$SNAP" ] || { rouge "Instantané introuvable : $SNAP"; echo "→ ./restore-gestlog.sh --liste"; exit 1; }

case "$ACTION" in
  --verifier)
    echo "── Vérification de $SNAP_NAME ──"
    cat "$SNAP/MANIFESTE.txt"
    echo
    echo "── Contrôle des empreintes ──"
    ( cd "$SNAP" && grep -E '^[0-9a-f]{64}  ' MANIFESTE.txt | sha256sum -c - )
    echo
    echo "── Relecture du dump ──"
    n=$(pg_restore --list "$SNAP/base.dump" | grep -c ';')
    vert "✓ $n objets relus — le dump est exploitable."
    ;;

  --extraire-config)
    DEST=${3:-}
    [ -n "$DEST" ] || { rouge "Indiquer un dossier de destination."; exit 1; }
    mkdir -p "$DEST"
    tar -xzf "$SNAP/config.tar.gz" -C "$DEST"
    # ⚠️ APRÈS l'extraction, jamais avant : tar réapplique les droits portés par
    # l'archive sur le dossier de destination et écraserait un chmod préalable.
    chmod -R go-rwx "$DEST"
    vert "✓ Configuration extraite dans $DEST — contient .env, droits réduits au seul propriétaire :"
    ls -ld "$DEST" "$DEST/gestlog/.env"
    echo
    echo "Remise en service d'un serveur neuf :"
    echo "  1. git clone \$(git -C $APP_DIR remote get-url origin) /var/www/gestlog"
    echo "  2. git checkout \$(head -1 $DEST/systeme/version-git.txt)"
    echo "  3. cp $DEST/gestlog/.env /var/www/gestlog/.env && chmod 600 /var/www/gestlog/.env"
    echo "  4. cp $DEST/gestlog/scripts/*.sh /var/www/gestlog/ && chmod +x /var/www/gestlog/*.sh"
    echo "  5. cp $DEST/systeme/nginx-gestlog.conf /etc/nginx/sites-available/gestlog && nginx -s reload"
    echo "  6. crontab $DEST/systeme/crontab-ubuntu.txt"
    echo "  7. npm ci && npx prisma generate && npm run build && pm2 start … && pm2 save"
    ;;

  --restaurer-base)
    rouge "⚠️  RESTAURATION DE LA BASE DE PRODUCTION"
    echo
    echo "Instantané : $SNAP_NAME"
    sed -n '2,6p' "$SNAP/MANIFESTE.txt"
    echo
    rouge "Tout ce qui a été saisi DEPUIS cet instantané sera perdu."
    echo
    DBURL=$(grep -E '^DATABASE_URL=' "$APP_DIR/.env" | sed 's/^DATABASE_URL=//' | tr -d "\"'")
    [ -n "$DBURL" ] || { rouge "DATABASE_URL introuvable."; exit 1; }

    if [ "${3:-}" != "--sans-confirmation" ]; then
      printf 'Taper exactement RESTAURER pour continuer : '
      read -r rep
      [ "$rep" = "RESTAURER" ] || { echo "Abandon."; exit 1; }
    fi

    SECU=/var/backups/gestlog/AVANT-RESTAURATION-$(date '+%Y%m%d-%H%M%S').dump
    echo "→ Dump de sécurité de l'état actuel : $SECU"
    pg_dump "$DBURL" -Fc -f "$SECU"
    chmod 600 "$SECU"
    vert "  ✓ état actuel sauvegardé ($(du -h "$SECU" | cut -f1))"

    echo "→ Arrêt de l'application (personne n'écrit pendant la restauration)…"
    pm2 stop gestlog || true

    echo "→ Restauration…"
    # --clean --if-exists : on remplace, sans échouer sur un objet absent.
    # --no-owner/--no-acl : Supabase gère ses propres rôles.
    pg_restore --clean --if-exists --no-owner --no-acl --dbname "$DBURL" "$SNAP/base.dump" || {
      rouge "pg_restore a signalé des erreurs — vérifier ci-dessus avant de redémarrer."
    }

    echo "→ Redémarrage…"
    pm2 start gestlog 2>/dev/null || pm2 restart gestlog
    sleep 3
    CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/login || echo 000)
    if [ "$CODE" = "200" ]; then vert "✅ Restauré — GestLog répond (HTTP 200)."
    else rouge "⚠️  GestLog répond HTTP $CODE — voir 'pm2 logs gestlog'."; fi
    echo
    echo "Retour arrière possible avec : $SECU"
    ;;

  *) usage 1 ;;
esac

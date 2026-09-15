#!/bin/bash
# ─── Copie hors-site des instantanés ─────────────────────────────────────────
# Envoie /var/backups/gestlog/snapshots vers un stockage objet, CHIFFRÉ.
#
# Pourquoi : une sauvegarde posée sur la machine qu'elle protège ne protège pas
# de la perte de cette machine. Le code vit sur GitHub, la base chez Supabase —
# mais `config.tar.gz` (secrets, nginx, pm2, crons) n'existe QUE sur le VPS.
#
# ⚠️ Le distant est un remote rclone `crypt` : noms de fichiers ET contenus sont
# chiffrés avant de quitter le serveur. Le fournisseur ne voit jamais ni le .env
# ni les données clients.
#
# ⚠️ LE MOT DE PASSE DU CHIFFREMENT DOIT VIVRE AILLEURS (gestionnaire de mots de
# passe). Il est dans ~/.config/rclone/rclone.conf, donc dans la sauvegarde —
# qui est elle-même chiffrée avec lui. Sans copie externe de ce mot de passe,
# un VPS détruit rend la copie hors-site illisible.
#
# Tant que le remote n'existe pas, ce script ne fait rien et ne fait échouer
# personne : la sauvegarde locale reste complète.
set -euo pipefail

BASE=${GESTLOG_BACKUP_DIR:-/var/backups/gestlog}
ROOT=$BASE/snapshots
ETAT=$BASE/ETAT.txt
REMOTE=${GESTLOG_REMOTE:-hors-site:gestlog}
MAX_SUPPR=5   # garde-fou : voir plus bas

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

if ! command -v rclone >/dev/null 2>&1; then
  log "  ⏭  hors-site : rclone absent"
  exit 0
fi
if ! rclone listremotes 2>/dev/null | grep -q "^${REMOTE%%:*}:"; then
  log "  ⏭  hors-site : remote « ${REMOTE%%:*} » pas encore configuré (cf. docs/09)"
  echo "Hors-site           : NON CONFIGURÉ" >> "$ETAT"
  exit 0
fi

T0=$(date +%s)
# ⚠️ `sync` recopie AUSSI les suppressions : c'est ce qui maintient le distant à
# la même rotation que le local. Mais un effacement accidentel du local se
# propagerait. `--max-delete` refuse donc le carnage : en régime normal la
# rotation ne retire qu'un ou deux instantanés par heure.
if OUT=$(rclone sync "$ROOT" "$REMOTE" \
      --max-delete "$MAX_SUPPR" \
      --transfers 2 --checkers 4 \
      --stats-one-line --stats 0 2>&1); then
  DUREE=$(( $(date +%s) - T0 ))
  TAILLE=$(rclone size "$REMOTE" --json 2>/dev/null | grep -oE '"bytes":[0-9]+' | cut -d: -f2)
  MO=$(( ${TAILLE:-0} / 1024 / 1024 ))
  log "  ✓ hors-site : synchronisé en ${DUREE}s (${MO} Mo chiffrés à distance)"
  echo "Hors-site           : OK — $(date '+%H:%M:%S'), ${MO} Mo" >> "$ETAT"
else
  log "  ⚠ hors-site EN ÉCHEC : $(echo "$OUT" | tail -2 | tr '\n' ' ')"
  echo "Hors-site           : ⚠ ÉCHEC — $(date '+%H:%M:%S')" >> "$ETAT"
  # Volontairement sans échec : la sauvegarde locale, elle, est bonne.
  # Un hors-site en panne ne doit pas faire passer la sauvegarde pour ratée.
  exit 0
fi

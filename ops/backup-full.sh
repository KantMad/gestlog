#!/bin/bash
# ─── Sauvegarde complète GestLog ─────────────────────────────────────────────
# Base de données + configuration, toutes les heures, avec vérification et
# rotation. Une exécution produit UN instantané autonome :
#
#   /var/backups/gestlog/snapshots/2026-09-15_1500/
#       base.dump        pg_dump -Fc de la base Supabase
#       config.tar.gz    .env, scripts d'exploitation, nginx, pm2, crontab
#       MANIFESTE.txt    contenu, tailles, empreintes SHA-256, commit git
#
# ⚠️ NE TOUCHE PAS à l'application caisse (`caissepro-api`) ni à ses données :
# elle a sa propre sauvegarde (cron root, 3 h). Ce script ne lit que GestLog.
#
# ⚠️ `config.tar.gz` CONTIENT LES SECRETS (.env). Les instantanés sont donc en
# 0700 / 0600, lisibles du seul compte `ubuntu`. Ne jamais les recopier ailleurs
# en clair.
#
# Rotation (dégressive) : tout ce qui a moins de 48 h, puis le premier
# instantané de chaque jour sur 30 jours, puis le premier de chaque semaine sur
# 12 semaines. La purge n'a lieu QU'APRÈS un instantané valide : une exécution
# ratée ne doit jamais effacer de sauvegardes saines.
set -euo pipefail

# Chemins surchargeables UNIQUEMENT pour les essais à blanc (cf. docs/09) :
# en exploitation, cron ne définit ni l'une ni l'autre de ces variables.
APP_DIR=${GESTLOG_DIR:-/var/www/gestlog}
BASE=${GESTLOG_BACKUP_DIR:-/var/backups/gestlog}
ROOT=$BASE/snapshots
ETAT=$BASE/ETAT.txt
LOG=$BASE/backup-full.log
LOCK=${GESTLOG_LOCK:-/var/lock/gestlog-backup.lock}

KEEP_HOURS=48   # tout garder pendant 2 jours
KEEP_DAYS=30    # puis un par jour pendant 1 mois
KEEP_WEEKS=12   # puis un par semaine pendant 3 mois
MIN_FREE_GB=5   # en dessous : on s'arrête plutôt que de remplir le disque

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

# Une seule exécution à la fois : un dump lent ne doit pas croiser le suivant.
exec 9>"$LOCK"
if ! flock -n 9; then
  log "⏭  une sauvegarde est déjà en cours — exécution ignorée"
  exit 0
fi

# Journal : 24 exécutions/jour finissent par peser. On le raccourcit SUR PLACE
# (`cat >`, pas `mv`) : cron garde le fichier ouvert en ajout, changer d'inode
# lui ferait écrire dans le vide.
if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG")" -gt 5000000 ]; then
  tail -c 1000000 "$LOG" > "$LOG.tmp" && cat "$LOG.tmp" > "$LOG" && rm -f "$LOG.tmp"
fi

STAMP=$(date '+%Y-%m-%d_%H%M')
SNAP=$ROOT/$STAMP
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

echoue() {
  log "❌ ÉCHEC : $1"
  # D'abord jeter l'instantané incomplet, SANS toucher aux autres : pas de
  # rotation sur un échec, on ne purge jamais du sain à cause d'un raté.
  rm -rf "$SNAP"
  # Puis seulement désigner le dernier valide — sinon on nommerait celui qu'on
  # vient de supprimer.
  local dernier
  dernier=$(ls -1 "$ROOT" 2>/dev/null | grep -E '^[0-9]{4}-' | sort | tail -1)
  { echo "DERNIÈRE TENTATIVE : $(date '+%Y-%m-%d %H:%M:%S')"
    echo "RÉSULTAT           : ÉCHEC — $1"
    echo
    echo "Dernier instantané VALIDE : ${dernier:-aucun}"
    if [ -n "$dernier" ]; then
      echo "Pris le               : $(echo "$dernier" | sed 's/_\(..\)\(..\)$/ à \1h\2/')"
    fi
  } > "$ETAT"
  exit 1
}

mkdir -p "$ROOT"
chmod 700 "$ROOT"

FREE_GB=$(df -BG --output=avail "$ROOT" | tail -1 | tr -dc '0-9')
if [ "${FREE_GB:-0}" -lt "$MIN_FREE_GB" ]; then
  echoue "plus que ${FREE_GB} Go libres sur le disque (seuil : ${MIN_FREE_GB} Go)"
fi

log "▶ Instantané $STAMP (${FREE_GB} Go libres)"
mkdir -p "$SNAP"
chmod 700 "$SNAP"

# ─── 1. Base de données ──────────────────────────────────────────────────────
# L'URL est lue dans .env et n'est jamais écrite ni affichée.
DBURL=$(grep -E '^DATABASE_URL=' "$APP_DIR/.env" | sed 's/^DATABASE_URL=//' | tr -d "\"'")
[ -n "$DBURL" ] || echoue "DATABASE_URL introuvable dans $APP_DIR/.env"

T0=$(date +%s)
pg_dump "$DBURL" -Fc -f "$SNAP/base.dump" 2>"$STAGE/pg.err" || {
  echoue "pg_dump : $(head -2 "$STAGE/pg.err" | tr '\n' ' ')"
}
DUREE=$(( $(date +%s) - T0 ))

# ─── Vérification ────────────────────────────────────────────────────────────
# ⚠️ On DÉCODE L'ARCHIVE EN ENTIER (`pg_restore -f -`), sans rien écrire sur le
# disque. Lire la seule table des matières (`--list`) ne prouve rien : l'index
# d'un dump tronqué se lit encore très bien. Le décodage complet coûte ~1 s pour
# 207 Mo de SQL — le prix d'une sauvegarde dont on sait qu'elle se relit.
OBJETS=$(pg_restore --list "$SNAP/base.dump" 2>/dev/null | grep -c ';' || true)
if ! LU=$(pg_restore -f - "$SNAP/base.dump" 2>"$STAGE/rest.err" | awk '/^COPY /{n++} END{print (n+0)" "NR}'); then
  echoue "l'archive ne se décode pas : $(head -1 "$STAGE/rest.err")"
fi
TABLES=${LU% *}
if [ -s "$STAGE/rest.err" ]; then
  echoue "pg_restore proteste : $(head -1 "$STAGE/rest.err")"
fi
if [ "${TABLES:-0}" -lt 20 ]; then
  echoue "seulement $TABLES tables de données dans le dump — archive suspecte"
fi
log "  ✓ base : $(du -h "$SNAP/base.dump" | cut -f1) en ${DUREE}s — $OBJETS objets, $TABLES tables décodées intégralement"

# ─── 2. Configuration ────────────────────────────────────────────────────────
# Tout ce qui n'est PAS dans git et qui disparaîtrait avec le serveur.
mkdir -p "$STAGE/c/gestlog/scripts" "$STAGE/c/systeme"
# Droits restreints dès le montage : l'archive porte ses propres modes, et c'est
# eux qu'on retrouvera à l'extraction, où qu'elle ait lieu.
chmod -R go-rwx "$STAGE/c"
cp "$APP_DIR/.env" "$STAGE/c/gestlog/.env"
for f in deploy.sh backup-db.sh caisse-retry.sh backup-full.sh restore-gestlog.sh; do
  [ -f "$APP_DIR/$f" ] && cp "$APP_DIR/$f" "$STAGE/c/gestlog/scripts/$f"
done
cp /etc/nginx/sites-available/gestlog "$STAGE/c/systeme/nginx-gestlog.conf" 2>/dev/null || true
cp "$HOME/.pm2/dump.pm2" "$STAGE/c/systeme/pm2-dump.pm2" 2>/dev/null || true
crontab -l > "$STAGE/c/systeme/crontab-ubuntu.txt" 2>/dev/null || true
git -C "$APP_DIR" log -1 --format='%H%n%cI%n%s' > "$STAGE/c/systeme/version-git.txt" 2>/dev/null || true

tar -czf "$SNAP/config.tar.gz" -C "$STAGE/c" .
chmod 600 "$SNAP/config.tar.gz" "$SNAP/base.dump"
log "  ✓ configuration : $(du -h "$SNAP/config.tar.gz" | cut -f1)"

# ─── 3. Manifeste ────────────────────────────────────────────────────────────
COMMIT=$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo "inconnu")
{
  echo "Instantané GestLog — $STAMP"
  echo "Serveur  : $(hostname) ($(hostname -I | awk '{print $1}'))"
  echo "Code     : commit $COMMIT sur $(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  echo "Base     : $OBJETS objets, $TABLES tables, dump en ${DUREE}s"
  echo "Vérifié  : archive décodée intégralement, sans erreur"
  echo
  echo "Contenu :"
  ( cd "$SNAP" && sha256sum base.dump config.tar.gz )
  ( cd "$SNAP" && ls -lh base.dump config.tar.gz | awk '{print "  "$9"  "$5}' )
  echo
  echo "Dans config.tar.gz :"
  tar -tzf "$SNAP/config.tar.gz" | grep -v '/$' | sed 's/^\./  /'
  echo
  echo "Restauration : /var/www/gestlog/restore-gestlog.sh $STAMP --verifier"
} > "$SNAP/MANIFESTE.txt"
chmod 600 "$SNAP/MANIFESTE.txt"

# ─── 4. Dérive des scripts ───────────────────────────────────────────────────
# Les scripts d'exploitation ont une copie de référence dans le dépôt (ops/).
# Si celle du serveur s'en écarte, c'est la sauvegarde qui fait foi — on le dit.
for f in deploy.sh backup-db.sh caisse-retry.sh backup-full.sh restore-gestlog.sh; do
  if [ -f "$APP_DIR/$f" ] && [ -f "$APP_DIR/ops/$f" ] && ! cmp -s "$APP_DIR/$f" "$APP_DIR/ops/$f"; then
    log "  ⚠ $f diffère de ops/$f (la version du serveur est bien sauvegardée)"
  fi
done

# ─── 5. Rotation ─────────────────────────────────────────────────────────────
# Uniquement ici, après un instantané prouvé valide.
rotation() {
  local now all name d hm epoch age_h age_d week w n purges=0
  local -A keep=() premier_jour=() premiere_semaine=()
  now=$(date +%s)
  mapfile -t all < <(ls -1 "$ROOT" 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}$' | sort)
  for name in "${all[@]}"; do
    d=${name%_*}; hm=${name#*_}
    epoch=$(date -d "$d ${hm:0:2}:${hm:2:2}" +%s 2>/dev/null) || continue
    age_h=$(( (now - epoch) / 3600 ))
    if [ "$age_h" -le "$KEEP_HOURS" ]; then keep[$name]=1; fi
    week=$(date -d "$d" +%G-%V)
    if [ -z "${premier_jour[$d]:-}" ]; then premier_jour[$d]=$name; fi
    if [ -z "${premiere_semaine[$week]:-}" ]; then premiere_semaine[$week]=$name; fi
  done
  for d in "${!premier_jour[@]}"; do
    age_d=$(( (now - $(date -d "$d" +%s)) / 86400 ))
    if [ "$age_d" -le "$KEEP_DAYS" ]; then keep[${premier_jour[$d]}]=1; fi
  done
  for w in "${!premiere_semaine[@]}"; do
    n=${premiere_semaine[$w]}; d=${n%_*}
    age_d=$(( (now - $(date -d "$d" +%s)) / 86400 ))
    if [ "$age_d" -le $(( KEEP_WEEKS * 7 )) ]; then keep[$n]=1; fi
  done
  for name in "${all[@]}"; do
    if [ -z "${keep[$name]:-}" ]; then
      rm -rf "${ROOT:?}/$name"
      purges=$(( purges + 1 ))
    fi
  done
  echo "$purges"
}
PURGES=$(rotation)
NB=$(ls -1 "$ROOT" | grep -cE '^[0-9]{4}-' || true)
log "  ✓ rotation : $PURGES purgé(s), $NB instantané(s) conservé(s), $(du -sh "$ROOT" | cut -f1) au total"

# ─── 6. État ─────────────────────────────────────────────────────────────────
{
  echo "DERNIÈRE SAUVEGARDE : $(date '+%Y-%m-%d %H:%M:%S')"
  echo "RÉSULTAT            : OK"
  echo "Instantané          : $STAMP"
  echo "Base                : $(du -h "$SNAP/base.dump" | cut -f1) — $OBJETS objets, $TABLES tables — ${DUREE}s"
  echo "Vérification        : archive décodée intégralement, sans erreur"
  echo "Conservés           : $NB instantanés, $(du -sh "$ROOT" | cut -f1)"
  echo "Disque libre        : ${FREE_GB} Go"
  echo
  echo "Le plus ancien : $(ls -1 "$ROOT" | sort | head -1)"
  echo "Le plus récent : $STAMP"
} > "$ETAT"

log "✅ Sauvegarde complète terminée — $STAMP"

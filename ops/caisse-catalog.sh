#!/bin/bash
# Envoie le CATALOGUE gestlog (fiches produits) a la caisse Tech in Cash.
#
# Le catalogue complet fait ~56 000 codes-barres : l'endpoint en traite autant qu'il peut
# dans son budget de temps puis renvoie `nextOffset`. On rappelle jusqu'a ce qu'il soit
# nul. L'import est rejouable a l'identique : une reprise ne cree pas de doublon.
#
# Usage : caisse-catalog.sh [--dry-run]
#   --dry-run : simulation, la caisse n'ecrit rien.
#
# ⚠️ NE TOUCHE JAMAIS a l'application caisse : gestlog est client, la caisse est serveur.
# ⚠️ Le stock n'est PAS concerne par cet import (seul le webhook livraisons fait entrer
#    des pieces) et les prix ne sont que CONSEILLES (updatePrices reste a false).
set -uo pipefail

cd /var/www/gestlog || exit 1

DRY=false
[ "${1:-}" = "--dry-run" ] && DRY=true

# Secret/cle lus en NODE, jamais avec cut/tr : une cle tronquee donnerait un 401 opaque.
KEY=$(node -e 'const fs=require("fs");const m=fs.readFileSync(".env","utf8").match(/^SYNC_API_KEY=(.*)$/m);let s=m?m[1].trim():"";const q=s.charAt(0);if((q==="\""||q==="'"'"'")&&s.charAt(s.length-1)===q)s=s.slice(1,-1);process.stdout.write(s)')
if [ -z "$KEY" ]; then
  echo "$(date '+%F %T %Z') ✗ SYNC_API_KEY introuvable dans .env"
  exit 1
fi

# Un seul envoi a la fois : deux passes simultanees se marcheraient dessus.
LOCK=/tmp/gestlog-caisse-catalog.lock
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "$(date '+%F %T %Z') ⏭ un envoi catalogue est deja en cours"
  exit 0
fi

OFFSET=0
PASSE=0
TOTAL_ENVOYES=0
echo "$(date '+%F %T %Z') ▶ catalogue → caisse (dryRun=$DRY)"

while : ; do
  PASSE=$((PASSE + 1))
  if [ "$PASSE" -gt 200 ]; then
    echo "$(date '+%F %T %Z') ✗ arret de securite : 200 passes sans fin"
    exit 1
  fi

  REP=$(curl -s --max-time 120 -X POST \
    -H "x-api-key: $KEY" -H "Content-Type: application/json" \
    -d "{\"dryRun\":$DRY,\"offset\":$OFFSET}" \
    http://localhost:3000/api/sync/caisse-catalog)

  if [ -z "$REP" ]; then
    echo "$(date '+%F %T %Z') ✗ passe $PASSE : aucune reponse de gestlog"
    exit 1
  fi

  # jq n'est pas garanti sur la machine : on lit la reponse en node.
  LECTURE=$(RAW="$REP" node -e '
    let d; try { d = JSON.parse(process.env.RAW); } catch { console.log("ERR|parse|0|0"); process.exit(0); }
    const s = d.data || {};
    const err = (s.erreurs && s.erreurs.length) ? s.erreurs.join(" ; ") : (d.error || "");
    console.log([err ? "ERR" : "OK", err || "-", s.articlesEnvoyes || 0,
                 s.nextOffset == null ? "" : s.nextOffset,
                 s.produitsCrees || 0, s.variantesCreees || 0, s.sansPrix || 0,
                 (s.rejets || []).length, (s.ecartsPrix || []).length].join("|"));
  ')
  IFS="|" read -r ETAT MSG ENVOYES NEXT CREES VARIANTES SANSPRIX REJETS ECARTS <<< "$LECTURE"

  TOTAL_ENVOYES=$((TOTAL_ENVOYES + ENVOYES))
  echo "$(date '+%F %T %Z')    passe $PASSE : $ENVOYES articles · produits crees $CREES · variantes creees $VARIANTES · sans prix $SANSPRIX · rejets $REJETS · ecarts prix $ECARTS"

  if [ "$ETAT" = "ERR" ]; then
    echo "$(date '+%F %T %Z') ✗ $MSG"
    echo "$(date '+%F %T %Z')    reprise possible a l'offset ${NEXT:-$OFFSET}"
    exit 1
  fi

  if [ -z "$NEXT" ]; then
    echo "$(date '+%F %T %Z') ✅ catalogue envoye : $TOTAL_ENVOYES articles en $PASSE passe(s)"
    break
  fi
  OFFSET="$NEXT"
done

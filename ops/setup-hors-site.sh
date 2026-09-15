#!/bin/bash
# ─── Mise en place de la copie hors-site (à lancer UNE fois, sur le VPS) ─────
#
# ⚠️ À LANCER DEPUIS VOTRE PROPRE TERMINAL. Les identifiants que vous tapez ici
# ne doivent transiter par aucune conversation : ils ne sortent pas du serveur.
#
# Avant de lancer, préparer chez Backblaze B2 (10 Go gratuits, largement au-delà
# de nos besoins) :
#   1. un compte sur backblaze.com → B2 Cloud Storage ;
#   2. un bucket PRIVÉ, par exemple « gestlog-sauvegardes » ;
#   3. une Application Key limitée à ce bucket → keyID + applicationKey.
#
# Le script configure deux remotes rclone :
#   b2-brut    l'accès au bucket
#   hors-site  une couche `crypt` par-dessus — noms ET contenus chiffrés avant
#              de quitter le serveur. Le fournisseur ne voit jamais rien.
set -euo pipefail

command -v rclone >/dev/null || { echo "rclone absent : sudo apt-get install -y rclone"; exit 1; }

echo "═══ Copie hors-site chiffrée — configuration ═══"
echo
read -rp "Bucket B2 (ex. gestlog-sauvegardes) : " BUCKET
read -rp "keyID                              : " KEYID
read -rsp "applicationKey (masquée)           : " APPKEY; echo
[ -n "$BUCKET" ] && [ -n "$KEYID" ] && [ -n "$APPKEY" ] || { echo "Champs obligatoires."; exit 1; }

# Mot de passe de chiffrement : engendré ici, jamais saisi ni deviné.
CRYPT=$(rclone version >/dev/null && head -c 32 /dev/urandom | base64 | tr -d '=+/' | cut -c1-40)

echo
echo "→ Configuration du bucket…"
rclone config delete b2-brut   2>/dev/null || true
rclone config delete hors-site 2>/dev/null || true
# hard_delete=false : une suppression devient une version masquée côté B2.
# Une mauvaise synchro reste donc rattrapable pendant la durée du cycle de vie
# que vous aurez réglé sur le bucket.
rclone config create b2-brut b2 account="$KEYID" key="$APPKEY" hard_delete=false >/dev/null

echo "→ Configuration du chiffrement…"
rclone config create hors-site crypt \
  remote="b2-brut:$BUCKET" \
  filename_encryption=standard \
  directory_name_encryption=true \
  password="$(rclone obscure "$CRYPT")" >/dev/null

chmod 700 "$HOME/.config/rclone" 2>/dev/null || true
chmod 600 "$HOME/.config/rclone/rclone.conf"

echo "→ Essai d'écriture et de relecture…"
TMP=$(mktemp); echo "essai gestlog $(date)" > "$TMP"
rclone copyto "$TMP" hors-site:_essai.txt
LU=$(rclone cat hors-site:_essai.txt)
rclone delete hors-site:_essai.txt
rm -f "$TMP"
[ -n "$LU" ] || { echo "❌ L'aller-retour a échoué."; exit 1; }
echo "   ✓ écrit, relu, effacé"

cat <<FIN

╔══════════════════════════════════════════════════════════════════════════╗
║  MOT DE PASSE DE CHIFFREMENT — À METTRE DANS VOTRE GESTIONNAIRE          ║
║                                                                          ║
║      $CRYPT
║                                                                          ║
║  Sans lui, la copie hors-site est DÉFINITIVEMENT illisible.              ║
║  Il est aussi dans ~/.config/rclone/rclone.conf sur le serveur — mais    ║
║  c'est précisément le serveur qu'on suppose perdu le jour où il sert.    ║
╚══════════════════════════════════════════════════════════════════════════╝

Il reste deux choses à faire, dans l'interface Backblaze :
  • sur le bucket, régler le cycle de vie sur « conserver les versions
    précédentes 7 jours » — filet contre une synchronisation malheureuse ;
  • vérifier que le bucket est bien PRIVÉ.

Puis, pour lancer la première copie :
  /var/www/gestlog/backup-full.sh

FIN

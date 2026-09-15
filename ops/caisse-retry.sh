#!/bin/bash
# Reessaie l'envoi caisse des livraisons en echec (caisseSyncStatus=FAILED).
cd /var/www/gestlog || exit 1
KEY=$(node -e 'const fs=require("fs");const m=fs.readFileSync(".env","utf8").match(/^SYNC_API_KEY=(.*)$/m);let s=m?m[1].trim():"";const q=s.charAt(0);if((q==="\""||q==="'"'"'")&&s.charAt(s.length-1)===q)s=s.slice(1,-1);process.stdout.write(s)')
curl -s -X POST -H "x-api-key: $KEY" http://localhost:3000/api/sync/caisse-retry
echo ""

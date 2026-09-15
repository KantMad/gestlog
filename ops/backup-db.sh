#!/bin/bash
DBURL=$(grep -E '^DATABASE_URL=' /var/www/gestlog/.env | sed 's/^DATABASE_URL=//' | tr -d "\"'")
TS=$(date +%Y%m%d-%H%M)
pg_dump "$DBURL" -Fc -f /var/backups/gestlog/gestlog-$TS.dump && chmod 600 /var/backups/gestlog/gestlog-$TS.dump && \
ls -t /var/backups/gestlog/gestlog-*.dump | tail -n +15 | xargs -r rm -f

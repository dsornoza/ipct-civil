#!/usr/bin/env bash
# Prueba las migraciones y las reglas en un PostgreSQL local temporal.
# Requisitos: PostgreSQL (initdb, pg_ctl, psql) en el PATH. No toca Supabase.
set -euo pipefail
# PostgreSQL en macOS exige una configuración regional válida para arrancar.
export LC_ALL="${LC_ALL:-en_US.UTF-8}"
AQUI="$(cd "$(dirname "$0")" && pwd)"
DIR="$(mktemp -d)"; PORT="${PUERTO:-54329}"
trap 'pg_ctl -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
initdb -D "$DIR/data" -U postgres --auth=trust --locale=C --encoding=UTF8 >/dev/null
pg_ctl -D "$DIR/data" -o "-p $PORT -k $DIR" -l "$DIR/log" -w start >/dev/null
export PGHOST="$DIR" PGPORT="$PORT" PGUSER=postgres
createdb ipct
run() { psql -v ON_ERROR_STOP=1 -q -d ipct -f "$1"; }
run "$AQUI/00_simulacion_supabase.sql"
for m in "$AQUI"/../migrations/*.sql; do echo "Migración: $(basename "$m")"; run "$m"; done
echo "Segunda ejecución (idempotencia)"
for m in "$AQUI"/../migrations/*.sql; do run "$m"; done
run "$AQUI/10_prueba_ipct.sql"
run "$AQUI/20_prueba_etapa5b.sql"

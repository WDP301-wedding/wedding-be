#!/bin/sh
set -eu

# Render's generated internal URLs contain no query string. Reject other inputs
# rather than accidentally append an ineffective TLS policy to a custom URL.
case "${DATABASE_URL:?}" in
  *\?*) echo 'Render DATABASE_URL must be the generated internal URL without a query.' >&2; exit 1 ;;
esac
case "${MIGRATION_DATABASE_URL:?}" in
  *\?*) echo 'Render MIGRATION_DATABASE_URL must be the generated internal URL without a query.' >&2; exit 1 ;;
esac
export DATABASE_URL="${DATABASE_URL}?sslmode=require&uselibpqcompat=true"
export MIGRATION_DATABASE_URL="${MIGRATION_DATABASE_URL}?sslmode=require&uselibpqcompat=true"
exec node --enable-source-maps --import ./dist/instrumentation.js dist/server.js

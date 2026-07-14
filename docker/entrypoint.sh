#!/bin/bash
set -uo pipefail

if [ "$(id -u)" = "0" ]; then
  chown -R node:node /app/data
  exec setpriv --reuid node --regid node --init-groups "$0" "$@"
fi

cd /app/server
if ! node --import tsx ./src/db/migrate.ts; then
  echo "[entrypoint] database migration failed" >&2
  exit 1
fi

app_server="/app/web/app/server.js"
if [ ! -f "$app_server" ]; then
  app_server="/app/web/server.js"
fi

term() {
  kill -TERM "${app_pid:-}" "${worker_pid:-}" 2>/dev/null || true
}
trap term TERM INT

node "$app_server" &
app_pid=$!

node --import tsx ./src/worker.ts &
worker_pid=$!

wait -n
code=$?
term
wait 2>/dev/null || true
exit "$code"

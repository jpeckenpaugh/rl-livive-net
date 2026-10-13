#!/bin/sh
set -eu
cd "$(dirname "$0")"
PORT="${PORT:-8000}"
HOST="${HOST:-127.0.0.1}"
./build_site.sh
echo "Serving Lunar Lander at http://${HOST}:${PORT}/"
exec python3 -m http.server "$PORT" --bind "$HOST" --directory _site

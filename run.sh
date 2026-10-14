#!/bin/sh
set -eu
cd "$(dirname "$0")"
PORT="${PORT:-8787}"
HOST="${HOST:-127.0.0.1}"
if [ -z "${PYTHON:-}" ]; then
  PYTHON="python3"
  if [ -z "${VIRTUAL_ENV:-}" ] && [ -x .venv/bin/python ]; then
    PYTHON=".venv/bin/python"
  fi
fi
export PYTHON
./build_site.sh
echo "Serving Lunar Lander at http://${HOST}:${PORT}/"
exec python3 -m http.server "$PORT" --bind "$HOST" --directory _site

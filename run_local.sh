#!/bin/sh
set -eu
cd "$(dirname "$0")"
PYTHON="${PYTHON:-python3}"
if [ -z "${VIRTUAL_ENV:-}" ]; then
  if [ ! -x .venv/bin/python ]; then
    "$PYTHON" -m venv .venv
  fi
  PYTHON=".venv/bin/python"
fi
if ! "$PYTHON" -c 'import numpy, pygame, pypybox2d' >/dev/null 2>&1; then
  echo "Installing the local runtime dependencies (NumPy, pygame, and PyPyBox2D)..."
  "$PYTHON" -m pip install -r requirements.txt
fi
exec "$PYTHON" -u lunar_lander_local.py

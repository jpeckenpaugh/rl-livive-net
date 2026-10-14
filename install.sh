#!/bin/sh
set -eu
cd "$(dirname "$0")"

PYTHON_WAS_SET="${PYTHON+x}"
PYTHON="${PYTHON:-python3}"
"$PYTHON" -c 'import sys; assert sys.version_info >= (3, 9), "Python 3.9 or newer is required"'

if [ -z "${VIRTUAL_ENV:-}" ] && [ -z "$PYTHON_WAS_SET" ]; then
  if [ ! -x .venv/bin/python ]; then
    "$PYTHON" -m venv .venv
  fi
  PYTHON=".venv/bin/python"
fi

echo "Installing browser build tools..."
"$PYTHON" -m pip install setuptools wheel

echo "Checking browser build prerequisites..."
command -v curl >/dev/null 2>&1 || {
  echo "curl is required to fetch the published ONNX policy." >&2
  exit 1
}

echo "Installation complete. Start the local browser demo with ./run.sh"

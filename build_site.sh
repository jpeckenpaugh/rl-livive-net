#!/bin/sh
set -eu
cd "$(dirname "$0")"

SITE_DIR="${SITE_DIR:-_site}"
rm -rf "$SITE_DIR"
rm -rf build ./*.egg-info
mkdir -p "$SITE_DIR/packages" "$SITE_DIR/third_party/wheels"

python3 setup.py bdist_wheel --dist-dir "$SITE_DIR/packages"
cp index.html about.html app.js style.css CNAME "$SITE_DIR/"
cp third_party/wheels/pypybox2d-2.1.post331-py3-none-any.whl "$SITE_DIR/third_party/wheels/"
cp third_party/README.md "$SITE_DIR/third_party/"

#!/bin/sh
set -eu
cd "$(dirname "$0")"

SITE_DIR="${SITE_DIR:-_site}"
rm -rf "$SITE_DIR"
rm -rf build ./*.egg-info
mkdir -p "$SITE_DIR/packages" "$SITE_DIR/third_party/wheels" "$SITE_DIR/models"

python3 setup.py bdist_wheel --dist-dir "$SITE_DIR/packages"
cp index.html about.html app.js style.css CNAME "$SITE_DIR/"
cp third_party/wheels/pypybox2d-2.1.post331-py3-none-any.whl "$SITE_DIR/third_party/wheels/"
cp third_party/README.md "$SITE_DIR/third_party/"

POLICY_NAME="ppo-LunarLander-v2.onnx"
LOCAL_POLICY="models/ppo-LunarLander-v2/$POLICY_NAME"
PUBLISHED_POLICY="$SITE_DIR/models/$POLICY_NAME"
if [ -f "$LOCAL_POLICY" ] && ! head -c 64 "$LOCAL_POLICY" | grep -q 'version https://git-lfs.github.com/spec/v1'; then
  cp "$LOCAL_POLICY" "$PUBLISHED_POLICY"
else
  POLICY_REVISION="$(tr -d '[:space:]' < models/onnx-revision.txt)"
  if [ "${#POLICY_REVISION}" -ne 40 ] || ! printf '%s' "$POLICY_REVISION" | grep -Eq '^[0-9a-fA-F]{40}$'; then
    cat >&2 <<'EOF'
The ONNX policy is not present locally, and models/onnx-revision.txt does not
contain a published 40-character Hugging Face commit SHA. Export the model,
upload ppo-LunarLander-v2.onnx to seekdepth/ppo-LunarLander-v2, then update
models/onnx-revision.txt to that commit before building Pages.
EOF
    exit 1
  fi
  POLICY_URL="https://huggingface.co/seekdepth/ppo-LunarLander-v2/resolve/$POLICY_REVISION/$POLICY_NAME?download=true"
  if ! curl --fail --location --silent --show-error --retry 2 "$POLICY_URL" --output "$PUBLISHED_POLICY"; then
    rm -f "$PUBLISHED_POLICY"
    echo "Could not fetch $POLICY_NAME from Hugging Face revision $POLICY_REVISION" >&2
    exit 1
  fi
  if head -c 64 "$PUBLISHED_POLICY" | grep -q 'version https://git-lfs.github.com/spec/v1'; then
    rm -f "$PUBLISHED_POLICY"
    echo "Hugging Face returned an LFS pointer instead of the ONNX payload at revision $POLICY_REVISION" >&2
    exit 1
  fi
fi

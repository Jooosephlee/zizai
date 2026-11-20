#!/bin/bash
# Builds the Chrome Web Store upload: store/zizai-<version>.zip with
# manifest.json at the root. The store copy drops the dev "version_name".
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$root/extension/manifest.json")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp -R "$root/extension/." "$work/"
find "$work" -name ".DS_Store" -delete
python3 - "$work/manifest.json" <<'PY'
import json, sys
path = sys.argv[1]
data = json.load(open(path, encoding="utf-8"))
data.pop("version_name", None)
open(path, "w", encoding="utf-8").write(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
PY
out="$root/store/zizai-$version.zip"
rm -f "$out"
(cd "$work" && zip -qr -X "$out" .)
echo "$out"
shasum -a 256 "$out" | cut -d' ' -f1

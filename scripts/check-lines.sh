#!/bin/sh
# Enforce the 199-line limit on handwritten files, excluding vendored assets.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
list=$(mktemp "${TMPDIR:-/tmp}/yolo-lines.XXXXXX")
trap 'rm -f "$list"' EXIT INT TERM
git -C "$root" ls-files '*.ts' '*.md' '*.json' '*.sh' > "$list"
fail=0
while IFS= read -r file; do
  case "$file" in
    client/vendor/*) continue ;;
  esac
  lines=$(wc -l < "$root/$file")
  if [ "$lines" -ge 200 ]; then
    echo "$file has $lines lines (limit 199)" >&2
    fail=1
  fi
done < "$list"
exit "$fail"

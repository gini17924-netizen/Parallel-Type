#!/bin/sh
# lint-staged wrapper (frontend/package.json): filters the vendored keybr
# tree out, then runs the type-aware oxlint on the rest.
# Invoked as: lint-staged-ts.sh --type-aware --type-check <files...>
shift 2
files=""
for f in "$@"; do
  norm=$(printf '%s' "$f" | tr '\' '/')
  case "$norm" in
    *src/keybr/*) continue ;;
  esac
  files="$files $f"
done
[ -z "$files" ] && exit 0
exec npx oxlint --type-aware --type-check $files

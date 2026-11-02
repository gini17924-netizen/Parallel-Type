#!/bin/sh
# lint-staged wrapper (frontend/package.json): filters the vendored keybr
# tree out (kept byte-identical to upstream), then runs oxfmt on the rest.
# Invoked as: fmt-staged.sh --no-error-on-unmatched-pattern -c ../.oxfmtrc.json <files...>
shift 3
files=""
for f in "$@"; do
  norm=$(printf '%s' "$f" | tr '\' '/')
  case "$norm" in
    *src/keybr/*) continue ;;
  esac
  files="$files $f"
done
[ -z "$files" ] && exit 0
exec npx oxfmt $files

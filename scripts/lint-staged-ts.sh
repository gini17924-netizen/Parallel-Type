#!/bin/sh
# lint-staged wrapper (frontend/package.json): filters the vendored keybr
# tree AND the keybr glue files out, then runs plain oxlint on the rest.
# Invoked as: lint-staged-ts.sh <files...>   (no type flags — type-aware
# linting is gated by `npm run build` via ts-check; oxlint cannot resolve
# the @keybr/* path aliases and its project view chokes on the vendored
# tree, so those files are gated by tsc instead)
shift 0
files=""
for f in "$@"; do
  norm=$(printf '%s' "$f" | tr '\\' '/')
  case "$norm" in
    *src/keybr/*) continue ;;
    *src/ts/keybr/*) continue ;;
    *components/pages/keybr/*) continue ;;
    *__tests__/keybr/*) continue ;;
  esac
  files="$files $f"
done
[ -z "$files" ] && exit 0
exec npx oxlint $files

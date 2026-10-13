#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
for name in render transport; do
  if [[ ! -x "$name" || "$name.swift" -nt "$name" ]]; then
    swiftc "$name.swift" -o "$name"
  fi
done
case "${1:-status}" in
 status)
  node encode.cjs query
  ./transport query.bin
  ;;
 preview)
  ./render "${2:-hello}" "${3:-həˈləʊ}"
  ;;
 print)
  ./render "${2:-hello}" "${3:-həˈləʊ}"
  node encode.cjs
  ./transport print.bin
  ;;
 *) echo 'Usage: ./run.sh status | preview [word] [IPA] | print [word] [IPA]' >&2; exit 2 ;;
esac

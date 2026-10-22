#!/bin/sh
set -eu
umask 077
base=/data/plugins/neighbor-scan
work=''
collector=''
completed=0
cleanup() {
 if [ -n "$collector" ]; then
  kill -TERM "$collector" 2>/dev/null || true
  sleep 2
  kill -KILL "$collector" 2>/dev/null || true
  wait "$collector" 2>/dev/null || true
 fi
 [ -z "$work" ] || rm -rf "$work"
 [ "$completed" = 1 ] || lua "$base/main.lua" error
 rmdir /var/run/u60-neighbor-scan.lock 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
pidof diag_mdlog >/dev/null 2>&1 && exit 1
work=$(mktemp -d /tmp/u60-neighbors.XXXXXX)
mkdir "$work/ring"
/usr/bin/diag_mdlog -f "$base/qtrace.cfg" -o "$work/ring" -s 4 -n 4 -c -d > "$work/diag.log" 2>&1 </dev/null &
collector=$!
sleep 30
kill -TERM "$collector" 2>/dev/null || true
sleep 2
kill -KILL "$collector" 2>/dev/null || true
wait "$collector" 2>/dev/null || true
collector=''
set -- "$work/ring/"*.qmdl
[ -f "$1" ] || exit 1
"$base/datad" --neighbor-parse "$@" > "$work/result.json"
lua "$base/main.lua" finish "$work/result.json"
completed=1

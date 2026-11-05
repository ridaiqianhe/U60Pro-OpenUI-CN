#!/bin/sh
# Bound only the command this wrapper starts; validate PID lifetime before signals.
limit=$1
shift
case "$limit" in ''|*[!0-9]*) exit 64 ;; esac
[ "$limit" -ge 1 ] && [ "$limit" -le 120 ] || exit 64
"$@" &
child=$!
started=$(awk '{print $22}' "/proc/$child/stat" 2>/dev/null)
(
 sleep "$limit"
 [ -n "$started" ] || exit 0
 [ "$(awk '{print $22}' "/proc/$child/stat" 2>/dev/null)" = "$started" ] || exit 0
 kill -TERM "$child" 2>/dev/null || exit 0
 sleep 1
 [ "$(awk '{print $22}' "/proc/$child/stat" 2>/dev/null)" = "$started" ] || exit 0
 kill -KILL "$child" 2>/dev/null || true
) >/dev/null 2>&1 < /dev/null &
watcher=$!
wait "$child"
result=$?
kill -TERM "$watcher" 2>/dev/null || true
wait "$watcher" 2>/dev/null || true
exit "$result"

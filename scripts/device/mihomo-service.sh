#!/bin/sh
set -eu
base=/data/plugins/mihomo
pidfile=/var/run/u60pro-mihomo.pid
running() { [ -s "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; }
case "${1:-status}" in
boot) [ -f "$base/enabled" ] || exit 0; exec sh "$0" start ;;
check) exec "$base/mihomo" -t -d "$base" -f "$base/config.yaml" ;;
start)
 if running; then sh "$base/forwarding.sh" sync; exit 0; fi
 sh "$0" check
 trap '' HUP
 nohup "$base/mihomo" -d "$base" -f "$base/config.yaml" </dev/null >/tmp/u60pro-mihomo.log 2>&1 &
 echo $! > "$pidfile"
 sleep 2
 running
 sh "$base/forwarding.sh" sync ;;
stop) sh "$base/forwarding.sh" stop; if running; then kill "$(cat "$pidfile")"; fi; rm -f "$pidfile" ;;
restart) sh "$0" stop; exec sh "$0" start ;;
enable) sh "$0" check; touch "$base/enabled" ;;
disable) rm -f "$base/enabled"; exec sh "$0" stop ;;
status) if running; then echo running; else echo stopped; fi ;;
*) exit 2 ;;
esac

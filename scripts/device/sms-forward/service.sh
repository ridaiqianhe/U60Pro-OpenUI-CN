#!/bin/sh
set -eu
umask 077
base=/data/plugins/sms-forward
pidfile=/var/run/u60pro-sms-forward.pid
case "${1:-start}" in
 start|boot)
 if [ -s "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then exit 0; fi
 rmdir "$base/.lock" 2>/dev/null || true
 trap '' HUP
 nohup lua "$base/main.lua" worker >/dev/null 2>&1 </dev/null &
 echo $! > "$pidfile" ;;
 stop) [ ! -s "$pidfile" ] || kill "$(cat "$pidfile")" 2>/dev/null || true; rm -f "$pidfile" ;;
 *) exit 1 ;;
esac

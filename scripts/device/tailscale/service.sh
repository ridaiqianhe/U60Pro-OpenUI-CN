#!/bin/sh
# Device-owned daemon only. Boot entry belongs in /etc/rc.local.
set -eu
umask 077
base=/data/plugins/tailscale
socket=/var/run/u60-tailscaled.sock
pidfile=/var/run/u60-tailscaled.pid
cli() { sh "$base/run-bounded.sh" 3 "$base/tailscale" --socket="$socket" "$@"; }
owned() {
 [ -s "$pidfile" ] || return 1
 pid=$(cat "$pidfile")
 case "$pid" in ''|*[!0-9]*) return 1 ;; esac
 [ "$(readlink "/proc/$pid/exe" 2>/dev/null || true)" = "$base/tailscaled" ]
}
access() {
 action=$1
 for fw in iptables ip6tables; do
  command -v "$fw" >/dev/null 2>&1 || continue
  if [ "$action" = add ]; then
   "$fw" -C INPUT -i tailscale0 -p tcp -m multiport --dports 80,2222,8080,9090,9091 -j ACCEPT 2>/dev/null || "$fw" -I INPUT -i tailscale0 -p tcp -m multiport --dports 80,2222,8080,9090,9091 -j ACCEPT
  else
   while "$fw" -D INPUT -i tailscale0 -p tcp -m multiport --dports 80,2222,8080,9090,9091 -j ACCEPT 2>/dev/null; do :; done
  fi
 done
 # Agent/Mihomo bind the existing LAN IPv4; restrict DNAT to this node's TS IPv4.
 address=$(cli ip -4 2>/dev/null | head -1 || true)
 if [ -z "$address" ]; then address=$(cat "$base/access.address" 2>/dev/null || true); fi
 case "$address" in 100.*) ;; *) address= ;; esac
 old=$(cat "$base/access.address" 2>/dev/null || true)
 if [ -n "$old" ] && { [ "$old" != "$address" ] || [ "$action" != add ]; }; then
  while iptables -t nat -D PREROUTING -i tailscale0 -d "$old" -p tcp -m multiport --dports 9090,9091 -j DNAT --to-destination 192.168.0.1 2>/dev/null; do :; done
 fi
 if [ "$action" = add ] && [ -n "$address" ]; then
  iptables -t nat -C PREROUTING -i tailscale0 -d "$address" -p tcp -m multiport --dports 9090,9091 -j DNAT --to-destination 192.168.0.1 2>/dev/null || iptables -t nat -I PREROUTING -i tailscale0 -d "$address" -p tcp -m multiport --dports 9090,9091 -j DNAT --to-destination 192.168.0.1
  printf '%s' "$address" > "$base/access.address"
 elif [ "$action" != add ]; then rm -f "$base/access.address"; fi
}
start() {
 [ -x "$base/tailscaled" ] && [ -x "$base/tailscale" ] || { echo 'Tailscale binaries are not installed' >&2; return 1; }
 [ -c /dev/net/tun ] || { echo 'TUN device unavailable' >&2; return 1; }
 if ! owned; then
  # A fixed socket must not belong to an unrelated instance.
  [ ! -S "$socket" ] || { echo 'Tailscale socket is already in use' >&2; return 1; }
  [ ! -f "$base/daemon.log" ] || mv "$base/daemon.log" "$base/daemon.log.1"
  TS_NO_LOGS_NO_SUPPORT=true GOMAXPROCS=2 nohup "$base/tailscaled" --state="$base/tailscaled.state" --socket="$socket" --tun=tailscale0 --port=41641 > "$base/daemon.log" 2>&1 < /dev/null &
  echo $! > "$pidfile"
  ready=false
  for n in 1 2 3 4 5; do
   if [ -S "$socket" ]; then ready=true; break; fi
   sleep 1
  done
  [ "$ready" = true ] || { echo 'Tailscale daemon did not become ready' >&2; return 1; }
 fi
 access add
}
case "${1:-}" in
 boot)
  [ -f "$base/autostart" ] || exit 0
  # Never block the stock boot path on login or network availability.
  nohup sh "$base/service.sh" connect > "$base/connect.log" 2>&1 < /dev/null & ;;
 start) start ;;
 connect)
  mkdir /var/run/u60-tailscale-connect.lock 2>/dev/null || exit 0
  trap 'rmdir /var/run/u60-tailscale-connect.lock 2>/dev/null || true' EXIT
  start
  # A small validated Lua helper builds flags; no credentials on a command line.
  lua "$base/main.lua" connect
  if owned; then access add; fi ;;
 sync) owned; access add ;;
 stop)
  if owned; then cli down >/dev/null 2>&1 || true; fi
  access remove
  if owned; then kill -TERM "$pid"; fi
  rm -f "$pidfile"
  # Let the owned daemon unlink its socket, and reject a stale socket on next start.
  for n in 1 2 3 4 5; do [ ! -S "$socket" ] && break; sleep 1; done ;;
 logout)
  owned
  cli logout >/dev/null
  access remove ;;
 *) echo 'Usage: service.sh boot|start|connect|sync|stop|logout' >&2; exit 64 ;;
esac

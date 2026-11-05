#!/bin/sh
# Refresh DDNS only after a stale handshake; never restart the tunnel.
set -eu
base=/data/plugins/wireguard
iface=wg-u60
wg=$base/wg
check() {
 ip link show "$iface" >/dev/null 2>&1 || return 0
 now=$(date +%s)
 source=$(ip -4 route show table main default | awk '{for(i=1;i<NF;i++) if($i=="src") {print $(i+1);exit}}')
 [ -n "$source" ] || return 0
 # Read only peer identity and endpoint, never emit private configuration.
 awk '
 function emit() {if(peer!="" && endpoint!="") print peer,endpoint}
 /^[ \t]*\[/ {emit();peer="";endpoint="";active=($0 ~ /\[Peer\]/);next}
 active && /^[ \t]*PublicKey[ \t]*=/ {sub(/^[^=]*=[ \t]*/,"");gsub(/[\r \t]/,"");peer=$0}
 active && /^[ \t]*Endpoint[ \t]*=/ {sub(/^[^=]*=[ \t]*/,"");sub(/[ \t]*#.*/,"");gsub(/[\r \t]/,"");endpoint=$0}
 END {emit()}' "$base/profile.conf" | while read -r peer endpoint; do
  host=${endpoint%:*}; port=${endpoint##*:}
  case "$host" in ''|\[*\]|*[!a-zA-Z0-9.-]*) continue ;; esac
  case "$host" in *[!0-9.]*) ;; *) continue ;; esac
  case "$port" in ''|*[!0-9]*) continue ;; esac
  [ "$port" -gt 0 ] && [ "$port" -le 65535 ] || continue
  last=$("$wg" show "$iface" latest-handshakes | awk -v p="$peer" '$1==p {print $2}')
  case "$last" in ''|*[!0-9]*) continue ;; esac
  [ "$last" -eq 0 ] || [ "$((now-last))" -ge 180 ] || continue
  resolved=''
  for resolver in 223.5.5.5 119.29.29.29; do
   resolved=$(dig -b "$source" @"$resolver" "$host" A +short +time=2 +tries=1 2>/dev/null | awk -F. 'NF==4 && $1~/^[0-9]+$/ && $2~/^[0-9]+$/ && $3~/^[0-9]+$/ && $4~/^[0-9]+$/ && $1>0 && $1<224 && $2<=255 && $3<=255 && $4<=255 && $1!=127 && !($1==198 && ($2==18 || $2==19)) {print;exit}')
   [ -z "$resolved" ] || break
  done
  [ -n "$resolved" ] || continue
  current=$("$wg" show "$iface" endpoints | awk -v p="$peer" '$1==p {print $2}')
  [ -n "$current" ] && [ "$current" != "$resolved:$port" ] || continue
  # Recheck immediately before writing so an intervening manual stop stays stopped.
  ip link show "$iface" >/dev/null 2>&1 || continue
  "$wg" set "$iface" peer "$peer" endpoint "$resolved:$port"
 done
}
case "${1:-}" in
 check) check ;;
 run)
  lock=/var/run/u60-wg-watch.lock
  if ! mkdir "$lock" 2>/dev/null; then
   old=$(cat "$lock/pid" 2>/dev/null || true)
   case "$old" in ''|*[!0-9]*) ;; *)
    if [ -r "/proc/$old/cmdline" ] && tr '\000' ' ' < "/proc/$old/cmdline" | grep -Fq "$base/watch.sh run"; then exit 0; fi ;;
   esac
   rm -f "$lock/pid"; rmdir "$lock" 2>/dev/null || exit 0
   mkdir "$lock" 2>/dev/null || exit 0
  fi
  echo $$ > "$lock/pid"
  trap 'rm -f "$lock/pid"; rmdir "$lock" 2>/dev/null || true' EXIT
  trap 'exit 0' TERM INT
  while ip link show "$iface" >/dev/null 2>&1; do
   sleep 60
   check >/dev/null 2>&1 || true
  done ;;
 *) exit 1 ;;
esac

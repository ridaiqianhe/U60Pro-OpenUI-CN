#!/bin/sh
set -eu
umask 077
base=/data/plugins/wireguard
iface=wg-u60
wg=$base/wg
access() {
 action=$1
 address=$(ip -4 addr show dev "$iface" 2>/dev/null | awk '$1=="inet" {split($2,a,"/");print a[1];exit}')
 if [ -z "$address" ]; then address=$(cat "$base/access.address" 2>/dev/null || true); fi
 if [ "$action" = -I ]; then
  [ -n "$address" ] || return 0
  iptables -C INPUT -i "$iface" -p tcp -m multiport --dports 2222,8080,9090,9091 -j ACCEPT 2>/dev/null || iptables -I INPUT -i "$iface" -p tcp -m multiport --dports 2222,8080,9090,9091 -j ACCEPT
  iptables -t nat -C PREROUTING -i "$iface" -d "$address" -p tcp -m multiport --dports 9090,9091 -j DNAT --to-destination 192.168.0.1 2>/dev/null || iptables -t nat -I PREROUTING -i "$iface" -d "$address" -p tcp -m multiport --dports 9090,9091 -j DNAT --to-destination 192.168.0.1
  printf '%s' "$address" > "$base/access.address"
 else
  while iptables -D INPUT -i "$iface" -p tcp -m multiport --dports 2222,8080,9090,9091 -j ACCEPT 2>/dev/null; do :; done
  if [ -n "$address" ]; then
   while iptables -t nat -D PREROUTING -i "$iface" -d "$address" -p tcp -m multiport --dports 9090,9091 -j DNAT --to-destination 192.168.0.1 2>/dev/null; do :; done
  fi
  rm -f "$base/access.address"
 fi
}
stop() {
 access -D 2>/dev/null || true
 ip link del "$iface" 2>/dev/null || true
 for family in -4 -6; do
  for priority in 8780 8790 8800; do ip "$family" rule del priority "$priority" 2>/dev/null || true; done
  ip "$family" route flush table 51830 2>/dev/null || true
 done
 for fw in iptables ip6tables; do
  "$fw" -D FORWARD -i br-lan -o "$iface" -j ACCEPT 2>/dev/null || true
  "$fw" -D FORWARD -i "$iface" -o br-lan -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true
  "$fw" -t nat -D POSTROUTING -o "$iface" -j MASQUERADE 2>/dev/null || true
 done
}
# Resolve endpoint hostnames through the WAN, never through Clash Fake-IP DNS.
resolve_endpoints() {
 config=$1
 : > "$config.resolved"
 while IFS= read -r line; do
  case "$line" in
   Endpoint\ =\ *)
    endpoint=${line#Endpoint = }; host=${endpoint%:*}; port=${endpoint##*:}
    case "$host" in
     \[*\]|*[!0-9.]*)
      case "$host" in \[*\]) printf '%s\n' "$line" >> "$config.resolved"; continue ;; esac
      case "$host" in *[!a-zA-Z0-9.-]*|'') echo 'Invalid WireGuard endpoint hostname' >&2; return 1 ;; esac
      resolved=''; attempt=0
      while [ "$attempt" -lt 15 ]; do
       source=$(ip -4 route show table main default 2>/dev/null | awk '{for(i=1;i<NF;i++) if($i=="src") {print $(i+1);exit}}')
       if [ -n "$source" ]; then
        for resolver in 223.5.5.5 119.29.29.29; do
         resolved=$(dig -b "$source" @"$resolver" "$host" A +short +time=2 +tries=1 2>/dev/null | awk -F. 'NF==4 && $1~/^[0-9]+$/ && $2~/^[0-9]+$/ && $3~/^[0-9]+$/ && $4~/^[0-9]+$/ && $1<=255 && $2<=255 && $3<=255 && $4<=255 && !($1==198 && ($2==18 || $2==19)) {print;exit}')
         [ -z "$resolved" ] || break
        done
       fi
       [ -z "$resolved" ] || break
       attempt=$((attempt + 1)); sleep 2
      done
      [ -n "$resolved" ] || { echo 'WireGuard endpoint DNS unavailable on WAN' >&2; return 1; }
      line="Endpoint = $resolved:$port"
      ;;
    esac
    ;;
  esac
  printf '%s\n' "$line" >> "$config.resolved"
 done < "$config"
 mv "$config.resolved" "$config"
}
start() {
 [ -f "$base/profile.conf" ] || { echo '请先导入配置'; return 1; }
 if [ "$(sh "$base/scope.sh" "$base/profile.conf")" = full ] && ip link show mihomo0 >/dev/null 2>&1; then echo '全局 WireGuard 隧道需先关闭 Clash 透明代理'; return 1; fi
 if ip link show "$iface" >/dev/null 2>&1; then return 0; fi
 work=$(mktemp -d "$base/.start.XXXXXX")
 trap 'code=$?; rm -rf "$work"; if [ "$code" != 0 ]; then stop; fi' EXIT
 awk -v wg="$work/wg.conf" -v addresses="$work/addresses" -v routes="$work/routes" -v mtu="$work/mtu" -f "$base/parse.awk" "$base/profile.conf"
 resolve_endpoints "$work/wg.conf"
 ip link add "$iface" type wireguard
 "$wg" setconf "$iface" "$work/wg.conf"
 "$wg" set "$iface" fwmark 51830
 while IFS= read -r address; do ip address add "$address" dev "$iface"; done < "$work/addresses"
 mtu=1420; [ ! -s "$work/mtu" ] || mtu=$(cat "$work/mtu")
 ip link set dev "$iface" mtu "$mtu" up
 while IFS= read -r route; do
  case "$route" in *:*) family=-6 ;; *) family=-4 ;; esac
  ip "$family" route replace "$route" dev "$iface" table 51830
 done < "$work/routes"
 for family in -4 -6; do
  ip "$family" rule add priority 8780 lookup main suppress_prefixlength 0
  ip "$family" rule add priority 8790 fwmark 51830 lookup main
  ip "$family" rule add priority 8800 lookup 51830
 done
 for fw in iptables ip6tables; do
  "$fw" -I FORWARD 1 -i br-lan -o "$iface" -j ACCEPT
  "$fw" -I FORWARD 1 -i "$iface" -o br-lan -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
 done
 access -I
 iptables -t nat -I POSTROUTING 1 -o "$iface" -j MASQUERADE
 if grep -q : "$work/routes"; then ip6tables -t nat -I POSTROUTING 1 -o "$iface" -j MASQUERADE; fi
}
case "${1:-}" in
 start) start ;;
 access) access -I ;;
 stop) stop ;;
 boot) if [ -f "$base/autostart" ]; then start; fi ;;
 *) exit 1 ;;
esac

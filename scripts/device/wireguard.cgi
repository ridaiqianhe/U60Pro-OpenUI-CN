#!/bin/sh
set -eu
umask 077
base=/data/plugins/wireguard
cleanup() {
 if [ "${check_created:-false}" = true ]; then ip link del wg-u60-check 2>/dev/null || true; check_created=false; fi
 if [ "${proxy_lock:-false}" = true ]; then rmdir /data/plugins/mihomo/.subscription-lock 2>/dev/null || true; proxy_lock=false; fi
 if [ "${lock_owned:-false}" = true ]; then rm -rf "$work"; rmdir "$base/.lock" 2>/dev/null || true; lock_owned=false; fi
}
reply() { cleanup; printf 'Status: %s\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n%s\n' "$1" "$2"; }
fail() { reply '400 Bad Request' '{"ok":false,"error":"配置无效：仅支持标准 WireGuard 配置；不支持脚本钩子、SaveConfig 和自定义 Table"}'; exit 0; }
if [ -z "${HTTP_AUTHORIZATION:-}" ] || ! curl -fsS --connect-timeout 2 --max-time 5 -H "Authorization: $HTTP_AUTHORIZATION" http://192.168.0.1:9090/api/device >/dev/null 2>&1; then reply '401 Unauthorized' '{"ok":false,"error":"Unauthorized"}';exit 0; fi
status() {
 configured=false; running=false; autostart=false; handshake=0; rx=0; tx=0
 [ ! -s "$base/profile.conf" ] || configured=true
 [ ! -f "$base/autostart" ] || autostart=true
 if ip link show wg-u60 >/dev/null 2>&1; then
  running=true
  handshake=$("$base/wg" show wg-u60 latest-handshakes | awk 'BEGIN{v=0} $2>v{v=$2} END{print v}')
  totals=$("$base/wg" show wg-u60 transfer | awk '{rx+=$2;tx+=$3} END{printf "%.0f %.0f",rx,tx}')
  rx=${totals% *};tx=${totals#* }
 fi
 reply '200 OK' "{\"ok\":true,\"data\":{\"configured\":$configured,\"running\":$running,\"autostart\":$autostart,\"handshake\":$handshake,\"rx\":$rx,\"tx\":$tx}}"
}
case "${REQUEST_METHOD:-GET}" in GET) status;exit 0 ;; POST) ;; *) fail ;; esac
length=${CONTENT_LENGTH:-0};case "$length" in ''|*[!0-9]*) fail ;; esac
[ "$length" -gt 0 ] && [ "$length" -le 65536 ] || fail
mkdir "$base/.lock" 2>/dev/null || { reply '409 Conflict' '{"ok":false,"error":"WireGuard 正忙，请稍后再试"}';exit 0; }
work=$(mktemp -d "$base/.request.XXXXXX")
check_created=false
proxy_lock=false
lock_owned=true
trap cleanup EXIT
dd bs=1 count="$length" > "$work/body.json" 2>/dev/null
action=$(jsonfilter -i "$work/body.json" -e '@.action' 2>/dev/null || true)
case "$action" in
 save)
  if ip link show wg-u60 >/dev/null 2>&1; then reply '409 Conflict' '{"ok":false,"error":"请先关闭 WireGuard 再替换配置"}';exit 0; fi
  jsonfilter -i "$work/body.json" -e '@.config' > "$work/profile.conf" 2>/dev/null || fail
  awk -v wg="$work/wg.conf" -v addresses="$work/addresses" -v routes="$work/routes" -v mtu="$work/mtu" -f "$base/parse.awk" "$work/profile.conf" || fail
  ip link add wg-u60-check type wireguard || fail
  check_created=true
  "$base/wg" setconf wg-u60-check "$work/wg.conf" >"$work/check.log" 2>&1 || fail
  while IFS= read -r address; do ip address add "$address" dev wg-u60-check || fail; done < "$work/addresses"
  ip link del wg-u60-check
  check_created=false
  if [ -s "$base/profile.conf" ]; then cp -p "$base/profile.conf" "$base/profile.previous.conf"; fi
  mv "$work/profile.conf" "$base/profile.conf" ;;
 autostart)
  enabled=$(jsonfilter -i "$work/body.json" -e '@.enabled' 2>/dev/null || true)
  case "$enabled" in true) [ -s "$base/profile.conf" ] || fail;touch "$base/autostart" ;; false) rm -f "$base/autostart" ;; *) fail ;; esac ;;
 start)
  mkdir /data/plugins/mihomo/.subscription-lock 2>/dev/null || { reply '409 Conflict' '{"ok":false,"error":"代理配置正在更新，请稍后再试"}';exit 0; }
  proxy_lock=true
  if [ -s "$base/profile.conf" ] && [ "$(sh "$base/scope.sh" "$base/profile.conf")" = full ] && ip link show mihomo0 >/dev/null 2>&1; then reply '409 Conflict' '{"ok":false,"error":"当前 WireGuard 配置包含全局路由，请改为内网 AllowedIPs，或先关闭 Clash 透明代理"}';exit 0; fi
  if ! sh "$base/service.sh" start > "$work/start.log" 2>&1; then reply '502 Bad Gateway' '{"ok":false,"error":"WireGuard 启动失败，已清理新增的接口与路由"}';exit 0; fi ;;
 stop) sh "$base/service.sh" stop ;;
 *) fail ;;
esac
status

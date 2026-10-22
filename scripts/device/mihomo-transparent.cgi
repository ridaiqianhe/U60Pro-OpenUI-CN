#!/bin/sh
set -eu
umask 077
base=/data/plugins/mihomo
reply() { printf 'Status: %s\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n%s\n' "$1" "$2"; }
fail() { reply '400 Bad Request' '{"ok":false,"error":"切换失败或请求无效，已保留原配置"}'; exit 0; }
if [ -z "${HTTP_AUTHORIZATION:-}" ] || ! curl -fsS --connect-timeout 2 --max-time 5 -H "Authorization: $HTTP_AUTHORIZATION" http://192.168.0.1:9090/api/device >/dev/null 2>&1; then
 reply '401 Unauthorized' '{"ok":false,"error":"Unauthorized"}'; exit 0
fi
[ "${REQUEST_METHOD:-GET}" = POST ] || fail
length=${CONTENT_LENGTH:-0}
case "$length" in ''|*[!0-9]*) fail ;; esac
[ "$length" -gt 0 ] && [ "$length" -le 128 ] || fail
body=$(dd bs=1 count="$length" 2>/dev/null)
enabled=$(jsonfilter -s "$body" -e '@.enabled' 2>/dev/null || true)
case "$enabled" in true|false) ;; *) fail ;; esac
if [ "$enabled" = true ] && ip link show wg-u60 >/dev/null 2>&1 && [ "$(sh /data/plugins/wireguard/scope.sh /data/plugins/wireguard/profile.conf)" = full ]; then reply '409 Conflict' '{"ok":false,"error":"请先关闭全局 WireGuard 隧道，再开启 Clash 透明代理"}'; exit 0; fi
mkdir "$base/.subscription-lock" 2>/dev/null || { reply '409 Conflict' '{"ok":false,"error":"配置正在更新，请稍后再试"}'; exit 0; }
work=$(mktemp -d "$base/.toggle.XXXXXX")
trap 'rm -rf "$work"; rmdir "$base/.subscription-lock" 2>/dev/null || true' EXIT
secret=$(sed -n 's/^secret: "\([A-Za-z0-9_-]*\)"$/\1/p' "$base/config.yaml")
[ -n "$secret" ] || fail
cp -p "$base/config.yaml" "$work/previous.yaml"
cp -p "$base/config.yaml" "$work/next.yaml"
"$base/yq" -i ".tun.enable = $enabled" "$work/next.yaml"
"$base/mihomo" -t -d "$base" -f "$work/next.yaml" >"$work/check.log" 2>&1 || fail
reload() { curl -fsS --connect-timeout 2 --max-time 15 -X PUT -H "Authorization: Bearer $secret" -H 'Content-Type: application/json' --data '{"path":"/data/plugins/mihomo/config.yaml"}' http://192.168.0.1:9091/configs >/dev/null 2>&1; }
mv "$work/next.yaml" "$base/config.yaml"
valid=false
if reload; then
 sleep 1
 actual=false; ip link show mihomo0 >/dev/null 2>&1 && actual=true
 [ "$actual" != "$enabled" ] || valid=true
fi
if [ "$valid" != true ]; then cp "$work/previous.yaml" "$base/config.yaml"; reload || true; fail; fi
if [ "$enabled" = true ]; then rm -f "$base/transparent.disabled"; else touch "$base/transparent.disabled"; fi
sh "$base/forwarding.sh" sync
reply '200 OK' "{\"ok\":true,\"data\":{\"transparent\":$enabled}}"

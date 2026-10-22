#!/bin/sh
# Authenticated full subscription import. Subscription settings cannot override the
# controller, its secret, TUN or dashboard listeners. DNS policy follows the subscription; its local listener is relocated.
set -eu
umask 077
base=/data/plugins/mihomo
reply() { printf 'Status: %s\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n%s\n' "$1" "$2"; }
if [ -z "${HTTP_AUTHORIZATION:-}" ] || ! /usr/bin/curl --fail --silent --connect-timeout 2 --max-time 5 -H "Authorization: $HTTP_AUTHORIZATION" http://192.168.0.1:9090/api/device >/dev/null 2>&1; then
    reply '401 Unauthorized' '{"ok":false,"error":"Unauthorized"}'; exit 0
fi
case "${REQUEST_METHOD:-GET}" in
GET)
    configured=false; [ ! -s "$base/subscription.url" ] || configured=true
    transparent=false; ip link show mihomo0 >/dev/null 2>&1 && transparent=true
    summary=$("$base/yq" -o=json -I=0 '{"nodes":(.proxies | length),"groups":(."proxy-groups" | length),"rules":(.rules | length)}' "$base/config.yaml" 2>/dev/null || printf '{}')
    reply '200 OK' "{\"ok\":true,\"data\":{\"configured\":$configured,\"transparent\":$transparent,\"summary\":$summary}}"; exit 0 ;;
POST) ;;
*) reply '405 Method Not Allowed' '{"ok":false,"error":"不支持此操作"}'; exit 0 ;;
esac
length=${CONTENT_LENGTH:-0}
case "$length" in ''|*[!0-9]*) length=0 ;; esac
if [ "$length" -le 0 ] || [ "$length" -gt 8192 ]; then reply '400 Bad Request' '{"ok":false,"error":"订阅请求大小无效"}'; exit 0; fi
body=$(dd bs=1 count="$length" 2>/dev/null)
action=$(jsonfilter -s "$body" -e '@.action' 2>/dev/null || true)
case "$action" in
save) url=$(jsonfilter -s "$body" -e '@.url' 2>/dev/null || true) ;;
refresh) url=$(cat "$base/subscription.url" 2>/dev/null || true) ;;
*) reply '400 Bad Request' '{"ok":false,"error":"操作无效"}'; exit 0 ;;
esac
case "$url" in http://?*|https://?*) ;; *) reply '400 Bad Request' '{"ok":false,"error":"请填写 HTTP 或 HTTPS 的 Clash YAML 订阅链接"}'; exit 0 ;; esac
if printf '%s' "$url" | grep -q '[[:space:]]'; then reply '400 Bad Request' '{"ok":false,"error":"链接不能包含空白字符"}'; exit 0; fi
if ! mkdir "$base/.subscription-lock" 2>/dev/null; then reply '409 Conflict' '{"ok":false,"error":"订阅正在更新，请稍后再试"}'; exit 0; fi
work=$(mktemp -d "$base/.subscription.XXXXXX")
success=false
trap 'rmdir "$base/.subscription-lock" 2>/dev/null || true; if [ "$success" != true ]; then rm -rf "$work"; fi' EXIT
if ! /usr/bin/curl --fail --silent --location --proto '=http,https' --proto-redir '=http,https' --connect-timeout 10 --max-time 30 --max-filesize 8388608 --user-agent 'clash.meta' --url "$url" -o "$work/subscription.yaml" 2>"$work/download.log"; then
    reply '502 Bad Gateway' '{"ok":false,"error":"订阅下载失败，请检查链接或网络"}'; exit 0
fi
secret=$(sed -n 's/^secret: "\([A-Za-z0-9_-]*\)"$/\1/p' "$base/config.yaml")
[ -n "$secret" ] || { reply '503 Service Unavailable' '{"ok":false,"error":"面板密钥不可用"}'; exit 0; }
nodes=$("$base/yq" '.proxies | length' "$work/subscription.yaml" 2>/dev/null || echo 0)
providers=$("$base/yq" '."proxy-providers" | length' "$work/subscription.yaml" 2>/dev/null || echo 0)
case "$nodes:$providers" in *[!0-9:]*|0:0) reply '400 Bad Request' '{"ok":false,"error":"订阅未包含有效节点或代理提供商"}'; exit 0 ;; esac
if ! sh "$base/render-config.sh" "$work/subscription.yaml" "$work/config.yaml" >"$work/render.log" 2>&1; then
    reply '400 Bad Request' '{"ok":false,"error":"无法解析订阅配置，请使用 Clash YAML 格式"}'; exit 0
fi
if ! "$base/mihomo" -t -d "$base" -f "$work/config.yaml" >"$work/check.log" 2>&1; then
    reply '400 Bad Request' '{"ok":false,"error":"配置校验失败，请使用含 proxies 节点列表的 Clash / Mihomo YAML 订阅"}'; exit 0
fi
cp -p "$base/config.yaml" "$work/previous.yaml"
cp "$work/config.yaml" "$base/config.yaml.new"
mv "$base/config.yaml.new" "$base/config.yaml"
reload() { /usr/bin/curl --fail --silent --connect-timeout 2 --max-time 15 -X PUT -H "Authorization: Bearer $secret" -H 'Content-Type: application/json' --data '{"path":"/data/plugins/mihomo/config.yaml"}' http://192.168.0.1:9091/configs >/dev/null 2>&1; }
valid=false
if reload; then valid=true; fi
if [ "$valid" != true ]; then
    cp "$work/previous.yaml" "$base/config.yaml"
    reload || true
    reply '400 Bad Request' '{"ok":false,"error":"完整配置应用失败，已恢复原配置。请确认节点、分组和规则有效"}'; exit 0
fi
printf '%s' "$url" > "$base/subscription.url.new"
mv "$base/subscription.url.new" "$base/subscription.url"
sh "$base/forwarding.sh" sync
success=true
reply '200 OK' '{"ok":true,"data":{"configured":true}}'

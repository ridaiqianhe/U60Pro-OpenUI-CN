#!/bin/sh
set -eu
if [ -z "${HTTP_AUTHORIZATION:-}" ] || ! /usr/bin/curl --fail --silent --connect-timeout 2 --max-time 5 -H "Authorization: $HTTP_AUTHORIZATION" http://192.168.0.1:9090/api/device >/dev/null 2>&1; then
    printf 'Status: 401 Unauthorized\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n{"ok":false,"error":"Unauthorized"}\n'
    exit 0
fi
secret=$(sed -n 's/^secret: "\([A-Za-z0-9_-]*\)"$/\1/p' /data/plugins/mihomo/config.yaml)
if [ -z "$secret" ]; then
    printf 'Status: 503 Service Unavailable\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n{"ok":false,"error":"无法读取 Mihomo 连接密钥"}\n'
    exit 0
fi
# Use only verified local listener addresses, never an arbitrary Host header.
address=${SERVER_ADDR:-192.168.0.1}
wg_address=$(ip -4 addr show dev wg-u60 2>/dev/null | awk '$1=="inet" {split($2,a,"/");print a[1];exit}')
if [ "$address" != 192.168.0.1 ] && { [ -z "$wg_address" ] || [ "$address" != "$wg_address" ]; }; then address=192.168.0.1; fi
# Fragment query stays in the browser, out of HTTP request URLs/access logs.
printf 'Content-Type: application/json\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\n\r\n{"ok":true,"data":{"url":"http://%s:9091/ui/#/?hostname=%s&port=9091&http=true&secret=%s"}}\n' "$address" "$address" "$secret"

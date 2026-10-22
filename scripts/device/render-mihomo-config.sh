#!/bin/sh
set -eu
base=/data/plugins/mihomo
source=$1
target=$2
export MIHOMO_SECRET
MIHOMO_SECRET=$(sed -n 's/^secret: "\([A-Za-z0-9_-]*\)"$/\1/p' "$base/config.yaml")
[ -n "$MIHOMO_SECRET" ]
"$base/yq" 'pick(["proxies", "proxy-groups", "proxy-providers", "rule-providers", "rules", "sub-rules", "hosts", "sniffer", "dns"])' "$source" > "$target"
if [ "$("$base/yq" '."proxy-groups" | length' "$target")" = 0 ]; then
    "$base/yq" -i '."proxy-groups" = [{"name":"节点选择","type":"select","proxies":(["自动选择","DIRECT"] + [.proxies[].name]),"use":((."proxy-providers" // {}) | keys)},{"name":"自动选择","type":"url-test","proxies":[.proxies[].name],"use":((."proxy-providers" // {}) | keys),"url":"https://www.gstatic.com/generate_204","interval":300}]' "$target"
fi
if [ "$("$base/yq" '.rules | length' "$target")" = 0 ]; then
    "$base/yq" -i '.rules = ["MATCH," + ."proxy-groups"[0].name]' "$target"
fi
"$base/yq" -i '
  ."mixed-port" = 7890 |
  ."allow-lan" = false |
  ."bind-address" = "127.0.0.1" |
  .mode = "rule" |
  ."log-level" = "info" |
  ."external-controller" = "192.168.0.1:9091" |
  ."external-ui" = "/data/plugins/mihomo/ui" |
  .secret = strenv(MIHOMO_SECRET) |
  .ipv6 = true |
  .profile = {"store-selected":true} |
  .tun = {"enable":true,"device":"mihomo0","stack":"gvisor","auto-route":true,"auto-redirect":true,"auto-detect-interface":true,"mtu":1500,"dns-hijack":["any:53","tcp://any:53"],"route-exclude-address":["10.0.0.0/8","172.16.0.0/12","192.168.0.0/16","fc00::/7","fe80::/10"]}
' "$target"
"$base/yq" -i '.secret style="double"' "$target"
# Only relocate the DNS socket; policy and upstreams follow the subscription.
if [ "$("$base/yq" '.dns.enable' "$target")" = true ]; then
    "$base/yq" -i '.dns.listen = "127.0.0.1:1053"' "$target"
else
    "$base/yq" -i '.tun."dns-hijack" = []' "$target"
fi
if [ -f "$base/transparent.disabled" ]; then
    "$base/yq" -i '.tun.enable = false' "$target"
fi
chmod 600 "$target"

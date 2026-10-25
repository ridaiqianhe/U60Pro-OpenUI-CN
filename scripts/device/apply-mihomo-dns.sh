#!/bin/sh
# Opt-in DNS split. Keep subscription nodes, routing and private node resolvers.
set -eu
base=${MIHOMO_BASE:-/data/plugins/mihomo}
target=$1
[ -s "$base/ruleset/u60-dns-cn.mrs" ] || { echo 'Missing mainland DNS domain ruleset' >&2; exit 1; }
if [ -s "$base/dns-proxy-group" ]; then
    DNS_PROXY_GROUP=$(cat "$base/dns-proxy-group")
else
    DNS_PROXY_GROUP=$("$base/yq" '."proxy-groups"[0].name // ""' "$target")
fi
export DNS_PROXY_GROUP
[ -n "$DNS_PROXY_GROUP" ] && [ "$DNS_PROXY_GROUP" != DIRECT ] && [ "$DNS_PROXY_GROUP" != REJECT ]
"$base/yq" -e '."proxy-groups"[] | select(.name == strenv(DNS_PROXY_GROUP))' "$target" >/dev/null
export DNS_CN_PATH="$base/ruleset/u60-dns-cn.mrs"
"$base/yq" -i '
 ."rule-providers"."u60-dns-cn" = {"type":"file","behavior":"domain","format":"mrs","path":strenv(DNS_CN_PATH)} |
 .dns.enable = true |
 .dns.ipv6 = true |
 .dns.listen = "127.0.0.1:1053" |
 .dns."enhanced-mode" = "fake-ip" |
 .dns."fake-ip-filter-mode" = "blacklist" |
 .dns."fake-ip-filter" = (((.dns."fake-ip-filter" // []) + ["rule-set:u60-dns-cn", "+.cn", "+.qq.com", "+.qqmusic.com", "+.tencent.com", "+.gtimg.com", "+.music.163.com", "+.lan", "+.local"]) | unique) |
 .dns."default-nameserver" = ["223.5.5.5#DIRECT", "119.29.29.29#DIRECT"] |
 .dns."proxy-server-nameserver" = (((.dns."proxy-server-nameserver" // []) | select(length > 0)) // ["223.5.5.5#DIRECT", "119.29.29.29#DIRECT"])
' "$target"
"$base/yq" -i '
 .dns.nameserver = [("https://1.1.1.1/dns-query#" + strenv(DNS_PROXY_GROUP)), ("https://8.8.8.8/dns-query#" + strenv(DNS_PROXY_GROUP))] |
 .dns."direct-nameserver" = ["223.5.5.5#DIRECT", "119.29.29.29#DIRECT"] |
 .dns."direct-nameserver-follow-policy" = true |
 .dns."nameserver-policy"."rule-set:u60-dns-cn" = ["223.5.5.5#DIRECT", "119.29.29.29#DIRECT"] |
 .dns."nameserver-policy"."+.cn" = ["223.5.5.5#DIRECT", "119.29.29.29#DIRECT"] |
 .dns."nameserver-policy"."+.qq.com" = ["119.29.29.29#DIRECT", "223.5.5.5#DIRECT"] |
 .dns."nameserver-policy"."+.qqmusic.com" = ["119.29.29.29#DIRECT", "223.5.5.5#DIRECT"] |
 .dns."nameserver-policy"."+.tencent.com" = ["119.29.29.29#DIRECT", "223.5.5.5#DIRECT"] |
 .dns."nameserver-policy"."+.gtimg.com" = ["119.29.29.29#DIRECT", "223.5.5.5#DIRECT"] |
 .dns."nameserver-policy"."+.music.163.com" = ["223.5.5.5#DIRECT", "119.29.29.29#DIRECT"] |
 del(.dns.fallback, .dns."fallback-filter")
' "$target"

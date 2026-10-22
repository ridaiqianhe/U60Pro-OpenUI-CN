#!/bin/sh
# Separate mainland/direct DNS from general DoH without changing proxy rules.
set -eu
base=/data/plugins/mihomo
target=$1
"$base/yq" -i '
 .dns."direct-nameserver" = ["223.5.5.5#DIRECT", "119.29.29.29#DIRECT"] |
 .dns."direct-nameserver-follow-policy" = false |
 .dns."nameserver-policy"."+.cn" = ["223.5.5.5#DIRECT", "119.29.29.29#DIRECT"] |
 .dns."nameserver-policy"."+.qq.com" = ["119.29.29.29#DIRECT", "223.5.5.5#DIRECT"] |
 .dns."nameserver-policy"."+.qqmusic.com" = ["119.29.29.29#DIRECT", "223.5.5.5#DIRECT"] |
 .dns."nameserver-policy"."+.gtimg.com" = ["119.29.29.29#DIRECT", "223.5.5.5#DIRECT"]
' "$target"
if [ "$("$base/yq" '."rule-providers".Direct.behavior' "$target")" = domain ]; then
 "$base/yq" -i '.dns."nameserver-policy"."rule-set:Direct" = ["223.5.5.5#DIRECT", "119.29.29.29#DIRECT"]' "$target"
fi

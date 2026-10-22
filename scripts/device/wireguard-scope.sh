#!/bin/sh
# Classify default and split-default routes without exposing configuration keys.
awk '
 {sub(/[ \t]*#.*/, ""); gsub(/\r/, "")}
 /^[ \t]*\[Peer\][ \t]*$/ {peer=1;next}
 /^[ \t]*\[/ {peer=0}
 peer && /^[ \t]*AllowedIPs[ \t]*=/ {
  sub(/^[^=]*=/, ""); n=split($0,routes,",")
  for(i=1;i<=n;i++) {gsub(/[ \t]/,"",routes[i]); split(routes[i],p,"/"); if(p[2]!="" && p[2]+0<=1) full=1}
 }
 END {print full ? "full" : "split"}
' "$1"

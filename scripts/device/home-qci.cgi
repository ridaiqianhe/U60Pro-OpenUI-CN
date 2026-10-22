#!/bin/sh
# Read-only dashboard extension; authenticate against the existing agent.
set -eu
if [ -z "${HTTP_AUTHORIZATION:-}" ] || ! /usr/bin/curl --fail --silent --show-error --connect-timeout 2 --max-time 5 -H "Authorization: $HTTP_AUTHORIZATION" http://192.168.0.1:9090/api/device >/dev/null 2>&1; then
    printf 'Status: 401 Unauthorized\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n{"ok":false,"error":"Unauthorized"}\n'
    exit 0
fi
qci=$(uci -q get zwrt_data_tmp.wwaniface1.qci || true)
case "$qci" in ''|*[!0-9]*) qci=null ;; *) [ "$qci" -ge 1 ] && [ "$qci" -le 255 ] || qci=null ;; esac
state=$(/usr/bin/curl --fail --silent --connect-timeout 1 --max-time 2 http://127.0.0.1:9460/state 2>/dev/null || true)
number() {
    value=$(jsonfilter -s "$state" -e "$1" 2>/dev/null || true)
    printf '%s\n' "$value" | awk '/^[0-9]+([.][0-9]+)?$/ && $0+0>0 {printf "%.6f", $0; found=1; exit} END {if (!found) printf "null"}'
}
dl=$(number '@.qos.ambr_dl')
ul=$(number '@.qos.ambr_ul')
# The optional on-device screen backend may be stopped; read the same modem
# session log directly. Ignore IMS and never interpret a raw unit as Mbps.
if [ "$dl" = null ] || [ "$ul" = null ]; then
    rates=$(awk '
      function mbps(value, unit, label, factor) {
        label=unit; sub(/^[^(]*\(/,"",label); sub(/\).*$/,"",label)
        factor=0
        if(label ~ /^[0-9.]+Kbps$/) {sub(/Kbps$/,"",label);factor=label/1000}
        else if(label ~ /^[0-9.]+Mbps$/) {sub(/Mbps$/,"",label);factor=label+0}
        else if(label ~ /^[0-9.]+Gbps$/) {sub(/Gbps$/,"",label);factor=label*1000}
        else if(label ~ /^[0-9.]+Tbps$/) {sub(/Tbps$/,"",label);factor=label*1000000}
        if(value ~ /^[0-9]+$/ && value+0>0 && factor>0) return sprintf("%.6f",value*factor)
        return "null"
      }
      /\[DATA\]/ && /ambr/ {
        delete f
        for(i=1;i<=NF;i++) {n=split($i,a,"=");if(n==2)f[a[1]]=a[2]}
        if(tolower(f["dnn"])=="ims" || tolower(f["apn"])=="ims") next
        if("session_ambr_dl" in f) {
          down=mbps(f["session_ambr_dl"],f["session_ambr_dl_unit"])
          up=mbps(f["session_ambr_ul"],f["session_ambr_ul_unit"])
        } else if("apn_ambr_dl" in f) {
          down=mbps(f["apn_ambr_dl"],f["apn_ambr_dl_unit"])
          up=mbps(f["apn_ambr_ul"],f["apn_ambr_ul_unit"])
        }
      }
      END {print (down=="" ? "null" : down), (up=="" ? "null" : up)}
    ' /data/logfs/key.log 2>/dev/null || true)
    if [ -n "$rates" ]; then
        [ "$dl" != null ] || dl=${rates%% *}
        [ "$ul" != null ] || ul=${rates##* }
    fi
fi
connections=null
wan=$(ip -4 route show table main default | awk '/ dev rmnet/ {for(i=1;i<=NF;i++) if($i=="dev") {print $(i+1); exit}}')
if [ -n "$wan" ] && [ -r /proc/net/nf_conntrack ]; then
    wan4=$(ip -4 addr show dev "$wan" | awk '$1=="inet" {split($2,a,"/"); print a[1]; exit}')
    lan6=$(ip -6 route show table main dev br-lan | awk '$1 ~ /^[23].*\/64$/ {print $1}')
    connections=$(awk -v wan4="$wan4" -v lan6="$lan6" '
      function prefix64(ip, a,n,i,out,k,left,right,b,c,j) {
        n=split(ip,a,"::"); left=split(a[1],b,":"); right=0
        if(n==2 && a[2]!="") right=split(a[2],c,":")
        k=0; out=""
        for(i=1;i<=left && b[i]!="";i++) v[++k]=b[i]
        if(n==2) for(i=1;i<=8-left-right;i++) v[++k]="0"
        for(i=1;i<=right;i++) v[++k]=c[i]
        for(i=1;i<=4;i++) {j=tolower(v[i]); while(length(j)<4) j="0" j; out=out j}
        return out
      }
      BEGIN {n=split(lan6,net,"\n"); for(i=1;i<=n;i++) {sub(/\/64$/,"",net[i]); local6[prefix64(net[i])]=1}}
      $3=="tcp" || $3=="udp" {
        src=""; dst=""; replydst=""; ns=0; nd=0
        for(i=1;i<=NF;i++) {
          if($i ~ /^src=/) {ns++; if(ns==1) src=substr($i,5)}
          if($i ~ /^dst=/) {nd++; if(nd==1) dst=substr($i,5); else if(nd==2) replydst=substr($i,5)}
        }
        if($1=="ipv4" && wan4!="" && replydst==wan4) count++
        if($1=="ipv6" && src ~ /^[23]/ && dst ~ /^[23]/ && !(prefix64(dst) in local6)) count++
      }
      END {print count+0}
    ' /proc/net/nf_conntrack)
fi
printf 'Content-Type: application/json\r\nCache-Control: no-store\r\n\r\n{"ok":true,"data":{"qci":%s,"ambr_dl_mbps":%s,"ambr_ul_mbps":%s,"connections":%s}}\n' "$qci" "$dl" "$ul" "$connections"

#!/bin/sh
# Permit only LAN <-> active Mihomo TUN traffic; do not change WAN policy.
set -eu
active=false
if [ "${1:-sync}" != stop ] && ip link show mihomo0 >/dev/null 2>&1; then active=true; fi
for fw in iptables ip6tables; do
 if [ "$active" = true ]; then
  "$fw" -C FORWARD -i br-lan -o mihomo0 -j ACCEPT 2>/dev/null || "$fw" -I FORWARD 1 -i br-lan -o mihomo0 -j ACCEPT
  "$fw" -C FORWARD -i mihomo0 -o br-lan -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || "$fw" -I FORWARD 1 -i mihomo0 -o br-lan -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
 else
  while "$fw" -D FORWARD -i br-lan -o mihomo0 -j ACCEPT 2>/dev/null; do :; done
  while "$fw" -D FORWARD -i mihomo0 -o br-lan -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null; do :; done
 fi
done

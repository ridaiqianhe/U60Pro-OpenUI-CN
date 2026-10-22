# Parse data only: never execute wg-quick shell hooks.
function trim(s) {sub(/^[ \t]+/,"",s);sub(/[ \t\r]+$/,"",s);return s}
function bad() {failed=1; exit 1}
{
 sub(/\r$/,""); sub(/[ \t]*#.*/,""); line=trim($0)
 if(line=="") next
 if(line=="[Interface]") {if(interface++) bad();section="interface";print line > wg;next}
 if(line=="[Peer]") {peers++;section="peer";print line > wg;next}
 eq=index(line,"=");if(!eq || !section) bad()
 key=trim(substr(line,1,eq-1));value=trim(substr(line,eq+1));if(value=="") bad()
 if(section=="interface" && key=="Address") {
  n=split(value,a,",");for(i=1;i<=n;i++){v=trim(a[i]);if(v!~/^[0-9a-fA-F:.]+\/[0-9]+$/)bad();print v > addresses;addressCount++}next
 }
 if(section=="interface" && key=="DNS") {if(value!~/^[0-9a-fA-F:., \t]+$/)bad();next}
 if(section=="interface" && key=="MTU") {if(value!~/^[0-9]+$/ || value<1280 || value>9000)bad(); print value > mtu;next}
 if(section=="interface" && key=="Table") {if(value!="auto")bad();next}
 if(section=="interface" && (key=="PrivateKey" || key=="ListenPort")) {print key " = " value > wg;next}
 if(section=="peer" && (key=="PublicKey" || key=="PresharedKey" || key=="Endpoint" || key=="PersistentKeepalive")) {print key " = " value > wg;next}
 if(section=="peer" && key=="AllowedIPs") {
  n=split(value,a,",");for(i=1;i<=n;i++){v=trim(a[i]);if(v!~/^[0-9a-fA-F:.]+\/[0-9]+$/)bad();print v > routes;routeCount++}
  print key " = " value > wg;next
 }
 bad()
}
END {if(failed || interface!=1 || !peers || !addressCount || !routeCount)exit 1}

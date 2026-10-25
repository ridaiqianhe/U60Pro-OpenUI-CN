local module=assert(arg[1]);arg={};local M=dofile(module)
for _,body in ipairs({{band='2g',settings={ssid='Guest test',enabled=true}},{duration_hours=4},{enabled=false},{lan_access=false},{band='5g',settings={encryption='sae',password='Test12345',pmf=true}}})do assert(pcall(M.validate,body))end
for _,body in ipairs({{band='main_5g',settings={ssid='x'}},{band='2g',settings={password='short'}},{duration_hours=3},{enabled='true'},{band='2g',settings={ssid='bad;command'}},{band='2g',settings={max_clients=33}},{band='2g',settings={unknown=true}},{band='5g',settings={ssid='x'},enabled=true},{action='shell'}})do assert(not pcall(M.validate,body))end
print('Guest validation passed: stock durations, bands, security, password, injection and unknown fields')

for _,method in ipairs({'reload','set','router_set_wifi_isolate'})do assert(type(M.parse_ubus('',method))=='table');assert(type(M.parse_ubus('  \n',method))=='table')end
assert(not pcall(M.parse_ubus,'','router_get_wifi_isolate'))
assert(not pcall(M.parse_ubus,'not json','reload'))
print('Stock empty mutation acknowledgements accepted; empty reads and invalid JSON rejected')

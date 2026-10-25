local json=require('luci.jsonc')
local M={}
local base='/data/plugins/guest-wifi'
local function quote(s)return "'"..tostring(s):gsub("'","'\\''").."'" end
local function command(s)local p=assert(io.popen(s,'r'));local out=p:read('*a');local ok=p:close();assert(ok,'设备接口执行失败');return out end
-- Stock WLAN mutation methods can acknowledge success with no JSON body.
function M.parse_ubus(raw,method)
 if raw:match('^%s*$') then
  assert(method=='reload' or method=='set' or method=='router_set_wifi_isolate','设备接口未返回状态')
  return {}
 end
 return assert(json.parse(raw),'设备接口响应无效')
end
local function ubus(object,method,data)
 local payload=(not data or not next(data)) and '{}' or json.stringify(data)
 local raw=command('ubus call '..object..' '..method..' '..quote(payload)..' 2>/dev/null')
 return M.parse_ubus(raw,method)
end

local function get(section,key)return (command('uci -q get wireless.'..section..'.'..key..' 2>/dev/null || true'):gsub('\n$',''))end
local function response(code,data,err)io.write('Status: '..code..'\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n'..json.stringify({ok=not err,data=data,error=err}))end
local function snapshot()
 local left={};local ok,r=pcall(ubus,'zwrt_wlan','wlan_get_guest_access_left_time',{})
 if ok then for _,v in ipairs(r.wlan_guest_left_time_info or {})do left[v.section_name]=tonumber(v.guest_left_time)end end
 local s={bands={},sync_enabled=get('zte_mbb','lbd')=='1',duration_options={0,2,4,8,12,24},security_options={'none','psk2+ccmp','psk-mixed+tkip+ccmp','sae-mixed','sae'}}
 for _,band in ipairs({'2g','5g'})do
  local section='guest_'..band
  local probe=command('hostapd_cli -i '..(band=='2g' and 'wlan1' or 'wlan3')..' status 2>/dev/null || true')
  s.bands[band]={ssid=get(section,'ssid'),enabled=get(section,'disabled')=='0',radio_enabled=get(band=='2g' and 'wifi0' or 'wifi1','disabled')=='0',broadcast=get(section,'hidden')~='1',encryption=get(section,'encryption'),password_set=get(section,'key')~='',pmf=get(section,'pmf')=='1',qr=get(section,'qrImageShow')~='0',isolate=get(section,'isolate')=='1',max_clients=tonumber(get(section,'maxassoc')) or 32,duration_hours=(tonumber(get(section,'guest_active_time')) or 0)/60,remaining_seconds=left[section],running=probe:match('state=ENABLED')~=nil,clients=tonumber(probe:match('num_sta%[0%]=(%d+)')) or 0}
 end
 local ok,iso=pcall(ubus,'zwrt_router.api','router_get_wifi_isolate',{})
 if ok and iso.guest_access_restrict_enable~=nil then s.lan_access=tonumber(iso.guest_access_restrict_enable)==0 end
 return s
end
local allowed={ssid=true,password=true,enabled=true,broadcast=true,encryption=true,pmf=true,qr=true,isolate=true,max_clients=true}
function M.validate(body)
 assert(type(body)=='table','请求格式无效')
 for k in pairs(body)do assert(k=='band' or k=='settings' or k=='enabled' or k=='duration_hours' or k=='lan_access','未知设置项')end
 if body.band then
  assert(body.band=='2g' or body.band=='5g','频段无效');assert(type(body.settings)=='table' and next(body.settings),'没有待保存的设置')
  for k,v in pairs(body.settings)do
   assert(allowed[k],'未知访客设置项')
   if k=='ssid' then assert(type(v)=='string' and #v>=1 and #v<=32 and not v:find('[%c\'";$`\\|<>&]'),'名称需为 1–32 字节，不能包含控制符或特殊命令字符')
   elseif k=='password' then assert(type(v)=='string' and ((#v>=8 and #v<=63 and not v:find('[^ -~]')) or (#v==64 and not v:find('[^%x]'))),'密码需为 8–63 位 ASCII 字符或 64 位十六进制')
   elseif k=='encryption' then assert(v=='none' or v=='psk2+ccmp' or v=='psk-mixed+tkip+ccmp' or v=='sae-mixed' or v=='sae','安全模式无效')
   elseif k=='max_clients' then assert(type(v)=='number' and v==math.floor(v) and v>=1 and v<=32,'接入数需为 1–32')
   else assert(type(v)=='boolean','开关参数无效')end
  end
  assert(body.enabled==nil and body.duration_hours==nil and body.lan_access==nil,'请分别保存频段和总开关设置')
 else
  assert(body.settings==nil,'缺少频段')
  assert(body.enabled~=nil or body.duration_hours~=nil or body.lan_access~=nil,'没有待保存的设置')
  if body.enabled~=nil then assert(type(body.enabled)=='boolean','开关无效')end
  if body.lan_access~=nil then assert(type(body.lan_access)=='boolean','局域网开关无效')end
  if body.duration_hours~=nil then local v=body.duration_hours;assert(v==0 or v==2 or v==4 or v==8 or v==12 or v==24,'开放时长无效')end
 end
 return body
end
local map={ssid='ssid',password='key',encryption='encryption',enabled='disabled',broadcast='hidden',pmf='pmf',qr='qrImageShow',isolate='isolate',max_clients='maxassoc'}
local function apply(body)
 M.validate(body)
 local changes={}
 local global_before={}
 for _,band in ipairs({'2g','5g'})do local section='guest_'..band;global_before[section]={disabled=get(section,'disabled'),guest_active_time=get(section,'guest_active_time')}end
 if body.band then
  assert(body.band~='5g' or get('zte_mbb','lbd')~='1','双频合一已开启，请从 2.4 GHz 同步设置')
  local section='guest_'..body.band;assert(get(section,'ssid')~='','固件未提供该访客网络')
  local security=body.settings.encryption or get(section,'encryption')
  local password=body.settings.password or get(section,'key')
  if security=='sae' or security=='sae-mixed' then body.settings.pmf=true end
  if security~='none' then M.validate({band=body.band,settings={password=password}})end
  for key,value in pairs(body.settings)do
   if type(value)=='boolean'then value=(key=='enabled' or key=='broadcast') and (value and '0' or '1') or (value and '1' or '0')end
   value=tostring(value);local field=map[key];local old=get(section,field)
   if old~=value then changes[#changes+1]={section=section,field=field,before=old,after=value}end
  end

  if body.settings.encryption~=nil or body.settings.pmf~=nil then
   local pmf=body.settings.pmf
   if pmf==nil then pmf=get(section,'pmf')=='1' end
   local auxiliary={sae=(security=='sae' or security=='sae-mixed') and '1' or '0',ieee80211w=security=='sae' and '2' or security=='sae-mixed' and '1' or (security~='none' and pmf and '1' or '0')}
   for field,value in pairs(auxiliary)do if get(section,field)~=value then changes[#changes+1]={section=section,field=field,before=get(section,field),after=value}end end
  end
 end
 if body.band=='2g' and get('zte_mbb','lbd')=='1' then
  local count=#changes
  for i=1,count do local c=changes[i];changes[#changes+1]={section='guest_5g',field=c.field,before=get('guest_5g',c.field),after=c.after}end
 end
 local old_lan
 if body.lan_access~=nil then old_lan=ubus('zwrt_router.api','router_get_wifi_isolate',{}).guest_access_restrict_enable;assert(old_lan~=nil,'固件未提供局域网访问控制')end
 local ok,err=pcall(function()
  if #changes>0 then
   -- Match the agent transaction: plaintext UCI key storage, then stock WLAN reload.
   for _,c in ipairs(changes)do command('uci set '..quote('wireless.'..c.section..'.'..c.field..'='..c.after))end
   command('uci commit wireless');ubus('zwrt_wlan','reload',{})
   for _,c in ipairs(changes)do assert(get(c.section,c.field)==c.after,'设置回读不一致')end
  end
  if body.enabled~=nil or body.duration_hours~=nil then
   local payload={}
   for _,band in ipairs({'2g','5g'})do local v={}
    if body.enabled~=nil then v.disabled=body.enabled and '0' or '1'end
    if body.duration_hours~=nil then v.guest_active_time=tostring(body.duration_hours*60)end
    payload['guest_'..band]=v
   end
   ubus('zwrt_wlan','set',payload)
   for section,v in pairs(payload)do for k,value in pairs(v)do assert(get(section,k)==value,'访客定时设置回读不一致')end end
  end
  if body.lan_access~=nil then
   local expected=body.lan_access and 0 or 1
   ubus('zwrt_router.api','router_set_wifi_isolate',{guest_access_restrict_enable=expected})
   assert(tonumber(ubus('zwrt_router.api','router_get_wifi_isolate',{}).guest_access_restrict_enable)==expected,'局域网设置回读不一致')
  end
 end)
 if not ok then
  if body.enabled~=nil or body.duration_hours~=nil then pcall(ubus,'zwrt_wlan','set',global_before)end
  if old_lan~=nil then pcall(ubus,'zwrt_router.api','router_set_wifi_isolate',{guest_access_restrict_enable=tonumber(old_lan)})end
  for _,c in ipairs(changes)do
   if c.before=='' then pcall(command,'uci -q delete '..quote('wireless.'..c.section..'.'..c.field)..' || true')else pcall(command,'uci set '..quote('wireless.'..c.section..'.'..c.field..'='..c.before))end
  end
  if #changes>0 then pcall(command,'uci commit wireless');pcall(ubus,'zwrt_wlan','reload',{})end
  error('保存未完成，已恢复频段设置；请刷新检查原厂状态')
 end
 return snapshot()
end
function M.cgi()
 local auth=os.getenv('HTTP_AUTHORIZATION') or ''
 if not auth:match('^Bearer [%w_%.%-]+$') or command('curl --silent --connect-timeout 2 --max-time 5 --output /dev/null --write-out "%{http_code}" -H '..quote('Authorization: '..auth)..' http://192.168.0.1:9090/api/device 2>/dev/null')~='200' then response('401 Unauthorized',nil,'Unauthorized');return end
 if os.getenv('REQUEST_METHOD')=='GET'then local ok,s=pcall(snapshot);response(ok and '200 OK' or '503 Service Unavailable',ok and s or nil,not ok and '无法读取访客网络状态' or nil);return end
 if os.getenv('REQUEST_METHOD')~='POST'then response('405 Method Not Allowed',nil,'不支持此操作');return end
 local length=tonumber(os.getenv('CONTENT_LENGTH')) or 0
 if length<1 or length>8192 then response('400 Bad Request',nil,'请求大小无效');return end
 local body=json.parse(io.read(length));local valid=pcall(M.validate,body)
 if not valid then response('400 Bad Request',nil,'访客设置无效，请检查名称、密码和时长');return end
 if os.execute('mkdir '..base..'/.lock 2>/dev/null')~=0 then response('409 Conflict',nil,'访客设置正忙');return end
 local ok,value=pcall(apply,body);os.execute('rmdir '..base..'/.lock 2>/dev/null')
 response(ok and '200 OK' or '503 Service Unavailable',ok and value or nil,not ok and '保存失败，请刷新状态后重试' or nil)
end
if arg and arg[1]=='cgi'then M.cgi()end
return M

local json=require('luci.jsonc')
local base='/data/plugins/neighbor-scan'
local function read(p)local f=io.open(p);if not f then return nil end;local s=f:read('*a');f:close();return s end
local function load(p,d)local s=read(p);return s and json.parse(s) or d end
local function save(p,d)local f=assert(io.open(p..'.new','w'));f:write(json.stringify(d));f:close();assert(os.rename(p..'.new',p))end
local function quote(s)return "'"..s:gsub("'","'\\''").."'"end
local function command(s)local p=assert(io.popen(s));local r=p:read('*a');p:close();return r end
local function filter(raw,net)
 local serving={}
 local function add(rat,pci,arfcn)if tonumber(pci) and tonumber(arfcn)then serving[rat..':'..tonumber(pci)..':'..tonumber(arfcn)]=true end end
 add('NR',net.nr5g_pci,net.nr5g_action_channel);add('LTE',net.lte_pci,net.wan_active_channel)
 for segment in tostring(net.nrca or ''):gmatch('[^;]+')do local p={};for v in (segment..','):gmatch('(.-),')do p[#p+1]=v end;add('NR',p[2],p[5])end
 for segment in tostring(net.lteca or ''):gmatch('[^;]+')do local p={};for v in (segment..','):gmatch('(.-),')do p[#p+1]=v end;add('LTE',p[1],p[4])end
 local cells={};local seen={}
 for _,c in ipairs(raw.cells or {})do
  local pci=tonumber(c.pci);local arfcn=tonumber(c.arfcn);local rat=c.rat
  local key=tostring(rat)..':'..tostring(pci)..':'..tostring(arfcn)
  if (rat=='NR' or rat=='LTE') and pci and pci>=0 and pci<=(rat=='NR' and 1007 or 503) and pci==math.floor(pci) and not serving[key] and not seen[key] then
   seen[key]=true
   local rsrp=tonumber(c.rsrp_dbm);if rsrp and (rsrp< -140 or rsrp> -30)then rsrp=nil end
   cells[#cells+1]={rat=rat,pci=pci,arfcn=arfcn,band=tonumber(c.band),rsrp_dbm=rsrp,samples=tonumber(c.samples) or 0}
   if #cells>=128 then break end
  end
 end
 table.sort(cells,function(a,b)if a.rsrp_dbm~=b.rsrp_dbm then return (a.rsrp_dbm or -999)>(b.rsrp_dbm or -999)end;return a.pci<b.pci end)
 return cells
end
local function response(code,data,err)io.write('Status: '..code..'\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n'..json.stringify(err and {ok=false,error=err} or {ok=true,data=data})..'\n')end
local function status()
 local s=load(base..'/state.json',{status='idle',cells={}})
 if s.status=='collecting' and command('test -d /var/run/u60-neighbor-scan.lock && echo yes')~='yes\n' then s.status='error';s.error='上次采集被中断，请重新采集' end
 s.age_seconds=s.sampled_at and math.max(0,os.time()-s.sampled_at) or nil
 s.stale=s.age_seconds and s.age_seconds>300 or false
 return s
end
if arg[1]=='finish' then
 local raw=assert(load(arg[2],nil),'Invalid parser output');local net=json.parse(command([[ubus -t 5 call zte_nwinfo_api nwinfo_get_netinfo '{}' 2>/dev/null]]));assert(type(net)=='table','Radio state unavailable')
 save(base..'/state.json',{status='ready',cells=filter(raw,net),sampled_at=os.time(),sampled_time=os.date('%Y-%m-%d %H:%M:%S'),partial=raw.partial==true,frames=raw.frames or 0,malformed=raw.malformed or 0,discarded=raw.discarded or 0,source='qtrace',duration_seconds=30})
elseif arg[1]=='error' then
 local s=load(base..'/state.json',{cells={}});s.status='error';s.error='邻区采集失败或诊断通道被占用，请稍后重试';save(base..'/state.json',s)
elseif arg[1]=='selftest' then
 local c=filter({cells={{rat='NR',pci=0,arfcn=123,rsrp_dbm=-90},{rat='NR',pci=978,arfcn=504990,rsrp_dbm=-80},{rat='NR',pci=20,arfcn=456,rsrp_dbm=-156},{rat='NR',pci=20,arfcn=456},{rat='NR',pci=1008,arfcn=789}}},{nr5g_pci=978,nr5g_action_channel=504990})
 assert(#c==2 and c[1].pci==0 and c[2].rsrp_dbm==nil);print('neighbor filtering checks passed')
elseif arg[1]=='cgi' then
 local auth=os.getenv('HTTP_AUTHORIZATION') or ''
 if not auth:match('^Bearer [%w_%.%-]+$') or command('curl --silent --connect-timeout 2 --max-time 5 --output /dev/null --write-out "%{http_code}" -H '..quote('Authorization: '..auth)..' http://192.168.0.1:9090/api/device 2>/dev/null')~='200'then response('401 Unauthorized',nil,'Unauthorized');return end
 local method=os.getenv('REQUEST_METHOD')
 if method=='GET'then response('200 OK',status());return end
 if method~='POST'then response('405 Method Not Allowed',nil,'不支持此操作');return end
 local length=tonumber(os.getenv('CONTENT_LENGTH'))or 0
 if length<1 or length>256 then response('400 Bad Request',nil,'请求大小无效');return end
 local body=json.parse(io.read(length));if type(body)~='table' or body.action~='scan'then response('400 Bad Request',nil,'无效操作');return end
 if os.execute('mkdir /var/run/u60-neighbor-scan.lock 2>/dev/null')~=0 then response('409 Conflict',nil,'正在采集中，请等待完成');return end
 local s=load(base..'/state.json',{cells={}});s.status='collecting';s.error=nil;save(base..'/state.json',s)
 os.execute('nohup sh '..base..'/collect.sh </dev/null >/dev/null 2>&1 &')
 response('200 OK',status())
end

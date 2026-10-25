local json=require('luci.jsonc')
local nixio=require('nixio')
local base='/data/plugins/traffic-query'
local parser=dofile(base..'/parser.lua')
local M={}
local function quote(s)return "'"..tostring(s):gsub("'","'\\''").."'" end
local function command(s)local p=assert(io.popen(s,'r'));local out=p:read('*a');assert(p:close(),'设备接口执行失败');return out end
local function call(object,method,data)
 local payload=(not data or not next(data)) and '{}' or json.stringify(data)
 local raw=command('ubus call '..object..' '..method..' '..quote(payload)..' 2>/dev/null')
 if raw:match('^%s*$')then assert(method:match('^set_') or method=='zte_libwms_send_sms','原厂接口无响应');return {}end
 return assert(json.parse(raw),'原厂接口响应无效')
end
local function load(name,default)local f=io.open(base..'/'..name,'r');if not f then return default end;local raw=f:read('*a');f:close();return json.parse(raw) or default end
local function save(name,value)local f=assert(io.open(base..'/'..name..'.new','w'));f:write(json.stringify(value));f:flush();f:close();assert(os.rename(base..'/'..name..'.new',base..'/'..name))end
local function utf8(n)if n<128 then return string.char(n)elseif n<2048 then return string.char(192+math.floor(n/64),128+n%64)else return string.char(224+math.floor(n/4096),128+math.floor(n/64)%64,128+n%64)end end
local function decode(s)s=tostring(s or '');if #s==0 or #s%4~=0 or s:find('[^%x]')then return s end;return(s:gsub('%x%x%x%x',function(v)return utf8(tonumber(v,16))end))end
local function sim()
 local d=call('zwrt_zte_mdm.api','get_sim_info',{})
 local prefix=tostring(d.sim_imsi or ''):sub(1,5)
 local carrier=({['46000']='cmcc',['46002']='cmcc',['46004']='cmcc',['46007']='cmcc',['46008']='cmcc',['46001']='cucc',['46006']='cucc',['46009']='cucc',['46003']='ctcc',['46005']='ctcc',['46011']='ctcc'})[prefix]
 -- A private fingerprint, never returned to the dashboard.
 local temporary=base..'/sim-'..tostring(nixio.getpid())..'.tmp'
 local f=assert(io.open(temporary,'w'));f:write(tostring(d.sim_iccid),tostring(d.current_sim_slot));f:close()
 local fingerprint=command('sha256sum '..temporary):match('^(%x+)');os.remove(temporary)
 return carrier,assert(fingerprint)
end
local carriers={cmcc={number='10086',message='LLCX',name='中国移动'},cucc={number='10010',message='CXLL',name='中国联通'},ctcc={number='10001',message='108',name='中国电信'}}
local function messages()local d=call('zwrt_wms','zte_libwms_get_sms_data',{page=0,data_per_page=100,mem_store=1,tags=10,order_by='order by id desc'});return assert(d.messages,'短信服务未就绪')end
local function key(m)return tostring(m.id)..'|'..tostring(m.date)..'|'..decode(m.number)end
local function stat()return call('zwrt_data','get_wwandst',{source_module='web',cid=1,type=4})end
local function limit()local d=call('zwrt_data','get_wwandst_monthlimit',{source_module='web',cid=1});local flag=command('uci -q get zwrt_data_commit.wwancid1dst.month_limit_overflow_auto_disconn_enable 2>/dev/null || true');d.auto_disconnect=flag:match('^1')~=nil;return d end
local function response(code,data,err)io.write('Status: '..code..'\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n'..json.stringify({ok=not err,data=data,error=err}))end
local function locked(fn)
 if os.execute('mkdir '..base..'/.lock 2>/dev/null')~=0 then return false,'busy' end
 local ok,value=pcall(fn);os.execute('rmdir '..base..'/.lock 2>/dev/null');return ok,value
end
-- The stock daemon reads this official option when checking the monthly limit.
-- Its ubus overflow_auto_disconn field changes runtime overflow state, not this enable option.
local function disconnect(enabled)
 command('uci set zwrt_data_commit.wwancid1dst.month_limit_overflow_auto_disconn_enable='..(enabled and '1' or '0')..' && uci commit zwrt_data_commit')
end
local function configure(result,s)
 local before_limit=limit();local before_stats=stat();local used_before=(tonumber(before_stats.month_tx_bytes)or 0)+(tonumber(before_stats.month_rx_bytes)or 0)
 s.before={limit=before_limit,used_bytes=used_before};s.status='applying';s.result=result;save('before-'..os.date('%Y%m%d-%H%M%S')..'.json',s.before);save('state.json',s)
 local params={source_module='web',cid=1,enable=0,type=2,value=string.format('%.0f',result.total_bytes),ratio=tonumber(before_limit.ratio)or 80,overflow_auto_disconn=0}
 local ok,apply_error=pcall(function()
  call('zwrt_data','set_wwandst_monthlimit',params)
  call('zwrt_data','set_wwandst_calibmonth',{source_module='web',cid=1,type=2,value=string.format('%.0f',result.used_bytes)})
  params.enable=1;params.overflow_auto_disconn=1
  call('zwrt_data','set_wwandst_monthlimit',params)
  disconnect(true)
  local current=limit();local stats=stat();local used=(tonumber(stats.month_tx_bytes)or 0)+(tonumber(stats.month_rx_bytes)or 0)
  save('readback.json',{limit=current,used_bytes=used,expected=result})
  assert(tonumber(current.enable)==1 and tonumber(current.type)==2 and tonumber(current.value)==result.total_bytes and current.auto_disconnect,'限额回读不一致')
  assert(used>=result.used_bytes-1024 and used-result.used_bytes<128*1024^2,'已用流量回读不一致')
 end)
 if not ok then
  save('apply-error.json',{error=tostring(apply_error)})
  local restore={source_module='web',cid=1,enable=tonumber(before_limit.enable),type=tonumber(before_limit.type),value=tostring(before_limit.value),ratio=tonumber(before_limit.ratio),overflow_auto_disconn=before_limit.auto_disconnect and 1 or 0}
  local restored=pcall(function()call('zwrt_data','set_wwandst_monthlimit',{source_module='web',cid=1,enable=0});call('zwrt_data','set_wwandst_calibmonth',{source_module='web',cid=1,type=2,value=string.format('%.0f',used_before)});call('zwrt_data','set_wwandst_monthlimit',restore);disconnect(before_limit.auto_disconnect)end)
  s.status=restored and 'error' or 'uncertain';s.error=restored and '原厂设置回读失败，已恢复先前设置' or '原厂设置状态不明，请检查原厂流量设置';save('state.json',s);return
 end
 os.remove(base..'/apply-error.json')
 s.status='applied';s.error=nil;s.applied_at=os.date('%Y-%m-%d %H:%M:%S');save('state.json',s)
end
local function initialize(s,identity)
 s.seen={};for _,m in ipairs(messages())do s.seen[key(m)]=true end;s.identity=identity;s.status='ready';s.result=nil;s.error=nil;s.pending_at=nil;save('state.json',s)
end
function M.tick(force)
 if not force and M.last and os.time()-M.last<15 then return end;M.last=os.time()
 return locked(function()
  local c=load('config.json',{})
  local carrier,identity=sim();if not carrier then return end
  local s=load('state.json',{})
  if c.auto_sync~=true and not s.pending_at then return end
  if not s.seen or s.identity~=identity then
   if s.identity and s.identity~=identity and s.applied_at and s.result then
    local old=limit();if tonumber(old.enable)==1 and tonumber(old.value)==s.result.total_bytes then call('zwrt_data','set_wwandst_monthlimit',{source_module='web',cid=1,enable=0})end
   end
   s.applied_at=nil;initialize(s,identity);return
  end
  if s.status=='applying' then s.status='uncertain';s.error='上次同步未完成，请检查原厂设置，系统不会自动重复校准';save('state.json',s);return end
  local dirty=false
  local list=messages();table.sort(list,function(a,b)return tonumber(a.id)<tonumber(b.id)end)
  for _,m in ipairs(list)do
   local k=key(m)
   if not s.seen[k] then
    s.seen[k]=true;dirty=true
    local text=decode(m.content);local sender=decode(m.number)
    if sender==carriers[carrier].number and (tonumber(m.tag)==0 or tonumber(m.tag)==1) and text:find('流量',1,true) then
     local yy,mm,dd=tostring(m.date):match('^(%d%d)[,;/%-](%d%d)[,;/%-](%d%d)')
     local today=os.date('*t')
     if tonumber(yy)==today.year%100 and tonumber(mm)==today.month and tonumber(dd)==today.day then
      local result,err=parser.parse(text)
      if result then s.pending_at=nil;save('state.json',s);if c.auto_sync then configure(result,s)else s.result=result;s.status='parsed';s.error=nil end
      elseif s.pending_at then s.status='needs_review';s.error=err;s.pending_at=nil end
     end
    end
   end
  end
  if s.pending_at and os.time()-s.pending_at>180 then dirty=true;s.status='timeout';s.error='等待回复超时，未修改限额；不会自动重发短信';s.pending_at=nil end
  -- Bound dedup to currently stored messages; old IDs also carry their receipt date.
  local seen={};for _,m in ipairs(list)do seen[key(m)]=true end;s.seen=seen;if dirty then save('state.json',s)end
 end)
end
local function status()
 local c=load('config.json',{});local s=load('state.json',{});local carrier=sim();local l=limit();local d=stat()
 return {auto_sync=c.auto_sync==true,carrier=carrier,carrier_name=carriers[carrier]and carriers[carrier].name or '暂不支持此运营商',status=s.status or 'ready',error=s.error,result=s.result,applied_at=s.applied_at,query_at=s.query_at,official={enabled=tonumber(l.enable)==1,total_bytes=tonumber(l.value),used_bytes=(tonumber(d.month_tx_bytes)or 0)+(tonumber(d.month_rx_bytes)or 0),auto_disconnect=l.auto_disconnect}}
end
local function query()
 local c=load('config.json',{});local carrier,identity=sim();local target=assert(carriers[carrier],'不支持此运营商，请手动查询')
 local s=load('state.json',{})
 assert(not s.pending_at or os.time()-s.pending_at>=180,'正在等待运营商回复，请勿重复查询')
 assert(tonumber(call('zwrt_wms','zwrt_wms_get_cmd_status',{sms_cmd=1}).sms_cmd_status_result)==3,'短信服务未就绪')
 local previous=s.result;local applied=s.applied_at;initialize(s,identity);s.result=previous;s.applied_at=applied;s.pending_at=os.time();s.query_at=os.date('%Y-%m-%d %H:%M:%S');s.status='sending';save('state.json',s)
 local hex=target.message:gsub('.',function(ch)return string.format('%04X',ch:byte())end)
 call('zwrt_wms','zte_libwms_send_sms',{number=target.number,sms_time=os.date('%y;%m;%d;%H;%M;%S;')..'+8',message_body=hex,id='-1',encode_type='GSM7_default'})
 s.status='uncertain'
 for _=1,20 do nixio.nanosleep(0,500000000);local v=tonumber(call('zwrt_wms','zwrt_wms_get_cmd_status',{sms_cmd=4}).sms_cmd_status_result);if v==3 then s.status='waiting';break elseif v==2 then s.status='send_failed';break end end
 save('state.json',s)
 return status()
end
function M.cgi()
 local auth=os.getenv('HTTP_AUTHORIZATION')or ''
 if not auth:match('^Bearer [%w_%.%-]+$')or command('curl -s --connect-timeout 2 --max-time 5 -o /dev/null -w "%{http_code}" -H '..quote('Authorization: '..auth)..' http://192.168.0.1:9090/api/device')~='200'then response('401 Unauthorized',nil,'Unauthorized');return end
 if os.getenv('REQUEST_METHOD')=='GET'then local ok,data=pcall(status);response(ok and '200 OK'or '503 Service Unavailable',ok and data or nil,not ok and '无法读取原厂流量状态'or nil);return end
 local length=tonumber(os.getenv('CONTENT_LENGTH'))or 0
 if os.getenv('REQUEST_METHOD')~='POST'or length<1 or length>1024 then response('400 Bad Request',nil,'请求无效');return end
 local body=json.parse(io.read(length))or {}
 local ok,result=locked(function()
  if body.action=='query'then return query()
  elseif body.action=='auto_sync'then assert(type(body.enabled)=='boolean');local c=load('config.json',{});c.auto_sync=body.enabled;save('config.json',c);if c.auto_sync then local _,identity=sim();initialize(load('state.json',{}),identity)end;return status()
  else error('action')end
 end)
 response(ok and '200 OK'or '409 Conflict',ok and result or nil,not ok and '查询未完成：请确认没有正在等待的查询，且短信服务已就绪；不要连续重发'or nil)
end
if arg and arg[1]=='cgi'then M.cgi()end
return M

local json=require('luci.jsonc')
local nixio=require('nixio')
local base='/data/plugins/sms-forward'
local function read(path) local f=io.open(path,'r');if not f then return nil end;local s=f:read('*a');f:close();return s end
local function save(path,value) local f=assert(io.open(path..'.new','w'));f:write(json.stringify(value));f:close();assert(os.rename(path..'.new',path)) end
local function load(path,default) local s=read(path);return s and json.parse(s) or default end
local function quote(s) return "'"..tostring(s):gsub("'","'\\''").."'" end
local function command(s) local p=io.popen(s,'r');if not p then return '' end;local v=p:read('*a');p:close();return v end
local function utf8(n)
 if n<128 then return string.char(n) elseif n<2048 then return string.char(192+math.floor(n/64),128+n%64) elseif n<65536 then return string.char(224+math.floor(n/4096),128+math.floor(n/64)%64,128+n%64) end
 return string.char(240+math.floor(n/262144),128+math.floor(n/4096)%64,128+math.floor(n/64)%64,128+n%64)
end
local function decode(s)
 s=tostring(s or '')
 if #s==0 or #s%4~=0 or s:find('[^%x]') then return s end
 local out={};local i=1
 while i<=#s do local n=tonumber(s:sub(i,i+3),16);i=i+4
  if n>=0xD800 and n<=0xDBFF then local low=tonumber(s:sub(i,i+3),16);if not low or low<0xDC00 or low>0xDFFF then return s end;n=0x10000+(n-0xD800)*1024+low-0xDC00;i=i+4
  elseif n>=0xDC00 and n<=0xDFFF then return s end
  if n==0 then return s end;out[#out+1]=utf8(n)
 end
 return table.concat(out)
end
local function sender(s) s=tostring(s or '');local d=decode(s);if d:match('^[+%d*#]+$') then return d end;return s end
local function messages()
 local raw=command([[ubus call zwrt_wms zte_libwms_get_sms_data '{"page":0,"data_per_page":500,"mem_store":1,"tags":10,"order_by":"order by id desc"}' 2>/dev/null]])
 local d=json.parse(raw);if type(d)~='table' or type(d.messages)~='table' then error('SMS unavailable') end;return d.messages
end
local function fingerprint(m)
 local f=assert(io.open(base..'/fingerprint.tmp','w'));f:write(tostring(m.id), '\n',tostring(m.date),'\n',tostring(m.number),'\n',tostring(m.content));f:close()
 local hash=command('sha256sum '..base..'/fingerprint.tmp'):match('^(%x+)');os.remove(base..'/fingerprint.tmp');return assert(hash)
end
local function baseline()
 local s={seen={},pending={},history={}}
 for _,m in ipairs(messages()) do if tonumber(m.tag)==0 or tonumber(m.tag)==1 then s.seen[fingerprint(m)]=true end end
 return s
end
local function config()
 local c=load(base..'/config.json',{})
 if not c.channels then
  c.channels={}
  if type(c.url)=='string' and c.url~='' then c.channels={{id='legacy',name='Webhook',enabled=true,url=c.url,token=c.token or '',format=c.format or 'json',form_fields=c.form_fields or '',sender_filter=c.sender_filter or '',keyword_filter=c.keyword_filter or ''}}end
  c.url=nil;c.token=nil;c.format=nil;c.form_fields=nil;c.sender_filter=nil;c.keyword_filter=nil;c.schema=2
 end
 return c
end
local function migrate(s,c)
 s.seen=s.seen or {};s.pending=s.pending or {};s.history=s.history or {}
 for _,item in pairs(s.pending) do
  if not item.deliveries then item.deliveries={legacy={attempts=item.attempts or 0,next_try=item.next_try or 0}};item.attempts=nil;item.next_try=nil end
 end
 for _,h in ipairs(s.history)do if not h.channel_id then h.channel_id='legacy';h.channel_name='历史单路' end end
 return s
end
local function log(s,id,ch,ok,status,reason)
 table.insert(s.history,1,{event_id=id,channel_id=ch.id,channel_name=ch.name,time=os.time(),time_text=os.date('%Y-%m-%d %H:%M:%S'),ok=ok,status=status,reason=reason})
 while #s.history>80 do table.remove(s.history) end
end
local function urlencode(value)
 return tostring(value):gsub('[^%w%-_%.~]',function(c) return string.format('%%%02X',string.byte(c)) end)
end
local function formbody(fields,payload)
 local result={}
 for line in (fields..'\n'):gmatch('(.-)\n') do
  line=line:gsub('\r$','')
  if line:match('%S') then
   local key,value=line:match('^([^=]+)=(.*)$');assert(key,'field')
   key=key:match('^%s*(.-)%s*$');assert(#key>0,'field')
   value=value:gsub('{{([%w_]+)}}',function(name)
    assert(name=='content' or name=='sender' or name=='received_at' or name=='event_id' or name=='event' or name=='device','variable')
    return tostring(payload[name] or '')
   end)
   result[#result+1]=urlencode(key)..'='..urlencode(value)
  end
 end
 assert(#result>0,'fields');return table.concat(result,'&')
end
local function deliver(c,payload)
 local body=c.format=='form' and formbody(c.form_fields or '',payload) or json.stringify(payload)
 local content_type=c.format=='form' and 'application/x-www-form-urlencoded' or 'application/json'
 local f=assert(io.open(base..'/request.json','w'));f:write(body);f:close()
 f=assert(io.open(base..'/curl.conf','w'));f:write('url = ',json.stringify(c.url),'\n')
 if c.token and c.token~='' then f:write('header = ',json.stringify('Authorization: Bearer '..c.token),'\n') end;f:close()
 local status=command('curl --silent --connect-timeout 2 --max-time 5 --proto "=http,https" --config '..base..'/curl.conf --header '..quote('Content-Type: '..content_type)..' --data-binary @'..base..'/request.json --max-filesize 65536 --output '..base..'/response.json --write-out "%{http_code}" 2>/dev/null')
 local result=load(base..'/response.json',nil)
 os.remove(base..'/request.json');os.remove(base..'/curl.conf');os.remove(base..'/response.json')
 local n=tonumber(status) or 0;local ok=n>=200 and n<300
 if ok and c.url:match('^https://api%.day%.app/') then
  ok=type(result)=='table' and tonumber(result.code)==200
  if not ok then return false,n,'application_error' end
 end
 if ok then return true,n end
 return false,n,'http_error'
end
local function delete_message(id)
 assert(type(id)=='number' and id>0 and id==math.floor(id),'id')
 command('ubus call zwrt_wms zwrt_wms_delete_sms '..quote(json.stringify({id=tostring(id)..';'}))..' 2>/dev/null')
 for _=1,30 do
  nixio.nanosleep(0,100000000)
  local found=false;for _,m in ipairs(messages()) do if tonumber(m.id)==id then found=true;break end end
  if not found then return true end
 end
 return false
end
local function cleanup_sms(c,s)
 if not c.cleanup_enabled then return end
 local list=messages();local remove=#list-49
 if remove<=0 then return end
 table.sort(list,function(a,b)
  local ad=tostring(a.date or ''):gsub('%D','');local bd=tostring(b.date or ''):gsub('%D','')
  if ad==bd then return tonumber(a.id)<tonumber(b.id) end
  return ad<bd
 end)
 s.cleanup_error=nil
 for _,m in ipairs(list) do
  if remove<=0 then break end
  local id=tonumber(m.id)
  if id and id>0 and tonumber(m.tag)~=4 and not s.pending[fingerprint(m)] then
   -- Re-read before each deletion so reused IDs and new arrivals cannot be mistaken for old messages.
   local unchanged=false
   for _,fresh in ipairs(messages()) do
    if tonumber(fresh.id)==id and fingerprint(fresh)==fingerprint(m) then unchanged=true;break end
   end
   if unchanged then
    if not delete_message(id) then s.cleanup_error='短信删除未确认，将在下次检查重试';break end
    s.cleaned_total=(s.cleaned_total or 0)+1;s.last_cleanup=os.time();remove=remove-1
    save(base..'/state.json',s)
   end
  end
 end
 if remove>0 and not s.cleanup_error then s.cleanup_error='待转发短信或草稿已保护，暂不继续删除' end
 save(base..'/state.json',s)
end
local function matches(ch,from,content)
 return (not ch.sender_filter or ch.sender_filter=='' or from:find(ch.sender_filter,1,true)) and (not ch.keyword_filter or ch.keyword_filter=='' or content:find(ch.keyword_filter,1,true))
end
local function enqueue(s,c,m)
 local id=fingerprint(m)
 if s.seen[id] then return end
 s.seen[id]=true
 local from=sender(m.number);local content=decode(m.content);local deliveries={}
 for _,ch in ipairs(c.channels)do if ch.enabled and matches(ch,from,content)then deliveries[ch.id]={attempts=0,next_try=0}end end
 if next(deliveries)then s.pending[id]={payload={event='sms.received',event_id=id,device='U60 Pro',sender=from,content=content,received_at=m.date},deliveries=deliveries}end
end
local function dispatch(s,c,send)
 -- Fair per-channel budgets: one failing endpoint cannot consume the other channels budget.
 local count=#c.channels;local first=s.next_channel or 1;local deadline=os.time()+10
 for offset=0,count-1 do
  local index=((first-1+offset)%count)+1;local ch=c.channels[index]
  s.next_channel=(index%count)+1
  local sent=0
  if ch.enabled then
   for id,item in pairs(s.pending)do
    local target=item.deliveries[ch.id]
    if target and target.next_try<=os.time() and sent<4 then
     if os.time()>=deadline then save(base..'/state.json',s);return end
     sent=sent+1;local ok,status,reason=send(ch,item.payload);log(s,id,ch,ok,status,reason)
     if ok then item.deliveries[ch.id]=nil
     else target.attempts=target.attempts+1;target.next_try=os.time()+math.min(900,15*2^math.min(target.attempts,6))end
     if not next(item.deliveries)then s.pending[id]=nil end
     save(base..'/state.json',s)
    end
   end
  end
 end
end
local function tick()
 local c=config();if not c.enabled and not c.cleanup_enabled then return end
 local s=load(base..'/state.json',nil)
 if not s then s=c.enabled and baseline() or {seen={},pending={},history={}} end
 s=migrate(s,c)
 if c.enabled then
  for _,m in ipairs(messages())do if tonumber(m.tag)==0 or tonumber(m.tag)==1 then enqueue(s,c,m)end end
  save(base..'/state.json',s)
  dispatch(s,c,deliver)
 end
 cleanup_sms(c,s)
end

local function lock(fn)
 local result=os.execute('mkdir '..base..'/.lock 2>/dev/null')
 if result~=0 then return false,'busy' end
 local ok,value=pcall(fn);os.execute('rmdir '..base..'/.lock 2>/dev/null');return ok,value
end
local function response(code,data,err)
 io.write('Status: ',code,'\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n',json.stringify(err and {ok=false,error=err} or {ok=true,data=data}),'\n')
end
local function channel_pending(s,id)
 local n=0;for _,item in pairs(s.pending or {})do if item.deliveries and item.deliveries[id]then n=n+1 end end;return n
end
local function status()
 local c=config();local s=migrate(load(base..'/state.json',{pending={},history={}}),c);local pending=0;local channels={}
 for _ in pairs(s.pending)do pending=pending+1 end
 for _,ch in ipairs(c.channels)do
  channels[#channels+1]={id=ch.id,name=ch.name,enabled=ch.enabled==true,url=ch.url,format=ch.format or 'json',form_fields=ch.form_fields or '',token_configured=ch.token and ch.token~='' or false,sender_filter=ch.sender_filter or '',keyword_filter=ch.keyword_filter or '',pending=channel_pending(s,ch.id)}
 end
 return {schema=2,cleanup_enabled=c.cleanup_enabled==true,cleanup_threshold=50,cleaned_total=s.cleaned_total or 0,cleanup_error=s.cleanup_error,enabled=c.enabled==true,channels=channels,pending=pending,history=s.history or {}}
end
local function validate(ch)
 assert(type(ch.url)=='string' and ch.url:match('^https?://[^%s]+$') and #ch.url<=4096,'url')
 assert(type(ch.name)=='string' and #ch.name>0 and #ch.name<=80,'name')
 assert(type(ch.token)=='string' and not ch.token:find('[\r\n]') and #ch.token<=2048,'token')
 assert(ch.format=='json' or ch.format=='form','format')
 assert(type(ch.form_fields)=='string' and #ch.form_fields<=8192,'fields')
 assert(type(ch.sender_filter)=='string' and #ch.sender_filter<=128 and type(ch.keyword_filter)=='string' and #ch.keyword_filter<=256,'filters')
 if ch.format=='form'then formbody(ch.form_fields,{})end
end
local function cgi()
 local auth=os.getenv('HTTP_AUTHORIZATION') or ''
 if not auth:match('^Bearer [%w_%.%-]+$') or command('curl --silent --connect-timeout 2 --max-time 5 --output /dev/null --write-out "%{http_code}" -H '..quote('Authorization: '..auth)..' http://192.168.0.1:9090/api/device 2>/dev/null')~='200' then response('401 Unauthorized',nil,'Unauthorized');return end
 if os.getenv('REQUEST_METHOD')=='GET' then response('200 OK',status());return end
 if os.getenv('REQUEST_METHOD')~='POST' then response('405 Method Not Allowed',nil,'不支持此操作');return end
 local length=tonumber(os.getenv('CONTENT_LENGTH')) or 0;if length<1 or length>16384 then response('400 Bad Request',nil,'请求大小无效');return end
 local body=json.parse(io.read(length));if type(body)~='table' then response('400 Bad Request',nil,'请求格式错误');return end
 local ok,value=lock(function()
  local c=config();local s=migrate(load(base..'/state.json',{seen={},pending={},history={}}),c)
  local ch=nil;local index=nil
  for i,v in ipairs(c.channels)do if v.id==body.id then ch=v;index=i end end
  if body.action=='save_channel' then
   if body.id and not ch then error('channel')end
   if not ch then
    assert(#c.channels<12,'limit');ch={id='ch-'..command('cat /proc/sys/kernel/random/uuid'):gsub('%s',''),enabled=false,token=''};c.channels[#c.channels+1]=ch
   else
    assert(not ch.enabled,'disable_first')
    assert(channel_pending(s,ch.id)==0,'pending')
   end
   ch.name=body.name;ch.url=body.url;ch.format=body.format or 'json';ch.form_fields=body.form_fields or '';ch.sender_filter=body.sender_filter or '';ch.keyword_filter=body.keyword_filter or ''
   if body.token~=nil then ch.token=body.token end
   validate(ch)
  elseif body.action=='channel_enable' then
   assert(ch and type(body.enabled)=='boolean','channel');ch.enabled=body.enabled
  elseif body.action=='discard_pending' then
   assert(ch and not ch.enabled and body.confirm==true,'confirm')
   for id,item in pairs(s.pending)do
    if item.deliveries[ch.id]then
     item.deliveries[ch.id]=nil;log(s,id,ch,false,0,'cancelled')
     if not next(item.deliveries)then s.pending[id]=nil end
    end
   end
  elseif body.action=='remove_channel' then
   assert(ch and not ch.enabled,'disable_first');assert(channel_pending(s,ch.id)==0,'pending');table.remove(c.channels,index)
  elseif body.action=='enable' then
   assert(type(body.enabled)=='boolean','enabled');assert(#c.channels>0 or not body.enabled,'config')
   if body.enabled and not c.enabled then
    local fresh=baseline();s.seen=fresh.seen -- Preserve queues, history and cleanup statistics.
   end
   c.enabled=body.enabled
  elseif body.action=='cleanup' then
   assert(type(body.enabled)=='boolean','cleanup');c.cleanup_enabled=body.enabled
  elseif body.action=='test' then
   assert(ch,'channel')
   local sent,code,reason=deliver(ch,{event='sms.test',event_id='test-'..os.time(),device='U60 Pro',sender='TEST',content='短信转发连接测试（非真实短信）',received_at=os.date('%Y-%m-%d %H:%M:%S')})
   return {test_ok=sent,http_status=code,reason=reason}
  else error('action')end
  save(base..'/config.json',c);save(base..'/state.json',s)
  return status()
 end)
 if not ok then response(value=='busy' and '409 Conflict' or '400 Bad Request',nil,value=='busy' and '转发任务正忙，请稍后再试' or '操作失败：请检查配置；编辑或移除前先停用该通道，并处理其待发送消息（最多 12 路）') else response('200 OK',value) end
end
if arg[1]=='worker' then
 while true do lock(tick);nixio.nanosleep(5) end
elseif arg[1]=='cgi' then cgi()
elseif arg[1]=='tick' then assert(lock(tick))
elseif arg[1]=='selftest' then assert(formbody('key=x&x\nmsg={{content}}',{content='你好 &+=\n'})=='key=x%26x&msg=%E4%BD%A0%E5%A5%BD%20%26%2B%3D%0A');assert(decode('4F60597D')=='你好');assert(sender('106900001234')=='106900001234');assert(decode('D83DDE00')=='😀');print('unicode and sender tests passed')
end

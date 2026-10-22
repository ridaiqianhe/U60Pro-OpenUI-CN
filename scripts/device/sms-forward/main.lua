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
local function log(s,id,ok,status)
 table.insert(s.history,1,{event_id=id,time=os.time(),ok=ok,status=status})
 while #s.history>20 do table.remove(s.history) end
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
 local status=command('curl --silent --connect-timeout 5 --max-time 15 --proto "=http,https" --config '..base..'/curl.conf --header '..quote('Content-Type: '..content_type)..' --data-binary @'..base..'/request.json --output /dev/null --write-out "%{http_code}" 2>/dev/null')
 os.remove(base..'/request.json');os.remove(base..'/curl.conf')
 local n=tonumber(status) or 0;return n>=200 and n<300,n
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
local function tick()
 local c=load(base..'/config.json',{});if not c.enabled and not c.cleanup_enabled then return end
 local s=load(base..'/state.json',nil)
 if not s then
  s=c.enabled and baseline() or {seen={},pending={},history={}}
  save(base..'/state.json',s)
 end
 if c.enabled then
  for _,m in ipairs(messages()) do
   if tonumber(m.tag)==0 or tonumber(m.tag)==1 then
    local id=fingerprint(m)
    if not s.seen[id] then
     s.seen[id]=true;local from=sender(m.number);local content=decode(m.content)
     if (not c.sender_filter or c.sender_filter=='' or from:find(c.sender_filter,1,true)) and (not c.keyword_filter or c.keyword_filter=='' or content:find(c.keyword_filter,1,true)) then
      s.pending[id]={payload={event='sms.received',event_id=id,device='U60 Pro',sender=from,content=content,received_at=m.date},attempts=0,next_try=0}
     end
    end
   end
  end
  save(base..'/state.json',s)
  local sent=0
  for id,item in pairs(s.pending) do
   if item.next_try<=os.time() and sent<4 then
    sent=sent+1;local ok,status=deliver(c,item.payload);log(s,id,ok,status)
    if ok then s.pending[id]=nil else item.attempts=item.attempts+1;item.next_try=os.time()+math.min(900,15*2^math.min(item.attempts,6)) end
    save(base..'/state.json',s)
   end
  end
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
local function status()
 local c=load(base..'/config.json',{});local s=load(base..'/state.json',{pending={},history={}});local pending=0;for _ in pairs(s.pending or {}) do pending=pending+1 end
 return {cleanup_enabled=c.cleanup_enabled==true,cleanup_threshold=50,cleaned_total=s.cleaned_total or 0,cleanup_error=s.cleanup_error,enabled=c.enabled==true,format=c.format or 'json',form_fields=c.form_fields or '',url=c.url or '',token_configured=c.token and c.token~='' or false,sender_filter=c.sender_filter or '',keyword_filter=c.keyword_filter or '',pending=pending,history=s.history or {}}
end
local function cgi()
 local auth=os.getenv('HTTP_AUTHORIZATION') or ''
 if not auth:match('^Bearer [%w_%.%-]+$') or command('curl --silent --connect-timeout 2 --max-time 5 --output /dev/null --write-out "%{http_code}" -H '..quote('Authorization: '..auth)..' http://192.168.0.1:9090/api/device 2>/dev/null')~='200' then response('401 Unauthorized',nil,'Unauthorized');return end
 if os.getenv('REQUEST_METHOD')=='GET' then response('200 OK',status());return end
 if os.getenv('REQUEST_METHOD')~='POST' then response('405 Method Not Allowed',nil,'不支持此操作');return end
 local length=tonumber(os.getenv('CONTENT_LENGTH')) or 0;if length<1 or length>16384 then response('400 Bad Request',nil,'请求大小无效');return end
 local body=json.parse(io.read(length));if type(body)~='table' then response('400 Bad Request',nil,'请求格式错误');return end
 local ok,value=lock(function()
  local c=load(base..'/config.json',{})
  if body.action=='save' then
   if type(body.url)~='string' or not body.url:match('^https?://[^%s]+$') or #body.url>4096 then error('url') end
   if c.enabled and body.url~=c.url then error('disable_first') end
   c.url=body.url
   if body.token~=nil then if type(body.token)~='string' or body.token:find('[\r\n]') or #body.token>2048 then error('token') end;c.token=body.token end
   c.sender_filter=tostring(body.sender_filter or ''):sub(1,128);c.keyword_filter=tostring(body.keyword_filter or ''):sub(1,256)
   if body.format~=nil then assert(body.format=='json' or body.format=='form','format');c.format=body.format end
   if body.form_fields~=nil then assert(type(body.form_fields)=='string' and #body.form_fields<=8192,'fields');c.form_fields=body.form_fields end
   if c.format=='form' then formbody(c.form_fields or '',{}) end
   save(base..'/config.json',c)
  elseif body.action=='enable' then
   if type(body.enabled)~='boolean' or not c.url then error('config') end
   if body.enabled and not c.enabled then local fresh=baseline();local old=load(base..'/state.json',nil);if old then fresh.pending=old.pending or {};fresh.history=old.history or {} end;save(base..'/state.json',fresh) end
   c.enabled=body.enabled;save(base..'/config.json',c)
  elseif body.action=='cleanup' then
   assert(type(body.enabled)=='boolean','cleanup');c.cleanup_enabled=body.enabled;save(base..'/config.json',c)
  elseif body.action=='test' then
   if not c.url then error('config') end
   local sent,code=deliver(c,{event='sms.test',event_id='test-'..os.time(),device='U60 Pro',sender='TEST',content='短信转发连接测试（非真实短信）',received_at=os.date('%Y-%m-%d %H:%M:%S')})
   return {test_ok=sent,http_status=code}
  else error('action') end
  return status()
 end)
 if not ok then response(value=='busy' and '409 Conflict' or '400 Bad Request',nil,value=='busy' and '转发任务正忙，请稍后再试' or '操作失败，请先保存有效地址；替换地址前请关闭转发') else response('200 OK',value) end
end
if arg[1]=='worker' then
 while true do lock(tick);nixio.nanosleep(5) end
elseif arg[1]=='cgi' then cgi()
elseif arg[1]=='selftest' then assert(formbody('key=x&x\nmsg={{content}}',{content='你好 &+=\n'})=='key=x%26x&msg=%E4%BD%A0%E5%A5%BD%20%26%2B%3D%0A');assert(decode('4F60597D')=='你好');assert(sender('106900001234')=='106900001234');assert(decode('D83DDE00')=='😀');print('unicode and sender tests passed')
end

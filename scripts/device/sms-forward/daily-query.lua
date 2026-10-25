-- Device-local daily LLCX query. Reuses the forwarding worker, with no new boot hook.
local json = require('luci.jsonc')
local nixio = require('nixio')
local M = {}
local function read(path)
 local f=io.open(path,'r');if not f then return nil end
 local raw=f:read('*a');f:close();return json.parse(raw) or {status='unreadable'}
end
local function save(path,value)
 local f=assert(io.open(path..'.new','w'));assert(f:write(json.stringify(value)));assert(f:flush());f:close()
 assert(os.rename(path..'.new',path))
end
local function quote(s) return "'"..s:gsub("'","'\\''").."'" end
local function call(method,payload)
 local p=assert(io.popen('ubus call zwrt_wms '..method..' '..quote(json.stringify(payload))..' 2>/dev/null','r'))
 local raw=p:read('*a');local ok=p:close();if not ok then error('ubus unavailable') end
 return assert(json.parse(raw),'invalid ubus response')
end
function M.tick(env)
 env=env or {}
 local base=env.base or '/data/plugins/sms-forward'
 local get=env.read or read;local put=env.save or save
 local config=get(base..'/daily-query.json')
 if not config or config.enabled~=true then return 'disabled' end
 -- Stock firmware labels its NITZ local wall clock as UTC. Do not add another 8h.
 -- The configured clock mode is explicit so genuine UTC clocks can use HK conversion.
 local now=env.now or os.time()
 local date=env.date or os.date
 local wall=config.clock_mode=='utc' and date('!*t',now+8*3600) or date('*t',now)
 if wall.year<2026 or wall.hour<6 then return 'not_due' end
 local day=string.format('%04d-%02d-%02d',wall.year,wall.month,wall.day)
 local path=base..'/llcx-'..day..'.json'
 if get(path) then return 'already_attempted' end
 local acquire=env.acquire or function(p)return os.execute('mkdir '..quote(p)..' 2>/dev/null')==0 end
 local release=env.release or function(p)os.execute('rmdir '..quote(p)..' 2>/dev/null')end
 if not acquire(path..'.lock') then return 'locked' end
 local ok,result=pcall(function()
  if get(path) then return 'already_attempted' end
  local ubus=env.call or call
  if tonumber(ubus('zwrt_wms_get_cmd_status',{sms_cmd=1}).sms_cmd_status_result)~=3 then return 'not_ready' end
  local record={date=day,recipient='10086',message='LLCX',status='pending'}
  -- Persist BEFORE handing anything to WMS; uncertain attempts are never resent.
  put(path,record)
  local stamp=string.format('%02d;%02d;%02d;%02d;%02d;%02d;+8',wall.year%100,wall.month,wall.day,wall.hour,wall.min,wall.sec)
  ubus('zte_libwms_send_sms',{number='10086',sms_time=stamp,message_body='004C004C00430058',id='-1',encode_type='GSM7_default'})
  for _=1,20 do
   (env.sleep or function() nixio.nanosleep(0,500000000) end)()
   local status=tonumber(ubus('zwrt_wms_get_cmd_status',{sms_cmd=4}).sms_cmd_status_result)
   if status==3 then record.status='success';put(path,record);return 'success' end
   if status==2 then record.status='failed';put(path,record);return 'failed' end
  end
  record.status='uncertain';put(path,record);return 'uncertain'
 end)
 release(path..'.lock')
 if not ok then return 'uncertain' end
 return result
end
return M

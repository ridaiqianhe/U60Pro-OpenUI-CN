local json=require('luci.jsonc')
local base='/data/plugins/tailscale'
local cfgmod=dofile(base..'/config.lua')
local M={}
local function quote(s)return "'"..tostring(s):gsub("'","'\\''").."'"end
local function command(s)local p=assert(io.popen(s,'r'));local value=p:read('*a');local ok=p:close();return value,ok end
local function read(path)local f=io.open(path);if not f then return nil end;local v=f:read('*a');f:close();return v end
local function settings()
 local raw=read(base..'/config.json');return raw and cfgmod.validate(assert(json.parse(raw)))or {hostname='u60pro',control_url=''}
end
local function save(path,value)local f=assert(io.open(path..'.new','w'));assert(f:write(json.stringify(value)));assert(f:flush());f:close();assert(os.rename(path..'.new',path))end
local function cli(args,limit)return command('sh '..base..'/run-bounded.sh '..tostring(limit or 5)..' '..base..'/tailscale --socket=/var/run/u60-tailscaled.sock '..args..' 2>/dev/null')end
local function owned()
 local pid=(read('/var/run/u60-tailscaled.pid')or ''):match('^(%d+)%s*$');if not pid then return false end
 local exe=command('readlink /proc/'..pid..'/exe 2>/dev/null');return exe:gsub('%s+$','')==base..'/tailscaled'
end
local function auth_url(value)
 if type(value)~='string' or #value>2048 or value:find('[%s<>"\']')then return nil end
 local c=settings();local origin=c.control_url~='' and c.control_url:match('^(https://[^/]+)')or 'https://login.tailscale.com'
 if value:sub(1,#origin+1)==origin..'/'then return value end
 return nil
end
function M.status()
 local c=settings();local installed=os.execute('test -x '..base..'/tailscale -a -x '..base..'/tailscaled')==0
 local d={};local running=owned()
 if installed and running then local raw=cli('status --json');d=json.parse(raw)or{}end
 local peers=0;for _ in pairs(d.Peer or {})do peers=peers+1 end
 local addresses={};for _,v in ipairs(d.TailscaleIPs or {})do if type(v)=='string' and v:match('^[%x%.:]+$')then addresses[#addresses+1]=v end end
 return {installed=installed,running=running,autostart=read(base..'/autostart')~=nil,version=(read(base..'/version')or ''):gsub('%s+$',''),hostname=c.hostname,control_url=c.control_url,backend_state=d.BackendState or (running and 'Starting'or 'Stopped'),online=d.Self and d.Self.Online==true or false,addresses=addresses,peer_count=peers,dns_name=d.Self and d.Self.DNSName or '',login_url=auth_url(d.AuthURL),health=d.Health or {}}
end
function M.connect()
 local c=settings();local args='up --accept-dns=false --accept-routes=false --netfilter-mode=off --ssh=false --exit-node= --advertise-routes= --hostname='..quote(c.hostname)..' --timeout=90s'
 args=args..' --login-server='..quote(c.control_url~='' and c.control_url or 'https://controlplane.tailscale.com')
 local _,ok=cli(args,95)
 -- The caller synchronizes management rules; no login URL is written to logs.
 return ok
end
local function response(code,data,err)io.write('Status: '..code..'\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n'..json.stringify({ok=not err,data=data,error=err}))end
function M.cgi()
 local auth=os.getenv('HTTP_AUTHORIZATION')or ''
 if not auth:match('^Bearer [%w_%.%-]+$')then response('401 Unauthorized',nil,'Unauthorized');return end
 local code=command('curl -s --connect-timeout 2 --max-time 5 -o /dev/null -w "%{http_code}" -H '..quote('Authorization: '..auth)..' http://192.168.0.1:9090/api/device 2>/dev/null')
 if code~='200'then response('401 Unauthorized',nil,'Unauthorized');return end
 local method=os.getenv('REQUEST_METHOD')
 if method=='GET'then local ok,data=pcall(M.status);response(ok and '200 OK'or '503 Service Unavailable',ok and data or nil,not ok and '无法读取 Tailscale 状态'or nil);return end
 local length=tonumber(os.getenv('CONTENT_LENGTH'))or 0
 if method~='POST'or length<1 or length>2048 then response('400 Bad Request',nil,'请求无效');return end
 local b=json.parse(io.read(length))or{}
 if os.execute('mkdir '..base..'/.lock 2>/dev/null')~=0 then response('409 Conflict',nil,'Tailscale 正在处理其他请求');return end
 local ok,result=pcall(function()
  if b.action=='save'then
   assert(not owned(),'请先停止 Tailscale 再修改配置')
   local c=cfgmod.validate({hostname=b.hostname,control_url=b.control_url});save(base..'/config.json',c)
  elseif b.action=='autostart'then
   assert(type(b.enabled)=='boolean','开机开关无效')
   if b.enabled then assert(os.execute('test -x '..base..'/tailscaled')==0,'尚未安装核心');local f=assert(io.open(base..'/autostart','w'));f:close()else os.remove(base..'/autostart')end
  elseif b.action=='start'then
   assert(os.execute('test -x '..base..'/tailscaled')==0,'尚未安装核心')
   os.execute('nohup sh '..base..'/service.sh connect > /dev/null 2>&1 < /dev/null &')
  elseif b.action=='stop'or b.action=='logout'or b.action=='sync'then
   local _,done=command('sh '..base..'/run-bounded.sh 15 sh '..base..'/service.sh '..b.action..' 2>/dev/null');assert(done,'操作失败，请检查设备状态')
  else error('不支持的操作')end
  return M.status()
 end)
 os.execute('rmdir '..base..'/.lock 2>/dev/null')
 response(ok and '200 OK'or '400 Bad Request',ok and result or nil,not ok and '操作未完成：请检查核心是否安装；修改配置前请停止连接'or nil)
end
if arg and arg[1]=='cgi'then M.cgi()elseif arg and arg[1]=='connect'then M.connect()elseif arg and arg[1]=='inspect'then io.write(json.stringify({installed=M.status().installed})..'\n')end
return M

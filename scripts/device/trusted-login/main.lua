local json=require('luci.jsonc')
local function respond(code,data,err)
 io.write('Status: '..code..'\r\nContent-Type: application/json\r\nCache-Control: no-store, private\r\nPragma: no-cache\r\nReferrer-Policy: no-referrer\r\n\r\n'..json.stringify(err and {ok=false,error=err} or {ok=true,data=data})..'\n')
end
local function trusted(ip)
 local last=tostring(ip or ''):match('^10%.13%.13%.(%d+)$')
 return last~=nil and tonumber(last)<=255 and tostring(tonumber(last))==last
end
if arg[1]=='selftest'then
 for _,ip in ipairs({'10.13.13.0','10.13.13.1','10.13.13.254','10.13.13.255'})do assert(trusted(ip))end
 for _,ip in ipairs({'10.13.12.1','10.13.14.1','192.168.0.1','127.0.0.1','10.13.13.256','10.13.13.01','10.13.13.1.evil','10.13.13.1, 1.2.3.4','::1',''})do assert(not trusted(ip))end
 print('trusted source boundary checks passed');return
end
-- REMOTE_ADDR is set by uhttpd from the TCP peer. Never trust X-Forwarded-For.
if not trusted(os.getenv('REMOTE_ADDR'))then respond('403 Forbidden',nil,'此来源需要密码登录');return end
if os.getenv('REQUEST_METHOD')~='POST'then respond('405 Method Not Allowed',nil,'POST required');return end
local origin=os.getenv('HTTP_ORIGIN')or ''
local address=os.getenv('SERVER_ADDR')or ''
local port=os.getenv('SERVER_PORT')or ''
local content_type=(os.getenv('CONTENT_TYPE')or ''):match('^([^;]+)')
if content_type~='application/json' or origin~='http://'..address..':'..port then respond('403 Forbidden',nil,'Same-origin request required');return end
local f=io.open('/data/plugins/trusted-login/credentials.json')
if not f then respond('503 Service Unavailable',nil,'自动登录未配置');return end
local credentials=json.parse(f:read(4096));f:close()
if type(credentials)~='table' or type(credentials.password)~='string'then respond('503 Service Unavailable',nil,'自动登录未配置');return end
local p=io.popen('mktemp -d /tmp/u60-trusted-login.XXXXXX');local work=p:read('*l');p:close()
if not work or not work:match('^/tmp/u60%-trusted%-login%.[%w]+$')then respond('503 Service Unavailable',nil,'自动登录暂不可用');return end
f=assert(io.open(work..'/request.json','w'));f:write(json.stringify({password=credentials.password}));f:close()
p=io.popen('curl --silent --connect-timeout 1 --max-time 4 --max-filesize 16384 -H "Content-Type: application/json" --data-binary @'..work..'/request.json http://192.168.0.1:9090/api/auth/login 2>/dev/null')
local result=json.parse(p:read('*a'));p:close();os.remove(work..'/request.json');os.execute('rmdir '..work)
if type(result)=='table' and result.ok==true and type(result.data)=='table' and type(result.data.token)=='string'and result.data.token:match('^[%w_%.%-]+$')then respond('200 OK',{token=result.data.token})
else respond('503 Service Unavailable',nil,'自动登录失败，请使用密码登录')end

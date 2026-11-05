-- Isolated Lua 5.1 regression suite. No real HTTP, daemon, firewall or filesystem writes.
local cfg=dofile(assert(arg[1]))
local file=assert(io.open(assert(arg[2])));local source=file:read('*a');file:close()
local failed=0
local function test(name,fn)
 local ok,err=pcall(fn)
 if ok then print('PASS '..name)else failed=failed+1;print('FAIL '..name..': '..tostring(err))end
end
local function valid(host,url)return pcall(cfg.validate,{hostname=host,control_url=url})end
test('valid hostname and HTTPS control origin',function()
 assert(valid('u60pro',''));assert(valid('office-u60','https://headscale.example.com:8443/'))
 assert(cfg.validate({hostname='u60pro',control_url='https://headscale.example.com/'}).control_url=='https://headscale.example.com')
end)
test('hostnames reject scripts, control characters and invalid labels',function()
 for _,host in ipairs({'','-first','last-','UPPER','a_b','a.b','$(touch /tmp/x)','x; reboot','a\nb',string.rep('x',64)})do assert(not valid(host,''),host)end
 assert(not pcall(cfg.validate,{hostname='u60pro',post_up='shell'}))
end)
test('control origin rejects HTTP, credentials, paths, scripts and invalid ports',function()
 for _,url in ipairs({'http://example.com','javascript:alert(1)','https://user:password@example.com','https://example.com/path','https://example.com?token=x','https://example.com/#x','https://example.com/;touch /tmp/x','https://example.com:0','https://example.com:65536','https://localhost','https://example.com\n'})do assert(not valid('u60pro',url),url)end
end)
test('control origin rejects malformed DNS labels',function()
 for _,url in ipairs({'https://a..example.com','https://.example.com','https://a-.example.com','https://example-.com','https://-a.example.com'})do assert(not valid('u60pro',url),url)end
end)

local function sandbox(options)
 options=options or {};local calls,writes,read_requests,output={},0,0,{}
 local response
 local files={}
 if options.owned then files['/var/run/u60-tailscaled.pid']='123\n'end
 if options.config then files['/data/plugins/tailscale/config.json']='CONFIG'end
 local json={parse=function(raw)
  if raw=='REQUEST'then return options.body or{}elseif raw=='CONFIG'then return options.config elseif raw=='STATUS'then return options.status or{}end
 end,stringify=function(value)response=value;return 'SERIALIZED'end}
 local fakeio={}
 function fakeio.open(path,mode)
  if mode=='w'then
   writes=writes+1
   return {write=function()return true end,flush=function()return true end,close=function()return true end}
  end
  if files[path]then return {read=function()return files[path]end,close=function()end}end
 end
 function fakeio.read()read_requests=read_requests+1;return 'REQUEST'end
 function fakeio.write(...)for i=1,select('#',...)do output[#output+1]=tostring(select(i,...))end end
 function fakeio.popen(command)
  calls[#calls+1]=command
  local value='';local ok=true
  if command:match('^curl ')then value=options.auth_code or'200'
  elseif command:match('^readlink ')then value='/data/plugins/tailscale/tailscaled\n'
  elseif command:find('status %-%-json')then value='STATUS'
  end
  return {read=function()return value end,close=function()return ok end}
 end
 local fakeos={}
 function fakeos.getenv(name)
  local vars={HTTP_AUTHORIZATION=options.token,REQUEST_METHOD=options.method or'GET',CONTENT_LENGTH='7'}
  return vars[name]
 end
 function fakeos.execute(command)
  calls[#calls+1]=command
  if command:match('^test %-x ')then return options.installed and 0 or 1 end
  return 0
 end
 function fakeos.rename()writes=writes+1;return true end
 function fakeos.remove()writes=writes+1;return true end
 local env=setmetatable({io=fakeio,os=fakeos,arg={},require=function(name)assert(name=='luci.jsonc');return json end,dofile=function(path)assert(path=='/data/plugins/tailscale/config.lua');return cfg end},{__index=_G})
 local chunk=assert(loadstring(source));setfenv(chunk,env);local module=chunk()
 module.cgi()
 return {data=response,output=table.concat(output),calls=calls,writes=writes,reads=read_requests}
end

test('missing token performs no request body read or write commands',function()
 local r=sandbox({method='POST',body={action='start'}})
 assert(r.output:find('401 Unauthorized',1,true));assert(#r.calls==0 and r.writes==0 and r.reads==0)
end)
test('malformed token performs no command or write',function()
 for _,token in ipairs({'Basic xyz','Bearer ok\nInjected: x','Bearer $(touch /tmp/x)'})do
  local r=sandbox({method='POST',token=token,body={action='stop'}})
  assert(r.output:find('401 Unauthorized',1,true));assert(#r.calls==0 and r.writes==0 and r.reads==0)
 end
end)
test('invalid token can only validate against agent, never mutate',function()
 local r=sandbox({method='POST',token='Bearer synthetic-token',auth_code='401',body={action='stop'}})
 assert(r.output:find('401 Unauthorized',1,true));assert(#r.calls==1 and r.calls[1]:match('^curl '));assert(r.writes==0 and r.reads==0)
end)
test('missing core truthfully reports not installed and stopped',function()
 local r=sandbox({token='Bearer synthetic-token'})
 assert(r.output:find('200 OK',1,true));assert(r.data.ok and r.data.data.installed==false and r.data.data.running==false)
 assert(r.data.data.backend_state=='Stopped'and r.writes==0)
 for _,call in ipairs(r.calls)do assert(not call:find('status %-%-json'))end
end)
test('missing core cannot start or enable autostart',function()
 for _,body in ipairs({{action='start'},{action='autostart',enabled=true}})do
  local r=sandbox({method='POST',token='Bearer synthetic-token',body=body})
  assert(r.output:find('400 Bad Request',1,true));assert(r.writes==0)
  for _,call in ipairs(r.calls)do assert(not call:match('^nohup '))end
 end
end)
test('unknown action never interpolates a shell command',function()
 local r=sandbox({method='POST',token='Bearer synthetic-token',body={action='stop; touch /tmp/pwn'}})
 assert(r.output:find('400 Bad Request',1,true));assert(r.writes==0)
 for _,call in ipairs(r.calls)do assert(not call:find('touch',1,true))end
end)
test('invalid configuration cannot write files',function()
 local r=sandbox({method='POST',token='Bearer synthetic-token',body={action='save',hostname='x; reboot',control_url=''}})
 assert(r.output:find('400 Bad Request',1,true));assert(r.writes==0)
end)
test('authorization URL accepts only the expected Tailscale origin',function()
 for _,url in ipairs({'https://login.tailscale.com/a/synthetic','https://login.tailscale.com/admin/authorize/synthetic'})do
  local r=sandbox({token='Bearer synthetic-token',installed=true,owned=true,status={AuthURL=url}})
  assert(r.data.data.login_url==url,url)
 end
 for _,url in ipairs({'http://login.tailscale.com/a/x','https://login.tailscale.com.evil.example/a/x','https://login.tailscale.com@evil.example/a/x','javascript:alert(1)','https://login.tailscale.com/a/"x','https://login.tailscale.com/a/x\n'})do
  local r=sandbox({token='Bearer synthetic-token',installed=true,owned=true,status={AuthURL=url}})
  assert(r.data.data.login_url==nil,url)
 end
end)
test('custom control origin cannot supply an unrelated authorization URL',function()
 local config={hostname='u60pro',control_url='https://headscale.example.com:8443'}
 local good='https://headscale.example.com:8443/register/synthetic'
 local r=sandbox({token='Bearer synthetic-token',installed=true,owned=true,config=config,status={AuthURL=good}})
 assert(r.data.data.login_url==good)
 for _,bad in ipairs({'https://headscale.example.com/register/x','https://headscale.example.com:8443.evil.example/a/x','https://login.tailscale.com/a/x'})do
  r=sandbox({token='Bearer synthetic-token',installed=true,owned=true,config=config,status={AuthURL=bad}})
  assert(r.data.data.login_url==nil,bad)
 end
end)
assert(failed==0,tostring(failed)..' Tailscale isolated regression(s) failed')

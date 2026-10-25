-- Isolated simulation: no real SMS, filesystem writes, or clock changes.
local M=dofile(assert(arg[1]))
local files,calls,ready,send_status,crash,locks={},0,3,3,false,{}
local wall={year=2026,month=10,day=24,hour=5,min=59,sec=59}
local env={base='/synthetic',now=1,read=function(p)return files[p]end,save=function(p,v)
 local copy={};for k,x in pairs(v)do copy[k]=x end;files[p]=copy
end,date=function()return wall end,acquire=function(p)if locks[p]then return false end;locks[p]=true;return true end,release=function(p)locks[p]=nil end,sleep=function()end,call=function(method,payload)
 if method=='zte_libwms_send_sms' then
  calls=calls+1;assert(payload.number=='10086' and payload.message_body=='004C004C00430058')
  assert(files['/synthetic/llcx-2026-10-'..wall.day..'.json'].status=='pending')
  if crash then error('lost reply') end
  return {}
 end
 return {sms_cmd_status_result=payload.sms_cmd==1 and ready or send_status}
end}
assert(M.tick(env)=='disabled')
files['/synthetic/daily-query.json']={enabled=true,clock_mode='firmware-local-hk'}
assert(M.tick(env)=='not_due' and calls==0)
wall.hour=6;assert(M.tick(env)=='success' and calls==1)
assert(M.tick(env)=='already_attempted' and calls==1)
wall.day=25;ready=0;assert(M.tick(env)=='not_ready' and calls==1)
ready=3;assert(M.tick(env)=='success' and calls==2)
wall.day=26;crash=true;assert(M.tick(env)=='uncertain' and calls==3)
assert(M.tick(env)=='already_attempted' and calls==3)
wall.day=27;crash=false;send_status=2;assert(M.tick(env)=='failed' and calls==4)
assert(M.tick(env)=='already_attempted' and calls==4)
wall.day=28;send_status=1;assert(M.tick(env)=='uncertain' and calls==5)
assert(M.tick(env)=='already_attempted' and calls==5)
wall.day=29;files['/synthetic/llcx-2026-10-29.json']={status='success'}
assert(M.tick(env)=='already_attempted' and calls==5) -- existing desktop ledger
wall.day=30;locks['/synthetic/llcx-2026-10-30.json.lock']=true
assert(M.tick(env)=='locked' and calls==5)
wall.year=1970;assert(M.tick(env)=='not_due' and calls==5)
print('Daily query simulations passed: timing, dedup, existing ledger, readiness, failure, lost reply, timeout and lock')

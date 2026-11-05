local M={}
function M.validate(body)
 assert(type(body)=='table','配置格式无效')
 for key in pairs(body)do assert(key=='hostname' or key=='control_url','未知配置项')end
 local hostname=body.hostname
 assert(type(hostname)=='string' and #hostname>=1 and #hostname<=63 and hostname:match('^[a-z0-9][a-z0-9%-]*$') and not hostname:match('%-$'),'设备名称仅支持小写字母、数字和中划线，最长 63 位')
 local url=body.control_url or ''
 assert(type(url)=='string' and #url<=255,'控制服务器地址无效')
 if url~='' then
  local host,rest=url:match('^https://([%w%.%-]+)(.*)$')
  assert(host and host:find('%.') and not host:match('^%-') and (rest=='' or rest=='/' or rest:match('^:%d+/?$')),'控制服务器需为 HTTPS 域名，可选端口；不支持账户、参数或脚本')
  assert(not host:find('..',1,true) and not host:match('^%.') and not host:match('%.$'),'控制服务器域名格式无效')
  for label in host:gmatch('[^%.]+')do assert(#label<=63 and label:match('^[%w]') and label:match('[%w]$'),'控制服务器域名格式无效')end
  if rest:sub(1,1)==':'then local port=tonumber(rest:match('^:(%d+)'));assert(port and port>=1 and port<=65535,'控制服务器端口无效')end
 end
 return {hostname=hostname,control_url=url:gsub('/$','')}
end
return M

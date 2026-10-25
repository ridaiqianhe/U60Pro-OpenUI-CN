local M={}
local units={B=1,KB=1024,MB=1024^2,GB=1024^3,TB=1024^4}
local function quantity(s,prefix)
 local n,u=s:match(prefix..':?([%d%.]+)([KMGT]?B)')
 n=tonumber(n);if not n or not units[u]then return nil end
 return math.floor(n*units[u]+0.5)
end
function M.parse(text)
 local s=text:upper():gsub('%s',''):gsub('，',','):gsub('：',':')
 -- Only accept an explicitly aggregated nationwide/general allowance. Do not sum packs.
 local _,finish=s:find('本月国内通用流量',1,true)
 if not finish then _,finish=s:find('本月全国通用流量',1,true)end
 local segment=finish and s:sub(finish+1)
 if segment then local stop=segment:find('。',1,true);if stop then segment=segment:sub(1,stop-1)end end
 if not segment then return nil,'短信未提供明确的本月国内通用流量汇总' end
 if segment:find('定向',1,true)or segment:find('省内',1,true)or segment:find('共享',1,true)then return nil,'流量包口径不明确' end
 local _,count=segment:gsub('剩余','');if count>1 then return nil,'出现多个剩余流量值，需要人工确认' end
 local total=quantity(segment,'共') or quantity(segment,'总量')
 local remaining=quantity(segment,'剩余')
 local used=quantity(segment,'已用') or quantity(segment,'已使用')
 if not total and used and remaining then total=used+remaining end
 if not remaining and total and used then remaining=total-used end
 if not total or not remaining or total<=0 or remaining<0 or remaining>total or total>1024^5 then return nil,'无法可靠识别总量和剩余流量' end
 if used and math.abs(used+remaining-total)>0.03*1024^3 then return nil,'短信中的总量、已用和剩余不一致' end
 return {total_bytes=total,remaining_bytes=remaining,used_bytes=total-remaining}
end
return M

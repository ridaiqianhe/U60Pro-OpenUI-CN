local p=dofile(assert(arg[1]))
local r=assert(p.parse('【流量查询】您本月国内通用流量共100GB，剩余80GB。详情…'))
assert(r.total_bytes==100*1024^3 and r.used_bytes==20*1024^3)
r=assert(p.parse('本月全国通用流量总量:1024MB,已使用:24MB,剩余:1000MB。'))
assert(r.used_bytes==24*1024^2)
r=assert(p.parse('本月国内通用流量共10GB，剩余0GB。'));assert(r.used_bytes==r.total_bytes)
for _,s in ipairs({'剩余流量80GB','国内定向流量共100GB剩余80GB','本月国内通用流量共10GB，剩余11GB。','本月国内通用流量共100GB，已用60GB，剩余80GB。','本月国内通用流量共100GB，剩余80GB，另有定向10GB。','本月国内通用流量共100GB，剩余80GB，剩余20GB。'})do assert(not p.parse(s),s)end
print('Traffic SMS parser passed: aggregate, units, zero remaining, ambiguous packs and inconsistent amounts')

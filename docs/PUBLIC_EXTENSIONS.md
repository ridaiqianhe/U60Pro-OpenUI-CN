# 扩展部署说明

本项目保留上游 agent / dashboard / installer，同时提供手动配置的设备扩展源码。
运行配置必须由使用者创建，不要提交到 GitHub。

| 组件 | 源码 | 目标路径 |
|---|---|---|
| 首页指标 | `scripts/device/home-qci.cgi` | dashboard `cgi-bin/home-qci` |
| Mihomo 扩展 | `scripts/device/mihomo-*.cgi` | dashboard 对应 `cgi-bin/` 名称（去掉 `.cgi`） |
| WireGuard API | `scripts/device/wireguard.cgi` | dashboard `cgi-bin/wireguard` |
| 短信转发 API | `scripts/device/sms-forward.cgi` | dashboard `cgi-bin/sms-forward` |
| WireGuard 服务 | `wireguard-service.sh`、`wireguard-parse.awk`、`wireguard-scope.sh` | `/data/plugins/wireguard/` 下命名为 `service.sh`、`parse.awk`、`scope.sh` |
| 访客 Wi-Fi API | `scripts/device/guest-wifi.cgi`、`guest-wifi/main.lua` | `cgi-bin/guest-wifi`、`/data/plugins/guest-wifi/main.lua` |
| 流量查询 API | `scripts/device/traffic-query.cgi`、`traffic-query/` | `cgi-bin/traffic-query`、`/data/plugins/traffic-query/` |
| 短信转发服务 | `scripts/device/sms-forward/` | `/data/plugins/sms-forward/` |

脚本应在审查并确认依赖后安装；CGI 需可执行。私有配置目录 700、文件 600。WireGuard 需要内核支持及 `wg`、`dig`；短信服务需要 Lua、luci.jsonc、nixio、curl 和原厂 WMS ubus。Mihomo 需要自行安装核心、yq、Web 面板，并按服务脚本准备配置。

所有开机钩子只能放在 `/etc/rc.local`，更新后必须执行 `sh -n /etc/rc.local`。不要添加 init.d / procd / firewall include，也不要停止原厂启动屏障进程。

短信转发默认关闭，首次开启建立历史基线。Bark 地址、Webhook token、表单中的 key 等都是敏感数据。不要上传 `/data/plugins/` 的运行目录。每日流量查询为手动启用的可选模块；自动退订不包含在此发布版本中。

已知限制：AMBR 日志尚未按 SIM 隔离；转发历史时间可能受设备本地时钟偏移影响；Mihomo 半关闭连接可能残留。依赖数据不完整时页面显示未知，不承诺所有固件适用。

## 附近小区

信号页新增“附近小区”标签，手动触发约 35 秒采集。安装
`scripts/device/neighbor-scan/` 到 `/data/plugins/neighbor-scan`，按其中 README
安装并校验官方离线解析器；将 `neighbor-scan.cgi` 放入面板的
`cgi-bin/neighbor-scan` 并赋可执行权限。不安装 datad HTTP 服务，不添加开机钩子。
运行结果和原始诊断文件不包含在仓库，临时原始文件采集后清理。

## 多路短信转发

短信转发 schema 2 支持最多 12 路通道，独立 URL、鉴权、格式、过滤和启停。
各通道独立排队重试，成功通道不会因其他通道失败而重发。新增通道默认关闭，
只接收此后匹配的新短信。停用暂停既有队列，编辑/移除前必须处理待投递任务；
也可明确确认后仅跳过该路待投递任务。任一路尚未完成的短信受到自动清理保护。
旧单路队列仅迁移到原通道，迁移保留去重、历史及清理统计。

Bark 检查 HTTP 和 JSON code；通用 Webhook 使用 HTTP 状态，接收端仍应使用
`event_id` 幂等。部分业务接口会拒绝合成测试消息，不能据此声称真实业务已验证。
运行配置中含凭据，不属于发布源码。

隔离集成测试（只使用合成短信和本地接收器，需已授权的设备 SSH）：

```sh
python3 scripts/test-sms-multi-device.py --ssh 'ssh my-device'
```

测试会在设备临时创建 `/data/plugins/sms-multi-test`，使用反向 SSH 转发端口 18887；
测试结束删除自身目录，不读取真实短信或向真实 Webhook 发送。

## 可选 WG 自动登录

`wg-login.cgi` 与 `trusted-login/main.lua` 提供 10.13.13.0/24 来源白名单登录。
这是可选的管理权限授予，只有信任整个 WG 子网时才部署。脚本仅信任 TCP 来源
REMOTE_ADDR，不使用转发 IP 请求头；要求同源 JSON POST，无跨域放行。
面板经设备数字 IP 访问时支持自动登录，其他来源仍使用密码。

Lua 放 `/data/plugins/trusted-login/main.lua`，CGI 放 `cgi-bin/wg-login`（755）。
由管理员在该私有目录内创建 `credentials.json`，JSON 中仅保存 `password` 字段，
值为自行设置的 agent 密码；目录 700、凭据 600。密码改变后需要同步更新此文件。
未部署该模块或校验失败时，前端回到普通登录。凭据永远不要提交到仓库。


## 访客 Wi-Fi

网络 → Wi-Fi 新增访客卡片，支持 2.4/5 GHz 的名称、密码、安全模式、广播、
接入数、PMF、二维码及隔离；总开关、开放时长和局域网权限使用原厂接口。
开放时长可选不限时或 2/4/8/12/24 小时。双频合一启用时跟随原厂同步关系，
5 GHz 设置从 2.4 GHz 修改。物理频段关闭时显示原因，不强制打开主 Wi-Fi。
保存前验证参数，写入后校验，失败尝试恢复。密码不回显，留空保留原密码。
原厂 WLAN 写接口可能成功但不返回 JSON，本模块仅对明确的写方法接受空响应。
需要固件提供对应 `zwrt_wlan` / `zwrt_router.api` 方法及 hostapd_cli。

## 流量查询与原厂限流

移动网络 → 数据新增查询按钮及“自动同步原厂限制”。流量模块须与本版本
短信转发 worker 一同安装；worker 负责检查新回复，不额外添加开机服务。
手动创建 `/data/plugins/traffic-query/config.json`：

```json
{"auto_sync": true}
```

首次运行仅建立历史基线。查询中国移动发送 `LLCX` 到 10086；联通、电信分别
发送 `CXLL` 到 10010、`108` 到 10001，命令与短信格式可能因地区而异。
只有短信明确给出本月国内/全国通用总量和已用/剩余时才自动应用；并非所有运营商
回复格式均支持。多流量包或口径不明的回复不会覆盖设置。

有效回复通过原厂接口校准月已用量、设置套餐总量，并持久开启原厂到量断网。
GB 按原厂 1024³ 字节换算；不改月重置日。回读失败恢复之前的计数和限额，
不能恢复则显示状态不明，不盲目重试。关闭自动同步只停止未来写入，不取消原厂
已经启用的限额。计数受固件统计及运营商短信时效影响，不作为精确计费保证。
换卡后重新查询。详情见 [模块说明](../scripts/device/traffic-query/README.md)。

## 可选每日流量查询

`sms-forward/daily-query.lua` 由现有 worker 加载，默认无配置即停用。
需要自行创建私有 `/data/plugins/sms-forward/daily-query.json`：

```json
{"enabled": true, "clock_mode": "firmware-local-hk"}
```

仅适用于需要每日向中国移动 10086 查询 `LLCX` 的 SIM，不自动识别或切换运营商。
设备香港本地时间每天 06:00 后首次可用时发送，每日发送意图先落盘，失败或状态
不明不自动重复发送；回复由已有转发通道推送，启用流量同步时同时更新限额。
其他真正使用 UTC 时钟的设备可设 `clock_mode: "utc"`。不要复制设备运行账本或
推送配置到仓库，也不要同时运行另一套每日查询任务，以免重复查询。

## 可选 Mihomo DNS 分流

默认继续跟随订阅。启用本地覆盖前，将国内域名 MRS 规则集自行安装至
`/data/plugins/mihomo/ruleset/u60-dns-cn.mrs`，并把
`apply-mihomo-dns.sh` 安装为该目录的 `apply-dns.sh`。
在 `dns-proxy-group` 文本中填入配置中实际存在的代理组名；未填写则选首个代理组。
创建空标志 `dns-split.enabled` 后，订阅渲染才应用覆盖。

国内规则、`.cn` 及 QQ/腾讯/网易音乐使用国内直连 DNS 和真实 IP；通用 DoH
通过指定代理组，保留订阅中的专用节点解析器。覆盖会合并 fake-ip 过滤及域名
策略，并移除订阅 fallback/fallback-filter。删除标志后再次渲染恢复跟随订阅。
MRS 数据及订阅由用户自行提供，仓库不包含私人节点或运行配置。

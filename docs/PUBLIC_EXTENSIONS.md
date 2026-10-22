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
| 短信转发服务 | `scripts/device/sms-forward/` | `/data/plugins/sms-forward/` |

脚本应在审查并确认依赖后安装；CGI 需可执行。私有配置目录 700、文件 600。WireGuard 需要内核支持及 `wg`、`dig`；短信服务需要 Lua、luci.jsonc、nixio、curl 和原厂 WMS ubus。Mihomo 需要自行安装核心、yq、Web 面板，并按服务脚本准备配置。

所有开机钩子只能放在 `/etc/rc.local`，更新后必须执行 `sh -n /etc/rc.local`。不要添加 init.d / procd / firewall include，也不要停止原厂启动屏障进程。

短信转发默认关闭，首次开启建立历史基线。Bark 地址、Webhook token、表单中的 key 等都是敏感数据。不要上传 `/data/plugins/` 的运行目录。每天流量查询和自动退订不包含在此发布版本中。

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

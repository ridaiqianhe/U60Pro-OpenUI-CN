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

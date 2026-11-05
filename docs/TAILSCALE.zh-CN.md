# U60 的 Tailscale 内网接入

网络 → Tailscale 提供连接状态、节点 IP、在线节点数、网页登录授权、启停、退出账号、
设备名称和开机启动。可填写 HTTPS Headscale 控制服务器；留空使用 Tailscale 官方服务。

本扩展使用官方 ARM64 静态二进制，版本固定为 **1.104.5**，安装前校验固定 SHA-256。
不把二进制、设备状态、私有节点信息或授权链接提交到仓库。静态安装方式见
[Tailscale 官方文档](https://tailscale.com/docs/install/static)。

## 安装

需要 U60 的 root SSH，架构 aarch64、`/dev/net/tun`、Lua/luci.jsonc、curl、iptables、
ip6tables（IPv6 放行可用时）、可写 `/data`，以及已经部署的 agent 和 OpenUI。
扩展在 MU5250 **CN B31** 设备上进行了安装及未授权状态的运行验证；这不是对所有
其他固件或登录后所有网络组合的兼容保证。

在项目目录执行，SSH 命令中的地址与主机密钥配置应替换为自己的配置：

```sh
python3 scripts/install-tailscale.py \
  --ssh 'ssh -p 2222 -o UserKnownHostsFile=~/.ssh/known_hosts.d/zte root@192.168.0.1' \
  --dry-run
```

干运行只准备电脑上的组件并读取设备身份、空间和环境，不写设备。
检查通过后，移除 `--dry-run` 执行实际安装。

安装器会验证 MU5250 型号、固件、root 和 TUN；在 `/data/plugins/tailscale` 安装核心与
扩展，在当前面板 `cgi-bin/tailscale` 安装经过 agent Bearer 认证的接口，并仅在
`/etc/rc.local` 添加一条启动入口。源码不使用 init.d/procd/firewall include。
已有在线 Tailscale 或非本安装器管理的同名目录会阻止覆盖。安装不会自动加入账号，
也不会默认打开开机连接。原文件及 rc.local 快照保存在设备私有事务目录。

如果你使用自己的前端部署方式，还需把本仓库的新前端构建部署到设备；替换静态文件
时应保留已安装的 `cgi-bin`。第三方桌面安装器不会自动安装这些扩展。

## 授权与连接

1. 打开网络 → Tailscale，点击“启动连接”。
2. 出现授权按钮后，在浏览器登录你自己的账号，确认加入目标 Tailnet。
3. 返回面板点击“完成授权后刷新”。若 Tailnet 要求设备审批，先在管理端批准。
4. 获得节点 IPv4 后，在同一 Tailnet 使用 `http://节点IPv4:8080/` 访问 OpenUI，
   或 `ssh -p 2222 root@节点IPv4` 使用原有 SSH。两者仍使用原有认证。前端跨域请求允许 Tailscale 的 `100.64.0.0/10`
   地址段；需要同步部署本仓库 agent，旧 agent 会导致浏览器报 Failed to reach the agent。
5. 需要重启后自动加入时，开启“开机自动连接”。

首次授权可能需要再次点击启动，或停止后重新启动以获取过期后的授权链接。
授权链接只通过经过认证的接口返回；不要把链接粘贴到公开 Issue。
本扩展不收集账号密码或 auth key，不提供 Tailscale SSH，也不根据 Tailscale IP
自动免密码登录 OpenUI。

## 路由、DNS 与访问范围

固定使用 `--accept-dns=false`、`--accept-routes=false`、`--netfilter-mode=off`、
`--ssh=false`，清空出口节点和子网路由广播。目标是让设备本身加入内网，
不把客户端全网流量送到 Tailscale，不把 U60 当作出口或子网路由器。
控制参数依据 [Tailscale CLI 文档](https://tailscale.com/docs/reference/tailscale-cli/up)。

Tailscale 仍会建立运行所需的自身隧道和路由，能否与已有 Clash/WireGuard 并行运行，
需要在登录后根据实际路由和连接验证，不能仅凭“进程已启动”认定打洞或远程访问成功。

由于关闭自动 netfilter 管理，本扩展只在 `tailscale0` 接口放行管理 TCP
80/2222/8080/9090/9091；9090/9091 对本机 Tailscale IPv4 做窄范围 DNAT，以访问
原有 LAN 监听器。停止或退出会清理这些自有规则。不会添加 WAN 公网入口、
不会放开 LAN 转发；Tailnet 本身的访问权限还应由管理员配置。
详见 [官方 netfilter 模式说明](https://tailscale.com/docs/reference/netfilter-modes)。

管理规则会在连接、开机恢复和“完成授权后刷新”时同步。授权后如果面板能连而 API
不可达，先通过 LAN/USB 回到页面执行刷新。IPv4 是本扩展推荐的管理入口。

## 文件与恢复

- `/data/plugins/tailscale/tailscaled.state`：私有节点身份及运行状态。
- `/data/plugins/tailscale/config.json`：设备名称及控制服务器。
- `/data/plugins/tailscale/autostart`：开机连接开关。
- `/var/run/u60-tailscaled.sock`、`u60-tailscaled.pid`：本扩展的 socket/PID。
- 启动只通过 rc.local，后台连接不阻塞原厂启动流程；更改 rc.local 后检查 `sh -n`。

页面的停止不删除账号状态；退出账号调用官方 `logout`。停止/退出会断开通过该通道
建立的管理连接，操作前应有 LAN、USB 或其他已验证的管理通道。
恢复安装器快照时只恢复本扩展、CGI 和对应 rc.local，先核对当前配置，避免覆盖后续
其他插件的改动。FOTA 后重新核对 `/etc/rc.local` 与固件兼容性。

## 开发验证

```sh
lua5.1 scripts/device/tailscale/test.lua \
  scripts/device/tailscale/config.lua scripts/device/tailscale/main.lua
python3 -m unittest discover -s tests -p test_tailscale.py -v
```

Lua 测试不访问真实网络、短信或防火墙。Python 的 CGI 包装测试可使用可选的
`lupa.lua51`，未安装时由上面的 Lua 5.1 命令覆盖；其余测试校验守护进程归属。

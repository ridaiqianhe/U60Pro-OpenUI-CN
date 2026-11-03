# U60 Pro / MU5250 开启 ADB 与 SSH

本文整理本项目使用的调试入口和 SSH 部署方法。面向 **中兴 U60 Pro / MU5250**，
不是华为 H168-383 教程。配置备份/恢复方案在 HK `MU5250V1.0.0B04` 上有项目验证记录；
其他 HK/CN 固件请先核对接口与备份格式，不将同系列型号视为已兼容。

先阅读 [设备安全规则](SAFETY.md)。完整安装、回滚与离线准备见
[部署文档](DEPLOYMENT.md)。本文命令在电脑终端执行，标为“设备 shell”的部分除外。
本文不包含个人管理密码、备份解密后缀、IMEI、SSH 私钥或 WireGuard 地址。

## 1. 分清三个入口

| 入口 | 用途 | 本项目默认值 |
|---|---|---|
| 原厂 Web | 登录管理、配置备份与恢复 | `http://192.168.0.1/` |
| ADB | USB 数据线连接的调试 shell | `adb shell` |
| SSH | 局域网里的远程 shell | `root@192.168.0.1`，端口 **2222** |
| OpenUI | 中文扩展面板，安装后才有 | `http://192.168.0.1:8080/` |

如果你改过设备 LAN 地址，以下示例中的 `192.168.0.1` 都要改为实际地址。
开启 ADB 不会自动安装 SSH；能打开 OpenUI 也不代表已经开启 ADB。
本项目默认 SSH 端口不是 22。

## 2. 电脑与连接准备

1. 保持设备开机，用支持数据传输的 USB 线连接电脑。
2. 电脑连接 U60 的 Wi-Fi 或 USB 网络，确认能打开原厂 Web，并知道自己的管理密码。
3. 准备 Python 3、OpenSSL、ADB 和 Git。macOS 使用 Homebrew 时可安装：

   ```sh
   brew install python openssl android-platform-tools git
   ```

   Windows 请安装 Python 3、Git，以及 Android 官方
   [SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools)。
   配置备份脚本需要可用的 OpenSSL 命令行，或安装 Python `cryptography` 包。
   Windows 是否还需 USB 驱动取决于电脑的设备识别情况。
4. 下载本仓库源码：

   ```sh
   git clone https://github.com/ridaiqianhe/U60Pro-OpenUI-CN.git
   cd U60Pro-OpenUI-CN
   ```

本仓库当前提供源码，不要把上游安装器或上游 Release 当成本中文扩展的完整安装包。
下面的 SSH 部署还会从固定来源准备校验过的组件，需可用网络；离线方式见部署文档。

## 3. 开启 ADB：先判断固件

### HK B04 等已移除网页调试接口的固件

新固件可能没有“USB 模式”菜单，也可能直接移除了 `zwrt_bsp.usb.set`。
这时不是换个浏览器或修改页面显示就能打开 ADB。

本项目的 `scripts/zunlock.py` 使用配置备份/恢复流程：下载当前配置、在其
`etc/rc.local` 中加入启动时调试设置、校验重新打包的文件，再由用户确认恢复。
**恢复会让设备重启，并短暂断开网络。**

需要两个输入：

- 原厂 Web 的管理密码；
- 与设备平台及固件相符的备份解密后缀。脚本会读取本机设备标识，不需要在教程里填入。

后缀不随本仓库公开。来源与输入说明见
[备份密钥后缀](DEPLOYMENT.md#the-backup-key-suffix)。使用交互提示输入，避免把密码
或后缀写进命令行历史、截图和公开 Issue。

先只做准备检查：

```sh
python3 scripts/zunlock.py --dry-run
```

`--dry-run` 会访问设备、下载并校验备份，但不会上传恢复包或触发恢复。
它也不保证之后的恢复一定成功。确认识别的是自己的 MU5250，并保存原始备份后执行：

```sh
python3 scripts/zunlock.py
```

按提示确认恢复，等待设备重新启动。不要并行再运行另一套解锁脚本。
原始加密备份默认保存在电脑的 `~/.local/share/open-u60-pro/recovery`；备份包含隐私，
只保存在自己的电脑上，不要提交到仓库或 Gist。

如果网关已改变，脚本支持 `--gw`，例如先用以下命令查看参数：

```sh
python3 scripts/zunlock.py --help
```

### 旧固件的社区 openadb 方法（历史参考）

[amenekowo/mu5250_tweaking 的“开启调试模式”章节](https://github.com/amenekowo/mu5250_tweaking#开启调试模式)
引用的是 [MlgmXyysd/openadb_MU5250](https://github.com/MlgmXyysd/openadb_MU5250)。
后者的 `openadb.php` 要求 PHP 8.0+ 和 cURL 扩展，通过原厂 Web 登录后调用
`zwrt_bsp.usb.set`，请求 `mode=debug`。它的网关和管理密码需要由使用者自行配置。

这只能解释旧固件上的社区方法，**不代表本机固件仍提供该接口**。本项目对 HK B04
使用前面的备份/恢复方案；不把 PHP 方法视为所有 U60 固件通用的一键解锁。
也不要在设备运行中手动写 `usb_op` 节点，调试 USB 组合只通过受控的启动流程处理。

## 4. 验证 ADB，避免选错设备

重启后在电脑运行：

```sh
adb devices -l
```

找到自己的 U60，状态应为 `device`。如果连接了多个 Android/调试设备，必须显式选序列号：

```sh
# 用 adb devices 显示的 U60 序列号替换引号内文字。
export U60_ADB_SERIAL="你的U60序列号"
adb -s "$U60_ADB_SERIAL" shell id
```

核对返回的权限；需要 root 调试 shell 才能继续部署。设备已能通过 SSH 管理时，
不必为了重复验证而再次执行解锁/恢复。

常见情况：

- **列表为空**：先排除仅充电线、USB 口、设备未开机、恢复后未启动完成及 Windows 驱动。
- **显示 offline/unauthorized**：检查设备状态、线缆及任何实际出现的授权提示；不能据此认定已获得 shell。
- **网页没有 USB 菜单**：参考前面的固件分支，不依赖不存在的菜单。
- **此前硬化后重启，ADB 消失**：本项目会恢复正常 USB 网络组合，SSH 应继续保留。
  不要因此反复覆盖现有配置；先检查 SSH。

## 5. 安装 SSH：使用项目的 Dropbear 部署

本项目使用 `/data/bin/dropbear`，不要求在只读系统目录中执行 `opkg install openssh-server`，
也不需要为 SSH 把 `/usr`、`/sbin` 等目录整体改成可写 overlay。

ADB 可用时，先执行只读设备检查和本地组件准备：

```sh
bash scripts/zharden.sh --dry-run --gateway 192.168.0.1 --adb-serial "$U60_ADB_SERIAL"
```

确认准备结果和目标设备后执行实际部署：

```sh
bash scripts/zharden.sh --gateway 192.168.0.1 --adb-serial "$U60_ADB_SERIAL"
```

这是 **SSH 与面板服务器的硬化部署**，不仅打开一个端口。它会：

- 准备并校验 Dropbear 与独立 uhttpd 组件；
- 使用电脑的 `~/.ssh/id_ed25519` 公钥；缺少完整密钥对时按脚本逻辑创建或报错，不覆盖已有密钥；
- 写入设备 `/etc/dropbear/authorized_keys`，生成并保存设备自己的 SSH 主机密钥；
- 创建 `/data/local/tmp/start_dropbear.sh`，监听 TCP **2222**，默认只允许密钥认证；
- 仅在 `/etc/rc.local` 添加本项目的启动入口，并验证 shell 语法；
- 配置独立的面板服务器，关闭固件自动更新；
- 移除临时调试 USB 启动项，让后续启动回到正常 USB 网络组合；
- 验证 SSH 身份与密钥认证，保留部署回滚快照。

详细变更、快照与恢复命令见 [部署文档](DEPLOYMENT.md)。中文扩展 CGI、Mihomo、
WireGuard、短信转发等仍需按 [扩展部署说明](PUBLIC_EXTENSIONS.md) 单独安装。

## 6. 从电脑连接 SSH

本项目把设备主机密钥记录在专用文件，连接时使用同一个文件：

```sh
ssh -p 2222 -i ~/.ssh/id_ed25519 \
  -o IdentitiesOnly=yes \
  -o UserKnownHostsFile=~/.ssh/known_hosts.d/zte \
  root@192.168.0.1
```

首次连接的主机指纹应与通过可信 ADB 读取的设备公钥指纹相符。可以在设备 shell 中
使用 `dropbearkey -y` 查看已有主机密钥的公钥信息；不要复制或公开主机私钥。
若提示主机密钥变化，先确认设备身份及是否重装过 SSH，不要直接删除记录或关闭校验。

可在电脑的 `~/.ssh/config` 加入自己的连接别名：

```sshconfig
Host u60pro
    HostName 192.168.0.1
    User root
    Port 2222
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
    UserKnownHostsFile ~/.ssh/known_hosts.d/zte
```

之后运行 `ssh u60pro`。这个别名使用默认 LAN 地址；WireGuard 的网段、设备地址、
防火墙规则和主机密钥别名属于个人网络配置，不包含在本教程中。

## 7. 可选：开启 root 密码登录

源码部署默认只允许密钥登录。OpenUI 的管理密码与设备 Linux root 密码是两套凭据，
即使你希望使用相同值，也必须自行设置，不能认为打开面板就设置了 SSH 密码。

需要密码登录时，先保持一条可用的密钥会话，然后在设备 shell 中：

1. 交互执行 `passwd root`，设置你自己的密码，输入不会正常回显。
2. 备份 `/data/local/tmp/start_dropbear.sh`。
3. 编辑该启动脚本的 `/data/bin/dropbear` 命令，**仅移除禁用密码认证的 `-s` 参数**，
   保留端口、主机密钥、PID 文件及原有的监听器管理逻辑。
4. 运行 `sh -n /data/local/tmp/start_dropbear.sh`，通过后再运行
   `sh /data/local/tmp/start_dropbear.sh`。这会重启自定义 SSH 监听器，已有连接可能中断。
5. 在电脑另一个终端测试密码认证：

   ```sh
   ssh -p 2222 -o PreferredAuthentications=password -o PubkeyAuthentication=no \
     -o UserKnownHostsFile=~/.ssh/known_hosts.d/zte root@192.168.0.1
   ```

本项目使用 Dropbear，因此这里不需要编辑 OpenSSH 的 `sshd_config` 或
`PermitRootLogin`。密码登录仍通过同一个 rc.local 启动脚本生效；这不是将 SSH
开放到移动网络公网。重新运行 `zharden.sh` 会恢复它管理的默认密钥认证脚本，
其验证也要求关闭密码认证；需要密码登录的人应在重新部署后自行核对。

## 8. 持久化与故障排查

- 开机入口仅使用 `/etc/rc.local`；不要另加 init.d/procd/firewall include，
  不要停止原厂启动屏障里的守护进程。每次编辑后执行 `sh -n /etc/rc.local`。
- SSH 程序、备份密钥和项目文件位于 `/data`；`/etc` 可能被 FOTA 清除，升级固件后
  要重新核对启动入口及兼容性，不能把文件还在 `/data` 等同于服务已恢复。
- `Connection refused`：检查端口是否为 2222，以及设备上自定义 Dropbear 是否正在监听。
- 连接超时：检查是否连到 U60 的网络、LAN 地址及路由；远程 WireGuard 访问还需要正确的隧道和防火墙设置。
- `Permission denied (publickey)`：核对使用的电脑密钥和设备 authorized_keys。
  不要把私钥上传给别人排查。
- 解锁/部署中断：保留脚本打印的快照和恢复命令，按部署文档在同一台设备上恢复，
  不使用网上另一台设备的配置包、分区镜像或密钥。

## 参考与来源

- [本项目完整部署流程](DEPLOYMENT.md)
- [本项目设备安全规则](SAFETY.md)
- [MU5250 tweaking](https://github.com/amenekowo/mu5250_tweaking)
- [openadb_MU5250](https://github.com/MlgmXyysd/openadb_MU5250)
- [上游 MU5250-OpenUI](https://github.com/dklasens/MU5250-OpenUI)

社区脚本及文章的版权和许可归原作者；本文提供链接与操作说明，不将其脚本重新打包发布。

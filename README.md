# U60 Pro OpenUI 中文扩展版

基于 [dklasens/MU5250-OpenUI](https://github.com/dklasens/MU5250-OpenUI) 的 ZTE U60 Pro / MU5250 管理面板中文扩展。

## 功能

- 简体中文界面，保留常用英文网络指标。
- 首页 QCI / 5QI、AMBR、WAN TCP/UDP 连接统计。
- Clash / Mihomo 内嵌面板、订阅管理及透明代理总开关。
- WireGuard 配置导入、手动启停与开机启动，支持内网分流。
- 短信编码与时间解析修复；Webhook / Bark 转发及去重重试。
- 短信达到 50 条时逐步清理旧消息，保护待转发消息和草稿。

## 开发

需要 Node.js `^20.19.0 || >=22.12.0`：

```sh
cd web-app
npm ci
npm run build
npm run lint
npm test
```

面板运行于设备端，需要配套 agent；这不是可直接部署到 GitHub Pages 的独立设备管理服务。

## 部署与限制

阅读 [上游安装文档](README.upstream.md)、[设备安全规则](docs/SAFETY.md) 和 [扩展部署说明](docs/PUBLIC_EXTENSIONS.md)。上游安装器仅负责原有组件，扩展 CGI、服务及第三方核心需要单独配置。本仓库不包含运行密码、订阅、WireGuard 密钥、Bark 密钥、短信或设备备份。

此版本是源码快照，当前没有预编译设备安装包；请先验证固件兼容性，不要盲目运行底层或研究脚本。

## 来源与许可

基于 MU5250-OpenUI；上游部分代码来自 jesther-ai/open-u60-pro。保留原始版权和 [MIT License](LICENSE)。具体目录的第三方许可声明继续适用。

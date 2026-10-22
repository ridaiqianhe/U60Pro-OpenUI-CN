# 手动邻区采集

使用原厂 diag_mdlog 和 [33333s/zwrt-datad](https://github.com/33333s/zwrt-datad)
的离线解析器。QTrace mask 来自该 MIT 项目（保留其 LICENSE）。
仅手动采集 30 秒，不启动 datad 服务器、不添加开机服务；临时诊断文件采集后删除。

将目录安装到 `/data/plugins/neighbor-scan`（700），并放置官方 ARM64 发布二进制
命名 `datad`。已验证版本 v0.10.79，SHA256：
`148d6dc5e737d0a55162179024a0a465c34a72dcb23f2e0ccd8a8c3fc6f3e9b1`。
`neighbor-scan.cgi` 放 dashboard `cgi-bin/neighbor-scan`。

状态文件可能含附近基站信息，不要发布。扫描结果不代表一定可驻网；无信号值不补猜测值。
结果超过五分钟标记过期；当前服务及聚合载波从邻区结果中过滤。

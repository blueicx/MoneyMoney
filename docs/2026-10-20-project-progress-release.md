# 私人研究项目关联与返回恢复发布记录

运行版本：`c6d26bb2bc03d91951dc3b3ca0fdb53149c60cb7`。仅为十二组路线的后续切片，不代表全部完成。

## 已验证能力

- 明确关联策略候选、已有研究任务及独立模拟账户。账户必须满足 runner/account 一一对应、冻结范围 Hash 和持仓标的一致；旧记录无法核验则不猜配对。
- 管理员手动读取关联状态及任务进度，不修改固定引用、任务、策略或账户。固定引用改变市场或标的后不可用于新结论。
- 研究工作区返回时重新读取同市场项目，恢复项目、筛选和滚动；退出登录清除内存返回状态，不写离线缓存。

15项定向测试、TypeScript检查、364个隔离文件的1746项全量测试通过。构建、Web/认证/四市场/实时K线/专业研究/合约/研究深度七类冒烟及专用项目浏览器通过。安全扫描925个跟踪文件、差异检查通过。既有JSDOM警告仍记录，不宣称日志零警告。

干净导出目录：本机临时目录 `moneymoney-projects-clean-c6d26bb-c3b0c9`；用完整运行提交重新构建，七类冒烟和项目浏览器再次通过。界面使用明确标记的隔离夹具；真实来源验证来自独立只读生产巡检，不混淆两类证据。

## 发布验证

- 正式域名 `https://bluetrade.bbroot.com`：TLS、完整版本、29个资源SHA256和immutable缓存核验通过。
- 归档 SHA256：`6da7a4b2fb094dd5b2609df64c448a2220474403184ab9afabf1bbd778dd4bf3`。
- server.js SHA256：`94d357d36564c007b042fdfce9a259f94652b02ed5d98073f58189fd001000d9`。
- index.html SHA256：`2196cb74fc5b995683364137f5d733ebfd7390a4fb9c2e96ce968309a4143827`。
- 备份 `/opt/moneymoney/backups/dist-pre-c6d26bb-20261020-project-progress`；回滚 `/opt/moneymoney/dist.rollback-c6d26bb-20261020-project-progress`，保留上一运行版本1e7fd14。
- 只替换dist、只操作moneymoney.service；服务active，健康alive。正式域名只读Chromium巡检通过股票、期权、虚拟币、预测市场和SNDK。
- 前后10个跑单配置指纹相同：`5125162b35c9893e4a9ac7d11c40eeaca7297bd95d7434d6bec70712aa144181`。未创建生产采集/模拟/模型任务，未发送Telegram消息。
- 未跟踪data/research.db保留，SHA256为`27fd475e523568daa4cdcabf3146917023335a62affe00429babd721b3b79fd1`。数据库、数据湖、scratch和相邻服务未清理。

第一次远程调用因本地PowerShell转义而未进入部署脚本；改用字面量命令后完成部署。重启后健康检查前两次连接尚未建立，重试后alive，未触发回滚。上述中间失败不计为成功验收。

自动证据修订复查、受限策略构建、AI质量实验及后续市场/模拟/Telegram批次仍待完成；冷加载20%目标未达标，本批不作提速声明。

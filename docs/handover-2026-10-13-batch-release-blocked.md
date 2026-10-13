# 2026-10-13 批量扩充交接：代码已推送，生产发布被磁盘容量阻止

> 最新状态：以下阻塞记录保留为历史；用户授权清理7天前归档日志后，已完成本批部署及生产只读验收，详见文末。

## 已验证代码

- 功能提交：`ba927ed489d7b11804cfc8b9505d6efb6590a33a`。
- 来源时间修正：`1cc214f9e31545c66e84f64806c0fa59fa70a713`；未知来源数据时间保持 null，不用抓取时间冒充。
- 已推送 GitHub `codex/research-closure-all`。本批不是十二组全部交付声明。
- 本批包含共享自选元数据与安全撤销、Telegram `/groups`、点位成熟表现、同源证据变化、AI 保存记录诊断/回放、固定输入的研究稳健性分析及按需加载。
- 完整测试 1376 项通过；构建、Web/认证/浏览器/实时K线/研究/自选元数据冒烟通过；安全扫描737个跟踪文件通过；差异检查通过。
- 同固定环境三次冷热测量：桌面冷图表2850.5ms、热640.6ms，手机冷2660.2ms、热716.0ms。对原本地基线冷图表约改善43%/44%；不是生产速度保证。

## 发布产物

构建身份：`1cc214f9e31545c66e84f64806c0fa59fa70a713`，builtAt `2026-10-13T06:33:42.238Z`。

|产物|SHA256|
|---|---|
|发布 tar.gz|408a82e49e3f2c1d61ce919f7b7e6e7c28675740747c21f259e9a76d92c78c66|
|dist/web/server.js|046508f6bad1ca6b8ff59fc57f1e5f541a4c2d07117376e701a53d987ceb53d3|
|dist/web/public/index.html|f7e47cb32e45c38c12ddec6f598f9c85f2142da631992222940cac2b985b8eeb|
|dist/web/public/asset-manifest.json|742a31c6a123065acb5c5f70a564a4831535b9f7ede14e85a8fafd6ad5cf4636|

本地包：`C:/Users/blueice/AppData/Local/Temp/moneymoney-release-1cc214f-20261013-batch/moneymoney-1cc214f-20261013-batch.tar.gz`。
远端包：`/tmp/moneymoney-1cc214f-20261013-batch.tar.gz`；此目录为 tmpfs，重启可能丢失，需重新核验或上传。

## 生产阻塞与恢复点

部署脚本 Windows CRLF 导致首次执行在 set 语句停止，未产生发布操作；以 `sed 's/\r$//'` 流式规范化后重试。
第二次在复制旧 dist 备份时发生 `No space left on device`，发生在 service stop 和产物切换之前。没有重启、切换或回滚线上服务。

实际读数：根分区28GB、100%使用；MoneyMoney数据约19GB、backups约1.4GB、系统日志约2.1GB，其中journal约1.9GB。
清除本次创建的新产物 staging 和不完整备份后，仅剩17MB可用，仍不安全发布。

仅清除本次可重建目录（已核验绝对路径、不是符号链接、对应回滚目录不存在）：

- `/opt/moneymoney/.staging/dist-1cc214f-20261013-batch`
- `/opt/moneymoney/backups/dist-pre-1cc214f-20261013-batch`

没有删除旧备份、旧回滚、数据库、数据湖或日志。`moneymoney.service` active；健康接口 alive。
线上仍为 `876af636305dc84c20f6027735c322a5ca580c45`，不是新代码。尚未执行新版本生产浏览器验收。

需要用户选择扩容，或授权有范围的日志/历史产物保留策略后才能继续。腾出足够空间后重走备份、产物Hash校验、只操作moneymoney.service的原子切换；再核验正式域名版本和只读浏览器矩阵。
生产只读巡检必须清空当前子进程的 TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID，避免失败分支未经授权发送验收消息。

## 数据与未完成范围

本地未跟踪 `data/research.db` 未纳入提交，Hash不变：`27fd475e523568daa4cdcabf3146917023335a62affe00429babd721b3b79fd1`。
未修改现有AI跑单的预算、模型、运行状态或冻结自选范围；没有模型调用或生产模拟订单验收写入；真实交易继续禁用。

后续仍需完成：图表测量/价格提醒确认、多图完整同步、持久信号筛选；本轮股票资本财务和13F深化、期权三变量情景、合约实际资金结算成本、预测关系审计；其它Telegram日常动作及完整注册表/表格治理。详见本轮执行计划，不得将本批测试通过等同于全计划完成。

## 授权清理与发布完成（2026-10-13）

- 用户明确允许清理过期系统日志、保留最近7天。执行 `journalctl --vacuum-time=7d`，仅删除过期归档journal，释放约1.4GB；这些已删除日志未另行备份、不能恢复。未删除数据库、数据湖、旧发布备份或回滚目录。
- 清理后可用空间约1.5GB；部署及服务启动后约1.3GB，根分区仍96%占用，容量风险未彻底解决。没有更改持久日志保留配置或对业务数据做清理。
- 重试同一已核验发布包，部署脚本退出0；只停止/启动 `moneymoney.service`，未操作相邻服务。启动初期两次健康连接失败后服务恢复alive；未触发回滚。
- 旧版本完整备份：`/opt/moneymoney/backups/dist-pre-1cc214f-20261013-batch`；旧版本回滚：`/opt/moneymoney/dist.rollback-1cc214f-20261013-batch`。两者build-info文件确认存在。
- 正式域名和loopback版本均为 `1cc214f9e31545c66e84f64806c0fa59fa70a713`。远端server/index/asset-manifest三项Hash与本地发布包一致；公开HTTPS实际下载27个版本化资源，逐一Hash通过。
- 生产只读Chromium巡检通过，时间 `2026-10-13T06:43:29.471Z` 至 `2026-10-13T06:44:03.296Z`：四市场切换、SNDK选择、右侧库收缩恢复、手机中心区、页面无运行异常，访客日记访问403。
- AAPL/usAAPL/AAPL.OQ的asOf查询均429根、相同来源及历史状态；普通AAPL1254根、SNDK417根。预测市场真实事件可选择；结算证据明确显示访客不可访问，不将此冒充管理员证据成功验收。
- 生产验收关闭该子进程Telegram失败通知，不发送测试消息、不调用模型、不创建模拟订单。私人新模块写操作在上一批隔离本地浏览器完成，不在生产重新创建验收数据。
- 巡检报告：`C:/Users/blueice/AppData/Local/Temp/mm-canary-1cc214f-20261013/production-canary-report.json`。
- 最新安全扫描738个跟踪文件通过、差异检查通过；本地未跟踪research.db Hash保持不变。此次仅继续发布，未重跑完整1376项代码测试，也没有变更已验收代码。

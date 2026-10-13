# 2026-10-13 批量扩充交接：代码已推送，生产发布被磁盘容量阻止

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

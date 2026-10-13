# 区间测量与结算复核发布交接

## 已交付

代码版本3dc08deaa647a472521b84a82f320e65b5f3ce61已提交、推送到codex/research-closure-all并部署当前VPS。

图表新增区间测量，保持策略点击、上下文重置和三主题/手机布局。合约成本复核只读取同账户、同合约的明确资金结算记录，冲突/错误单位/溢出不发布合计；USDT不冒充USD，记录覆盖仍标记不完整。本批没有账户资金费账单采集，不生成结算记录、不改变模拟余额和现有AI跑单。

本地最终代码1384项测试通过，构建、Web、认证、四市场浏览器、实时K线、合约及加载基准通过。合约冒烟首次登录跳转超时，未改代码重跑通过。安全扫描740个文件，差异检查通过。三次冷热图表中位数：桌面2971/731.5ms、手机2806.2/704.1ms；相对原基线约改善40%/41%，但较上一批慢4%/5%，后续性能治理未结束。

## 发布证据

- 发布标签3dc08de-20261013-measure；上传首次SFTP连接被重置，使用旧SCP协议重传成功，部署前校验归档Hash。
- 归档SHA256：8e1f316bb56643f4522ba9d69ec7fda323ca8633c6755d8d618ee38ac1faabc8。
- server.js：2d33c2c48b4c99179c424299fd7bd21fc4c8a3589930d0f3daee383f5bcfc4a6。
- index.html：04d02ef0f5f8ecbb0eef06d7f01f0e50f23b4cb09004630f314cb95e6fb35f1c。
- asset-manifest.json：c11cc21a10af07c81fd5c23f91081f88bd6d2855385918c583e9187ef6ccffc3。
- 三项远端Hash与本地一致；远端build-info确认上述完整代码版本。只重启moneymoney.service；启动初期两次连接失败后健康alive、service active。
- 备份：/opt/moneymoney/backups/dist-pre-3dc08de-20261013-measure；回滚：/opt/moneymoney/dist.rollback-3dc08de-20261013-measure。此前版本及回滚不删除。
- 正式域名https://bluetrade.bbroot.com只读Chromium巡检通过四市场和SNDK；报告位于本地临时目录mm-canary-3dc08de-20261013。验收子进程清空Telegram通知配置，不发送消息、不调用模型、不创建订单。

## 紧急容量阻塞

发布前根磁盘剩余约125MB，dist约11MB；备份、切换及后续检查期间可用空间骤降至0。服务仍active/live，但不能以此保证SQLite写入成功，容量问题阻止继续发布和新增采集。

只读检查：/opt/moneymoney/data/backups约20GB，data/lake约6.4MB；整个根分区28GB。沿此前明确授权再次清理超过7天的系统journal，释放0B，未删除业务备份、数据库、数据湖或旧产物。没有擅自停止现有AI跑单或改变自动任务配置。

需要用户选择扩容，或授权检查并制定历史备份迁移/保留方案；不应直接删除20GB备份。本轮之后的功能继续等待安全容量，不宣称十二组全部完成。

本地未跟踪data/research.db未提交/打包，Hash仍为27fd475e523568daa4cdcabf3146917023335a62affe00429babd721b3b79fd1。剩余功能参见批量执行计划，包括提醒确认、多图同步、股票/期权/预测深化、Telegram及工作区治理。

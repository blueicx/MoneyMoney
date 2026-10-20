# 受限策略定义与历史条件解释

本次是平台扩充第三批的首个可操作切片，不是十二组计划全部完成。

## 范围

- 在现有私人研究工作区嵌入折叠面板，按需下载；首次打开不请求定义、不采集、不调用模型、不创建订单。
- 受限注册指标、条件组合、资金比例及成本验证。使用同一浏览器/服务端解释器，只解释所选时点已完成的归档K线。
- SQLite保存不可变版本、内容Hash、版本索引和审计；保存新版本使用期望Hash进行乐观并发控制，旧版本不覆盖。
- 历史预览绑定归档快照及分区Hash，核验市场/标的/周期/来源字段。未来发布行剔除，日内缺口重新暖机；缺字段、身份未核验或无分区保留明确原因。
- 私人接口统一管理员、CSRF、no-store；界面退出登录或切换市场清除私人内容，隐藏页面中止请求。历史请求失败先清除旧标的结果。
- 三主题使用已有颜色变量；不支持表单无损编辑的嵌套结构明确拒绝，不部分改写已有版本。

## 已验证

19项定向测试、构建和专用隔离Chromium通过。覆盖手动新建/保存v1-v2/回看v1、服务器Parquet夹具解释、未来发布时间、日内缺口、三个主题、桌面1440和手机390、四市场与访客隔离。夹具标记为隔离验收数据，不冒充真实市场行情。

浏览器产物：系统临时目录mm-assets-browser-2puYPC。用户未跟踪数据库Hash未变；生产10个跑单配置只读指纹仍5125162b35c9893e4a9ac7d11c40eeaca7297bd95d7434d6bec70712aa144181。

## 待完成

完整回归368个隔离文件、1772项测试、失败0；构建、Web/认证/四市场/实时K线/专业研究/合约/研究深度七类冒烟和本批专用Chromium均通过。安全扫描937个跟踪文件及差异检查通过；既有JSDOM警告保留，不宣称零警告。日志：mm-strategy-builder-full-tests.log、mm-strategy-builder-gates.log；最终本地浏览器产物mm-assets-browser-FDHTkX。

尚未部署，提交后须干净导出构建并复验。共享解释器接入图表/历史实验/前向模拟、现有候选晋级，以及后续AI/四市场/共享资金/盲测/Telegram批次仍待推进。冷加载改善20%仍未达到，不作提速声明。

## 后续发布核验

上节“尚未部署”为提交前状态；现已发布运行提交2e8537df6a2e074b43b2ba9e87bbe661471ad93d，GitHub已推送。干净导出moneymoney-strategy-clean-2e8537d-20261020重建并再次通过七类冒烟及专用策略/项目浏览器，产物mm-assets-browser-505IFX；日志mm-strategy-builder-clean-gates.log。

- 正式域名有效TLS、版本、29个静态资源SHA256和immutable缓存均通过；未登录私人定义与能力接口拒绝访问。
- 生产只读Chromium巡检通过四市场和SNDK，报告moneymoney-canary-1792506256954/production-canary-report.json，日志mm-strategy-builder-production-canary.log。未向生产创建策略/实验/模型请求或发送Telegram消息。
- 归档SHA256：e725ffc1c6ac88146d9aae6a99410830a1d3e5ca271fb82aadd6bffa174d1be9。
- server.js SHA256：425f239b90067b4e4f1837399a0462b1cb4cfde1ccec9c30759c1c2577a05c13；index.html SHA256：efcbd96cdd341ef72af8a3282af3f5516fc7cd987f63454453a29597cdf90931。远端一致。
- 备份/opt/moneymoney/backups/dist-pre-2e8537d-20261020-strategy；回滚/opt/moneymoney/dist.rollback-2e8537d-20261020-strategy，保留8fe8826产物。服务active，启动前两次连接尚未就绪，重试健康alive成功；未触发回滚。
- 10个AI跑单配置指纹部署前后均5125162b35c9893e4a9ac7d11c40eeaca7297bd95d7434d6bec70712aa144181。用户data/research.db Hash仍27fd475e523568daa4cdcabf3146917023335a62affe00429babd721b3b79fd1，未纳入提交。

只操作moneymoney.service及dist，未清理运行数据。整个第三批及十二组仍未勾选完成。

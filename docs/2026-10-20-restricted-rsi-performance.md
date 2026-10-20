# 受限策略 RSI 解释计算优化

目的：避免新策略研究预览阻塞Web进程；不是整页冷加载改善20%的验收。

## 根因与改动

逐根解释RSI时原实现反复计算整个历史前缀，处理N根K线为平方级工作量。改为单次预览内按指标周期缓存线性生成的Wilder序列，仍在日内缺口处重置、重新暖机，滞后只引用对应历史值。缓存不跨预览或标的，策略解释器版本与内容Hash不变，因为输出语义不变。

## 定向验证与测量

- 先补失败测试：500根K线的旧实现读取close字段252818次，超过每根50次的测试上界；优化后通过。
- 21项定向测试通过，覆盖3/14/21周期、0/2根滞后、缺口暖机与逐项精确数值相等，以及既有权限/不可变版本/界面测试。
- 隔离合成数据5000根，不是行情：以运行提交2e8537d的解释器作对照，同环境串行各3次，比较完整JSON输出逐项相等。
- 旧耗时4349.3714、4518.5690、4590.3050ms；新耗时6.8541、5.5482、9.3356ms。中位数分别4518.5690和6.8541ms。测量仅包含解释器CPU，不包含下载、界面、Provider或冷启动。

完整回归368个隔离文件、1774项测试、失败0；构建、Web/认证/四市场/实时图表/专业研究/合约/研究深度七类冒烟与专用Chromium全部通过。日志：mm-strategy-rsi-full-tests.log、mm-strategy-rsi-gates.log。发布前仍须安全扫描、干净导出重建及生产核验，不能用定向结果替代。

整页冷加载20%目标仍未完成；图表/实验/前向共享接线、候选晋级和后续路线继续保留未完成状态。只优化已发布策略预览的计算量，不改变策略Hash、现有AI跑单或业务记录。

## 发布核验

- 运行提交17c0ca1ba03249869cc3b55a6e057fdf6a83ff72已推送GitHub并部署。干净导出moneymoney-rsi-clean-17c0ca1-20261020重新构建并再次通过七类冒烟和专用Chromium；日志mm-strategy-rsi-clean-gates.log，浏览器产物mm-assets-browser-E3b6cI。
- 安全扫描938个跟踪文件、差异检查通过。正式域名有效TLS、版本、29个静态资源SHA256及immutable缓存、私人策略接口拒绝访问均通过。
- 生产只读Chromium通过股票、期权、虚拟币、预测市场和SNDK；报告moneymoney-canary-1792507343421/production-canary-report.json，日志mm-strategy-rsi-production-canary.log。没有生产模型调用、实验创建或Telegram发送。
- 归档SHA256：906d30b54ba0345980872f786b90f0f7ef237261af93eeb9c25249d41721519c。
- server.js SHA256：425f239b90067b4e4f1837399a0462b1cb4cfde1ccec9c30759c1c2577a05c13；index.html SHA256：ca79231608324f7f97757f3d1ec32daaa6d1d1ee10ade317d0855b8ba1721c51，远端一致。
- 备份/opt/moneymoney/backups/dist-pre-17c0ca1-20261020-rsi；回滚/opt/moneymoney/dist.rollback-17c0ca1-20261020-rsi保留2e8537d产物。仅重启moneymoney.service；启动最初两次健康连接尚未就绪，之后alive，未触发回滚。
- 10个AI跑单配置指纹前后均5125162b35c9893e4a9ac7d11c40eeaca7297bd95d7434d6bec70712aa144181；未跟踪data/research.db仍为27fd475e523568daa4cdcabf3146917023335a62affe00429babd721b3b79fd1，未纳入提交。没有清理数据湖、scratch或用户文件。

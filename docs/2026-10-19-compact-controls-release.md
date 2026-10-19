# 紧凑工具面板发布验收

## 交付

- 运行代码：aae91d8828f72b5967224015e6da9fdc41138d23，已推送codex/research-closure-all。
- 用户确认的紧凑布局：市场与通用工具两个菜单，周期/来源保持可见，历史定位和图层策略独立披露。
- 保留全部原ID、按钮回调和选择状态；未修改后端交易、行情或业务状态。
- 修复手机菜单越界、卡片层叠遮挡、Escape焦点竞争；保留股票控件容器的兼容契约。

## 本地验收

358个隔离测试文件、1709项测试、失败0。构建及smoke:web/auth/browser/live-kline/professional/contracts/research-depth通过；security:scan（新增文件纳入后908个文件）及git diff --check通过。原生菜单键盘和外部点击、日内下钻、全屏、Replay、点位解释、三主题、桌面/手机、四市场及12轮历史前进后退均在现有矩阵检查。

独立干净目录导出提交后重新构建，嵌入同一完整commit，再次通过全部7类冒烟。图表推流检查使用隔离传输夹具，不冒充实盘逐笔行情；另有隔离数据目录的实际来源截图检查，未发Telegram测试消息、未调用生产模型或提交订单。

截图：E:/CodexHome/visualizations/2026/10/19/moneymoney-compact-accepted。源测试与截图布局一致，不在生产注入预览DOM。

## 部署及核验

- 正式域名：https://bluetrade.bbroot.com；TLS正常，版本与完整commit一致。
- 只替换dist并操作moneymoney.service；健康alive、服务active。
- release：aae91d8-20261019-compact。
- 归档SHA256：471205ad73f4de703e2f852501afd898902ef8baecff7ac62ac8d480a8c3f887。
- server.js SHA256：32287ffbe31dd3e8b1621654fea58503aaab90c73bb66cbc997a578d7abc83d6。
- index.html SHA256：24d8ed208714ce9813d817bf1cc4f5a43c9dd0328e369295431dc3bc4573adab。
- 远端server/index及域名全部29个版本化资源Hash与干净产物一致。
- 备份：/opt/moneymoney/backups/dist-pre-aae91d8-20261019-compact。
- 回滚：/opt/moneymoney/dist.rollback-aae91d8-20261019-compact，保留旧4cf33a7产物；两个目录已验证存在。
- 线上只读canary通过stocks/options/crypto/prediction及SNDK，不写业务数据。
- 10个跑单配置指纹前后一致：5125162b35c9893e4a9ac7d11c40eeaca7297bd95d7434d6bec70712aa144181。
- 未跟踪data/research.db保留且未提交；SHA256仍为27fd475e523568daa4cdcabf3146917023335a62affe00429babd721b3b79fd1。数据库、数据湖、scratch及用户文件未清理。
- 根盘47%，约16GiB空闲；未操作相邻服务。

## 性能边界

冷加载20%目标未通过，研究深度第31项保持未完成。固定环境各3次对照的手机冷页面改善13.6%，桌面慢8.8%；两者通过现有绝对预算，但不能据此宣称全面提速或全部性能任务完成。详见2026-10-19-cold-loading-diagnostics。此次按用户已授权“先发布已验收功能，继续优化性能”交付布局，不修改验收口径或掩盖退化。

# MoneyMoney Deribit 期权纸面撮合发布记录

## 变更范围

- 发布提交：`aa9161adf27ea4697ae2b8e0b159a083df40dd5e`（`feat: add verified Deribit option paper execution`）。
- 将真实 Deribit BTC/ETH 完整期权合约接入 AI 跑单的纸面报价与撮合门槛。仅接受来源核验的合约身份、未到期状态、USD 指数、双边报价、源时间、费用与顶档深度；只允许有限损失的买入持有，历史不足时不产生规则信号或伪回测。
- 模拟账本保留 Deribit 完整合约身份；费用采用来源合约费率及权利金封顶，按卖一可见深度和独立预算缩量。所有成交仍是模拟成交，没有真实交易执行器。
- Predict.fun 官方市场定义纳入可复核哈希，但官方接口没有独立且可执行的结算规则证据，因此仍禁止 AI 决策和新开仓；既有持仓估值/风险退出门槛保持原样。

## 验证

- 全量 `npm test`：233 个隔离测试文件，1,065 项通过、0 失败。
- 构建通过，生成 21 个哈希/预压缩资源；`smoke:web`、`smoke:auth`、`smoke:browser`、`smoke:contracts`、`smoke:live-kline`、`smoke:automatic-comparison`、`security:scan`、`git diff --check HEAD^ HEAD` 全部通过。
- K 线隔离 smoke：计时器 DOM 改写/绘图为 0，隐藏页面绘图为 0；自动对照 smoke 仅用隔离数据库，模型调用 0、自动调度关闭。它们不代表生产模型交易或实时图表上游验收。
- 正式域名访客只读 Chromium canary 通过：四市场、SNDK 选择、移动布局与私有接口权限；构建版本必须匹配发布提交。访客 canary 未调用模型或提交业务订单。
- VPS 发布验证读取到 AAPL/SNDK 各 4,681 根股票历史 K 线、Gate 合约历史 200 根、有效实时 SSE 2 条；空缺时保持来源原始状态。访客私有读取仍被拒绝。

## GitHub 与 VPS

- 已推送 `origin/codex/research-closure-all`，当前运行时构建提交为 `aa9161adf27ea4697ae2b8e0b159a083df40dd5e`。
- 发布包 SHA-256：`4a8f6281a7214ffcdac5d5ed9ed0fd2d44362a4b5a7c944c6a6c9f1e81c187bc`。
- `dist/web/server.js` SHA-256：`122142e670da7a8a76005c9e485547606546f8ffa5d279fd4cfd4ffe8fbf0b0e`。
- `dist/web/public/index.html` SHA-256：`688b5a6eb73aab7def06bcde1b2527620df4b972e8ee974c6063623af5600529`。
- `asset-manifest.json` SHA-256：`07e8e2911d282ec17f62dacde1bd452da7a40c94ea12d063c307497379085f69`。
- `moneymoney.service` 为 active；本机与 `https://bluetrade.bbroot.com/api/health/version` 返回同一提交，健康接口 alive。远端文件 Hash 与本地发布物一致。
- 备份目录：`/opt/moneymoney/backups/dist-pre-deribit-aa9161a-20261009-084427`；回滚目录：`/opt/moneymoney/dist.rollback-deribit-aa9161a-20261009-084427`，两者均保留。仅替换 `dist` 并重启 `moneymoney.service`，未操作相邻服务、生产配置、数据库或数据湖。上传包、基线文件及临时验证脚本已从 VPS `/tmp` 清理。
- 部署前后保护中的独立 $1,000 股票跑单配置与运行状态摘要哈希一致；无模型调用、无生产模拟订单。自动对照组的模型、标的池、调度和启停状态没有被改动。
- 工作树的 `data/research.db`、`data/research.db-shm`、`data/research.db-wal` 未提交、未删除。

## 尚待人工验收 / 保持 fail-closed

- Telegram 验收消息已按授权发送一次，需用户点击按钮才能完成真实 ACK 回调验收；不重复发送。
- 用户偏好“随机”已记录为选择一次具体模型后冻结，而不是每轮动态切换；现有生产对照组不会因此被自动归档或重建，需单独授权后再改其固定模型。
- Predict.fun 仍因缺少官方独立结算规则而禁止新增交易决策。期权发布只新增研究/模拟路径，不代表创建或启动期权跑单。
- 不运行可能影响正在运行任务的生产目录回滚演练；既有生产跑单及自动对照调度状态保持原状。

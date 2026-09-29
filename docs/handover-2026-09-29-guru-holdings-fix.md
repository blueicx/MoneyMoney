# MoneyMoney 2026-09-29 大神持仓 SEC 13F 修复交接

## 修复内容

- 使用查询到的申报主体 CIK 构造 SEC 归档路径；不再把 accession 前缀误当作申报人 CIK。
- 支持 SEC submissions 中安全的子目录 `primaryDocument`，并从归档索引的有界 XML 候选中按内容识别信息表，不假设文件名固定为 `infotable.xml`。
- 兼容同一证券按不同投资裁量拆分的行；按 CUSIP、证券类别和 put/call 汇总股数/金额，但 share/principal 单位不一致或身份含糊时拒绝合并。
- 申报日为 2023-01-03 及之后时按美元读取 13F value；更早申报按千美元换算。历史错误单位缓存会在读出时重新规范化。
- SQLite 入库校验改为核对 SEC 来源 URL 中的 filer CIK 与 accession 路径，保留来源归属校验但不再错误拒绝 filing-agent accession。
- SEC JSON/XML 请求共用 125ms 节流；每日刷新强制绕过单主体新鲜度缓存。失败和部分失败最多每日 3 次，以 15/30 分钟递增退避；旧刷新状态无 `attempt` 字段时兼容重试。
- 解析器支持 SEC 官方信息表使用的命名空间标签（例如 `ns1:informationTable`、`ns1:infoTable`），并要求记录字段沿用根节点的命名空间；原先的无前缀 XML 仍兼容。

## 验收证据

- 真实 SEC Berkshire 申报：accession `0001193125-26-352200`，报告期 `2026-06-30`，申报日 `2026-08-14`；89 条原始行归并为 29 个证券身份。归并金额总和 `$299,253,556,246`，与 SEC cover page 总额一致。
- Ally Financial（CUSIP `02005N100`）在生产最新申报中显示 27,000,000 股、申报金额 `$1,240,650,000`；详情含 SEC 归档和信息表链接。13F 是季度延迟披露，不代表实时或完整持仓。
- 正式域名 `https://bluetrade.bbroot.com` 的伯克希尔投资人页与 AAPL 持有人页已验证：报告期、申报时间、缓存状态、持仓/股数变化和原文链接正常。
- 生产只读浏览器巡检通过：四市场切换、访客私有数据拒绝、SNDK 非热门股票、右侧栏收缩/恢复及窄屏。
- 首轮发布后 8/10 主体有缓存；后续命名空间修复部署并刷新后，10/10 精选主体均有可用最新快照。Ray Dalio/Bridgewater 与 Daniel Loeb/Third Point 不再出现 `Malformed 13F information table XML`。

## 测试、提交与部署

- `npm test`：596/596 通过。
- `npm run build`、`npm run smoke:web`、`npm run smoke:browser`、`npm run smoke:auth`、`npm run smoke:production`、`npm run security:scan`、`git diff --check`：通过。
- Secret scan：452 个 tracked 文件通过（含本交接文档）。
- 提交并推送至 `codex/stock-free-data-sources` 与 `master`：
  - `f8004c5` 修复 SEC 13F 读取/金额/重复行。
  - `22a9409` 添加失败刷新退避重试。
  - `4e4ad06` 修正 filing-agent accession 入库校验并加入 SEC 节流。
  - `235a7bb` 将部分失败也纳入重试状态。
- 最终构建：`235a7bbb3f9e106bdbac31a4460fc51c565a0578`。
- VPS 发布标签：`guru13f-final-235a7bb-20260929`；备份：`/opt/moneymoney/backups/dist-pre-guru13f-final-235a7bb-20260929`；回滚：`/opt/moneymoney/dist.rollback-guru13f-final-235a7bb-20260929`。
- 最终发布归档 SHA-256：`fe671e710c627ba9805b4efcf96de198f210799fb2f2d18b566fd3ef88f8fcde`。
- 本地与 VPS 文件 SHA-256 一致：
  - `dist/web/server.js`: `20161b715329267342da478a39d9f576b73f4bc7dede77250f3d1853c32b6e1c`
  - `dist/web/public/index.html`: `ca91abbf5c0043f636cc9211e90dec6c79bcf428035cbb76e6c13997509b258f`
  - `dist/features/research-repository.js`: `6b8f14cdcae1d6c6c8520f228cbee7c189ea3e684df6e953b84120ee4a69ee76`
  - `dist/features/sec-edgar-client.js`: `f04f6ae809e528540dacb2d8524fb5466505aaeb54125b1c1133777162524b0b`
  - `dist/features/guru-holdings-refresh-monitor.js`: `4da5a764b5ac19badc54451c03624b407173a06e08d4cb0fea7bce7ad0e9cf4f`
- `moneymoney.service` 为 `active`；本机 live health 返回 `alive`；正式域名版本接口返回提交 `235a7bbb...`。

## 保留边界

- 只替换 `/opt/moneymoney/dist` 并操作 `moneymoney.service`；未触碰 Nginx、TLS、Telegram 配置、密钥或真实交易。
- 远端备份和回滚目录保留。仓库中的 `data/lake/`、`data/research.db*` 和 `scratch/` 是本地/运行数据，未纳入提交。
- SEC 参考：[Form 13F FAQ](https://www.sec.gov/rules-regulations/staff-guidance/frequently-asked-questions-about-form-13f)。

## 命名空间修复与二次部署（e957459）

- 根因证据：Bridgewater 2026-06-30 报告（accession `0001350694-26-000003`）和 Third Point 同期报告（`0001040273-26-000003`）的官方 XML 均使用 `ns1:` 标签前缀；信息表发现器已接受此前缀，但业务解析器只匹配无前缀标签。
- TDD：新增 `ns1:` 格式回归测试，先确认旧解析器以 `Malformed 13F information table XML` 失败，再实现同命名空间解析。构建通过；`npm test` 597/597；`smoke:web`、`smoke:browser`、`smoke:auth`、`smoke:production`、`security:scan`（452 个文件）及 `git diff --check` 均通过。
- 使用节流后的 SEC 客户端验证原始真实 XML：Bridgewater 解析 997 条、申报金额合计 `$24,376,086,530`；Third Point 解析 43 条、申报金额合计 `$4,679,571,988`。
- 因上海时区当天自动刷新已用完 3 次额度，部署后通过 VPS `moneymoney` 服务账户调用同一刷新服务；每个 CIK 仍使用数据库租约。未改网页密码、自动刷新计数、策略或订单。
- 正式域名公开 API 现返回两者 `dataStatus=cached`、`reason=null`、报告期 `2026-06-30`、申报日 `2026-08-14`；Bridgewater 997 个持仓，Third Point 43 个持仓。正式域名版本接口为 `e9574590e6c5f8b1ef81ec36908bbd95f95ae99c`，只读四市场生产巡检通过。
- 提交 `e957459` 已推送至 `codex/stock-free-data-sources` 与 `master`。
- VPS 发布标签 `guru13f-ns1-e957459-20260929`；备份 `/opt/moneymoney/backups/dist-pre-guru13f-ns1-e957459-20260929`；回滚 `/opt/moneymoney/dist.rollback-guru13f-ns1-e957459-20260929`。归档 SHA-256：`5b26d67eb01d30f866fbe1157b11ffd06142883000b7d5409b2880684d6b8fc8`。
- 本地与 VPS 文件 SHA-256 一致：`server.js` `20161b715329267342da478a39d9f576b73f4bc7dede77250f3d1853c32b6e1c`；`index.html` `ca91abbf5c0043f636cc9211e90dec6c79bcf428035cbb76e6c13997509b258f`；`guru-holdings.js` `f0a1803fa2e0493ea3e4fabf6a1b85002e46db6d6d47c502bd8ea0d9718d6a76`。
- VPS 服务 `moneymoney.service` 为 `active`，本机 health 接口返回 `alive`；新旧备份/回滚目录均保留。

# “大神持仓”双视角实现计划

> **执行约束：** 用户明确要求不使用子代理；由当前会话使用 `executing-plans` 内联逐任务实现。所有任务先写失败测试，步骤用复选框跟踪。

**目标：** 在股票工作区新增“投资人看持仓”和“热门股看持有人”两种联动视角，以 SEC EDGAR 13F 披露展示可追溯的持仓与相邻报告期股数变化。

**架构：** 复用现有 SEC 客户端和 `research.db`，新增独立 13F 解析/聚合服务与路由；SEC 报告元数据及规范化持仓持久化，比较仅使用股数，保留报告期、申报日和原文链接。股票菜单、中心工作区和右侧标的选择按现有工作区机制接线，不修改其他市场或现有 Nasdaq 数据语义。

**技术栈：** TypeScript、Express、better-sqlite3、SEC EDGAR JSON/XML、Node.js `node:test`、现有静态 HTML/JS 工作区。

---

## 文件清单与职责

### 新建

- `src/features/guru-holdings.ts`：13F XML 解析、申报期比较、CUSIP 映射、来源状态和刷新协调。
- `src/features/guru-holdings-registry.ts`：经过 SEC 核实的申报主体 CIK/展示别名，以及已核验的热门股票 CUSIP 映射。
- `tests/guru-holdings.test.cjs`：解析、报告比较、金额权重和证券映射测试。
- `tests/guru-holdings-repository.test.cjs`：研究库持久化、重启读取和报告期排序测试，数据库只使用临时目录。
- `tests/guru-holdings-api.test.cjs`：公开查询、参数校验、市场隔离和管理员刷新权限测试。

### 修改

- `src/features/sec-edgar-client.ts`：统一 CIK 规范化、13F submissions 获取和 SEC 文本/JSON 请求头。
- `src/features/research-repository.ts`：增加 13F 报告持久化表及读写方法，沿用现有 `research.db` 和 `setDbPath()` 测试注入。
- `src/features/market-workspace.ts`：注册股票专属 `guru-holdings` 工作区。
- `src/web/server.ts`：挂载三条只读查询 API，并用既有 `adminOnly` 保护强制刷新入口；启动/停止低频刷新监控。
- `src/web/public/index.html`：增加双视角面板、列表与详情渲染、状态/来源呈现及右侧选股联动。
- `tests/market-workspace-navigation.test.cjs`、`tests/market-workspace-flow.test.cjs`、`tests/stock-api.test.cjs`：覆盖菜单归属、中心区联动和 API 接线。

不修改 `data/lake/`、`data/research.db*` 或 `scratch/`；测试必须通过临时 SQLite 文件隔离运行。

## 任务 1：先锁定 13F 解析与比较规则

**文件：** 新建 `tests/guru-holdings.test.cjs`、`src/features/guru-holdings.ts`。

- [x] **步骤 1：添加纯函数失败测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse13FInformationTable, compare13FReports } = require('../dist/features/guru-holdings.js');

test('13F parser preserves CUSIP, class, shares, and reported value', () => {
  const xml = '<informationTable><infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>037833100</cusip><value>125000</value><shrsOrPrnAmt><sshPrnamt>500</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable></informationTable>';
  assert.deepEqual(parse13FInformationTable(xml), [{
    issuerName: 'APPLE INC', classTitle: 'COM', cusip: '037833100',
    reportedValue: 125000, shares: 500, putCall: null, investmentDiscretion: null,
  }]);
});

test('quarter comparison uses disclosed shares, not changing market value', () => {
  const previous = { positions: [{ cusip: '037833100', shares: 100, reportedValueUsd: 20000 }] };
  const current = { positions: [{ cusip: '037833100', shares: 120, reportedValueUsd: 18000 }] };
  const row = compare13FReports(previous, current)[0];
  assert.equal(row.change, 'increased');
  assert.equal(row.shareDelta, 20);
});

test('missing current filing is labeled not disclosed rather than sold out', () => {
  const previous = { positions: [{ cusip: '037833100', shares: 100, reportedValueUsd: 20000 }] };
  assert.equal(compare13FReports(previous, { positions: [] })[0].change, 'not-disclosed');
});
```

- [x] **步骤 2：运行新测试，确认因导出缺失而失败**

运行：`npm run build`，然后 `node --test tests/guru-holdings.test.cjs`。预期：构建成功，测试因 `guru-holdings.js` 尚无解析器导出而失败。

- [x] **步骤 3：实现最小类型、XML 解析器与相邻期比较器**

在 `guru-holdings.ts` 定义 `Guru13FPosition`、`Guru13FReport` 和 `GuruHoldingChange`。解析 `<infoTable>` 节点，保留原始 CUSIP/类别、股数、申报值、put/call 和 discretion；解析 cover page 的 amendment number/type。`RESTATEMENT` 使用修订文件替换该期基线，`ADD NEW HOLDINGS` 按申报身份合并；未知类型或无法安全合并时禁用变化比较。拒绝缺失关键值、非法数字、重复身份无法区分的输入。`compare13FReports(previous, current)` 按 CUSIP、类别和 put/call 匹配，仅比较股数；新记录输出 `newly-disclosed`，股数增减输出 `increased`/`reduced`，缺失当前记录输出 `not-disclosed`，无可靠基线输出 `unavailable`。

- [x] **步骤 4：运行解析和比较测试并提交**

运行：`npm run build`、`node --test tests/guru-holdings.test.cjs`。预期：测试通过；提交 `feat: add deterministic 13f parsing and comparison`。

## 任务 2：接入 SEC 主体目录和原始 13F 文件

**文件：** 修改 `src/features/sec-edgar-client.ts`；扩展 `tests/guru-holdings.test.cjs`。

- [x] **步骤 1：先加 CIK、申报过滤和安全归档路径测试**

```js
const { normalizeSecCik, parseSec13FSubmissions, buildSec13FArchiveUrl } = require('../dist/features/sec-edgar-client.js');

test('SEC filer lookup normalizes CIK and keeps only 13F reports', () => {
  assert.equal(normalizeSecCik('12345'), '0000012345');
  const parsed = parseSec13FSubmissions({
    name: 'Example Capital',
    filings: { recent: {
      form: ['13F-HR', '4', '13F-HR/A'],
      accessionNumber: ['0000000001-26-000001', '0000000001-26-000002', '0000000001-26-000003'],
      filingDate: ['2026-05-14', '2026-05-15', '2026-08-14'],
      reportDate: ['2026-03-31', '', '2026-06-30'],
      primaryDocument: ['primary.xml', 'form4.xml', 'amendment.xml'],
    } },
  });
  assert.deepEqual(parsed.filings.map(item => item.form), ['13F-HR', '13F-HR/A']);
  assert.equal(buildSec13FArchiveUrl('12345', '0000012345-26-000001', '../bad.xml'), null);
});
```

- [x] **步骤 2：运行测试确认新 SEC helper 缺失**

运行：`npm run build`，然后 `node --test tests/guru-holdings.test.cjs`。预期：新测试失败，既有 SEC ticker、submissions 和公司事实测试不受影响。

- [x] **步骤 3：实现共享 SEC 请求和 filings 规范化**

扩展 `SecSubmissionRecent`，读取平行的 `reportDate` 字段；导出 `normalizeSecCik()`、`parseSec13FSubmissions()`、`fetchSecText()`。仅接受合法十位 CIK 和 `13F-HR`/`13F-HR/A`，以 SEC 提供的 accession/primary document 构造归档路径；下载归档索引后只取经校验的 XML 信息表文件名，不拼接未经校验的路径。请求复用 `buildSecHeaders()`、超时和已有 SEC User-Agent 配置。金额保存原始申报数值和所用单位，并按该份 Form 13F 对应的格式规则规范化为 USD；无法确认单位时不计算金额权重。

- [x] **步骤 4：补齐成功/失败测试并提交**

运行：`npm run build`、`node --test tests/guru-holdings.test.cjs`。预期：合法 CIK/申报通过，错误 CIK、错误 XML 路径及 HTTP 失败返回明确错误；提交 `feat: load official sec 13f filings`。

## 任务 3：将申报快照持久化到现有研究数据库

**文件：** 修改 `src/features/research-repository.ts`；新建 `tests/guru-holdings-repository.test.cjs`。

- [x] **步骤 1：先写 SQLite 持久化失败测试**

测试使用 `fs.mkdtempSync(path.join(os.tmpdir(), 'moneymoney-guru-'))` 建立临时目录，调用 `setDbPath(path.join(tempDir, 'research.sqlite'))`；保存两份不同报告期的申报，关闭数据库后重新 `setDbPath()`，断言 CIK、accession、报告期、来源链接及 positions JSON 完整恢复，并按报告期倒序返回。

- [x] **步骤 2：运行测试确认 repository 方法尚不存在**

运行：`npm run build`，然后 `node --test tests/guru-holdings-repository.test.cjs`。预期：仅因 `saveGuru13FReport`/`listGuru13FReports` 缺失而失败；临时目录清理测试库及 `-wal`、`-shm`。

- [x] **步骤 3：添加幂等报告表和 repository 方法**

在 `research-repository.ts` 初始化 `guru_13f_reports(accession PRIMARY KEY, cik, report_period, filed_at, form, source_url, fetched_at, content_hash, data)`，并建 `cik, report_period DESC` 索引。增加 `saveGuru13FReport(report)`（按 accession 幂等 upsert）、`listGuru13FReports(cik, limit)`（CIK 精确过滤、限额、按报告期/申报日倒序）和 `getGuru13FReport(accession)`。不迁移或读取现有生产/用户数据库以外的路径。

- [x] **步骤 4：运行隔离数据库测试并提交**

运行：`npm run build`、`node --test tests/guru-holdings-repository.test.cjs`。预期：关闭/重开后结果一致，重复保存不会产生重复行；提交 `feat: persist sec 13f snapshots`。

## 任务 4：实现主体目录、证券映射和数据状态服务

**文件：** 新建 `src/features/guru-holdings-registry.ts`；修改 `src/features/guru-holdings.ts`；扩展 `tests/guru-holdings.test.cjs`。

- [x] **步骤 1：先添加精选主体、映射和缓存状态测试**

覆盖：精选主体的 CIK 必须是十位数字；只用已核验的 CUSIP/类别映射到股票代码；同名多类别不唯一时进入 `unmapped`；无前一期报告时返回基线缺失；缓存超过 24 小时显示 `delayed`/过期原因；来源成功但无 13F 记录返回 `empty`，HTTP/解析失败返回 `unavailable`。

- [x] **步骤 2：运行测试确认 registry/service 能力缺失**

运行：`npm run build`、`node --test tests/guru-holdings.test.cjs`。预期：新用例因尚无 registry/service 函数失败。

- [x] **步骤 3：实现有来源约束的 registry 和聚合服务**

在 `guru-holdings-registry.ts` 维护少量经 SEC CIK 和最新申报实查的申报主体条目；人物别名仅在关系可核实后加入。名字搜索匹配该核验目录，输入 CIK 可查询其他合法主体。维护热门股票的 CUSIP + 类别精确映射，不按公司名猜 ticker。`guru-holdings.ts` 提供 `listGuruManagers(query)`、`getGuruManagerSnapshot(cik)`、`getGuruStockHolders(symbol, ciks?)`、`refreshGuruManager(cik)` 和 `refreshFeaturedGuruManagers()`；复用 SEC client、researchRepository 与现有 SQLite lease，按 CIK 合并并限频请求。权重使用整份有效申报所有可解析记录的市值和（包括未映射证券）；报告不完整或单位不明时返回 null。源成功无记录与源失败分别表达。

- [x] **步骤 4：测试各类空状态、映射和重试并提交**

运行：`npm run build`、`node --test tests/guru-holdings.test.cjs`。预期：没有 SEC fixture 之外的外网依赖；提交 `feat: model guru holdings and source states`。

## 任务 5：增加股票专属 API 和安全刷新

**文件：** 新建 `src/features/guru-holdings-router.ts`；修改 `src/web/server.ts`；新建 `tests/guru-holdings-api.test.cjs`；修改 `tests/stock-api.test.cjs`。

- [x] **步骤 1：先写 API 失败测试**

用 Express 临时 app 挂载 `createGuruHoldingsRouter(service, adminOnly)` 和 stub service，验证：`GET /api/stocks/guru-holdings/managers?query=` 返回精选主体；`GET /api/stocks/guru-holdings/managers/:cik` 返回报告时点；`GET /api/stocks/guru-holdings/symbols/:symbol?ciks=...` 返回所选申报主体的匹配持有人，未传 CIK 时仅查精选主体；非法 CIK、非法股票代码返回 400；`POST /api/stocks/guru-holdings/managers/:cik/refresh` 在访客态拒绝、管理员态调用一次刷新。所有 payload 都必须为 `market: "stocks"` 且包含 `dataStatus/source/updatedAt/reason/evidenceRefs`。

- [x] **步骤 2：运行 API 测试确认路由未挂载**

运行：`npm run build`，然后 `node --test tests/guru-holdings-api.test.cjs tests/stock-api.test.cjs`。预期：新路由测试失败，既有股票 API 测试仍通过。

- [x] **步骤 3：实现路由校验、adminOnly 注入和统一状态封装**

Router 只接受股票 symbol 和十位 CIK；管理员刷新路由由 `server.ts` 注入/调用既有 `adminOnly(req,res)`，访客不能触发强制 SEC 请求。只读查询对访客可用。将三条 GET 路由挂载到现有 Express app；响应沿用项目 API envelope，不把 `empty` 转换为来源失败。

- [x] **步骤 4：验证接口隔离与权限并提交**

运行：`npm run build`、`node --test tests/guru-holdings-api.test.cjs tests/stock-api.test.cjs`。预期：股票 API 可读，options/crypto/prediction 标识、错误 CIK 和访客刷新均拒绝；提交 `feat: expose scoped guru holdings endpoints`。

## 任务 6：注册股票工作区并连接两个视角

**文件：** 修改 `src/features/market-workspace.ts`、`src/web/public/index.html`、`tests/market-workspace-navigation.test.cjs`、`tests/market-workspace-flow.test.cjs`。

- [x] **步骤 1：先加导航和页面接线失败断言**

在导航测试断言：`stocks` 包含 `guru-holdings`，其余三个市场不包含并且 `isWorkspaceAllowed('crypto','guru-holdings') === false`。在 flow 测试断言：HTML 存在 `data-workspace-id="guru-holdings"`、两个视角 tab、`loadGuruHoldings`、三个 API 路径及来源状态容器。

- [x] **步骤 2：运行两个测试确认导航/HTML 尚未更新**

运行：`npm run build`，然后 `node --test tests/market-workspace-navigation.test.cjs tests/market-workspace-flow.test.cjs`。预期：只新增断言失败。

- [x] **步骤 3：添加股票导航项和中心面板骨架**

在 `market-workspace.ts` 的 `WorkspaceId`、`ITEMS` 和股票 `SPECIFIC_ITEMS` 中新增 `guru-holdings`，标记 `scopes: ['stocks']` 且不要求当前选中标的。HTML 增加股票专属面板，包含“投资人持仓/热门股票持有人”切换、搜索框、报告状态、持仓表和原文来源区域；沿用现有扁平工作区容器样式。热门股列表使用现有 `/api/stock/market-breadth` 涨跌样本并合并股票自选；来源失败时保留自选/搜索入口并显示失败原因，不回退成硬编码热门股。

- [x] **步骤 4：接通投资人查询、热门股反查和选股跳转**

新增 `loadGuruHoldings()`、`renderGuruHoldingsManagers()`、`renderGuruHoldingsReport()`、`renderGuruStockHolders()`。按现有 `AbortController`/请求 epoch 处理过期响应；从右侧股票库选中股票时仅刷新热门股视角，选择持有人再回到其完整申报。页面把“报告期截至、申报时间、延迟披露”固定展示；`not-disclosed` 文案不写成清仓；权重明确为 13F 披露范围。只对标准化 USD 字段加货币符号，缺失值显示“—”。

- [x] **步骤 5：运行导航和 UI 合同测试并提交**

运行：`npm run build`、`node --test tests/market-workspace-navigation.test.cjs tests/market-workspace-flow.test.cjs`。预期：股票菜单出现新项，其余市场无该入口，HTML API/双视角合同断言通过；提交 `feat: add linked guru holdings workspace`。

## 任务 7：低频刷新、全量回归和浏览器验收

**文件：** 修改 `src/features/guru-holdings.ts`、`src/web/server.ts`；扩展 `tests/guru-holdings.test.cjs`、`tests/guru-holdings-api.test.cjs`。

- [ ] **步骤 1：先添加每日刷新租约和停止行为测试**

使用注入的时钟/刷新函数测试：同一自然日不重复刷新精选 CIK；已有 SQLite lease 时第二实例不发请求；刷新结束释放 lease；服务停止清理 timer；管理员手动刷新可跳过 24 小时缓存但仍受 CIK 合并与 SEC 超时约束。测试调用真实 monitor 工厂但替换 SEC fetch 和 lease 方法，不启动真实定时等待。

- [ ] **步骤 2：运行刷新测试确认缺少 monitor 导出**

运行：`npm run build`，然后 `node --test tests/guru-holdings.test.cjs`。预期：monitor 用例因 `startGuruHoldingsRefreshMonitor`/`stopGuruHoldingsRefreshMonitor` 尚不存在而失败。

- [ ] **步骤 3：实现可启停的低频刷新监控**

实现 `startGuruHoldingsRefreshMonitor()`、`stopGuruHoldingsRefreshMonitor()`，在现有服务 listen callback 启动、SIGINT/SIGTERM shutdown 中停止。每日批次串行处理精选主体，持久化最近检查时间和错误；一个主体失败不阻断其他主体。请求不记录或输出任何 SEC 密钥，公开数据仅保存到现有 research DB。

- [ ] **步骤 4：运行 monitor 测试并提交**

运行：`npm run build`、`node --test tests/guru-holdings.test.cjs`。预期：日租约、单实例、启动停止及失败隔离通过；提交 `feat: schedule low-frequency sec filing refresh`。

- [ ] **步骤 5：执行完整自动化门槛**

依次运行 `npm test`、`npm run build`、`npm run smoke:web`、`npm run smoke:browser`、`npm run security:scan`、`git diff --check`。预期：全部退出码 0；数据库测试只在系统临时目录创建并自行清理。

- [ ] **步骤 6：完成真实浏览器矩阵**

验证股票菜单入口、访客只读访问、精选主体/CIK 查询、AAPL 与一个非热门搜索股票的反查、主体与股票双向跳转、报告时间/来源链接、空状态、修订/缓存状态、移动布局；切换期权、虚拟币和预测市场后确认入口消失。确认没有把 Nasdaq 数据与 SEC 行合并，也没有模拟/真实订单入口。

- [ ] **步骤 7：提交、推送和安全部署**

确认 `git status` 中只有本功能变更待提交；绝不 stage `data/lake/`、`data/research.db*` 或 `scratch/`。按项目既有发布流程提交并推送 GitHub；随后备份当前 VPS 版本、部署构建产物、核对本地/远端 SHA-256、健康/版本接口和正式域名页面，失败立即回滚，仅操作 `moneymoney.service`。

## 发布验收清单

- 两种视角互相链接并保持 CIK/股票上下文正确。
- 显示的变化来自相邻 13F 报告股数，不由股价涨跌推断。
- 首次披露、增加、减少、未披露、映射失败和源失败各有明确状态。
- 所有 SEC 持仓链接到原文；13F 时点、45 日申报窗口、无空头披露和不完整组合限制可见。
- API 和导航严格限于股票市场；访客不能强制刷新或读取私人研究/模拟数据。
- 现有 Nasdaq 机构雷达与全部既有功能保持可用。
- 自动测试、构建、冒烟、安全、浏览器验收、GitHub 推送和 VPS Hash/健康检查全部有记录后，才能报告已部署。

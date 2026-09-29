# 13F 跨机构重合与多季度趋势实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:executing-plans` 逐任务内联实现。用户明确禁止子代理；不得调用子代理。步骤使用复选框跟踪。

**目标：** 在股票工作区基于已保存的 SEC 13F 快照，提供严格同报告期的机构持仓重合分析和申报主体最近最多四期的历史视图。

**架构：** 复用 `research.db` 中的 `guru_13f_reports`、现有有效申报修订合并逻辑和 SEC 刷新租约/限流，不新增业务数据库。领域服务只读已缓存快照并负责同周期聚合；刷新服务逐主体补齐最多四个报告期；路由返回股票作用域证据封套；现有股票工作区增加“机构重合”和机构历史展示。

**技术栈：** TypeScript、Express、better-sqlite3、静态 HTML/JavaScript、Node.js `node:test`、Playwright Chromium。

---

## 文件清单与职责

### 修改

- `src/features/guru-holdings.ts`：定义重合/历史响应类型；实现严格报告期筛选、CUSIP 身份聚合和按股数比较；扩充历史刷新窗口和历史快照读取。
- `src/features/guru-holdings-router.ts`：增加只读重合、历史路由及查询参数校验，保持手动刷新管理员保护。
- `src/web/public/index.html`：添加机构重合视图、报告期筛选、申报主体历史及状态/来源呈现。
- `tests/guru-holdings.test.cjs`：覆盖领域统计、四期历史和刷新补档行为。
- `tests/guru-holdings-api.test.cjs`：覆盖新路由、参数边界、市场封套和访客只读。
- `tests/market-workspace-flow.test.cjs`：覆盖新视图入口与 API 接线。
- `scripts/browser-market-matrix.cjs`：覆盖机构重合、季度切换、机构历史和 SEC 原文链接。

### 不修改

- 不增加 SQLite 表；沿用 `guru_13f_reports`。
- 不修改 `data/lake/`、`data/research.db*`、`scratch/`、认证配置或真实交易边界。
- 本计划不包含扩大申报主体名单或接入新股票新闻/内部人数据源；那两项另行设计。

---

### 任务 1：严格同周期的机构重合领域逻辑

**文件：** 修改 `tests/guru-holdings.test.cjs`、`src/features/guru-holdings.ts`。

- [ ] **步骤 1：先添加失败测试，定义重合结果口径**

在 `tests/guru-holdings.test.cjs` 从 `dist/features/guru-holdings.js` 引入 `aggregateGuruConsensus`，加入两个不同报告期、同 CUSIP 但不同证券类别以及 put/call 不同的 fixture。核心断言：只合并相同 `reportPeriod + CUSIP + classTitle + putCall`，且申报股数变化不使用申报市值。

```js
test('13F consensus groups only the same report period and exact security identity', () => {
  const reports = [
    { manager: { cik: '0001067983', filingName: 'Berkshire' }, report: {
      reportPeriod: '2026-06-30', filedAt: '2026-08-14', sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1067983/000106798326000001/',
      positions: [
        { issuerName: 'APPLE INC', cusip: '037833100', classTitle: 'COM', putCall: null, shares: 100, reportedValueUsd: 20000 },
        { issuerName: 'APPLE INC', cusip: '037833100', classTitle: 'CL A', putCall: null, shares: 5, reportedValueUsd: 1000 },
        { issuerName: 'APPLE INC', cusip: '037833100', classTitle: 'COM', putCall: 'Call', shares: 2, reportedValueUsd: 600 },
      ],
    }, previous: { reportPeriod: '2026-03-31', comparisonAvailable: true, positions: [
      { issuerName: 'APPLE INC', cusip: '037833100', classTitle: 'COM', putCall: null, shares: 90, reportedValueUsd: 15000 },
    ] } },
    { manager: { cik: '0001350694', filingName: 'Bridgewater' }, report: {
      reportPeriod: '2026-06-30', filedAt: '2026-08-14', sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1350694/000135069426000001/',
      positions: [{ issuerName: 'APPLE INC', cusip: '037833100', classTitle: 'COM', putCall: null, shares: 50, reportedValueUsd: 25000 }],
    }, previous: null },
    { manager: { cik: '0001040273', filingName: 'Third Point' }, report: {
      reportPeriod: '2026-03-31', filedAt: '2026-05-14', sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1040273/000104027326000001/',
      positions: [{ issuerName: 'APPLE INC', cusip: '037833100', classTitle: 'COM', putCall: null, shares: 70, reportedValueUsd: 16000 }],
    }, previous: null },
  ];

  const result = aggregateGuruConsensus(reports, '2026-06-30');
  assert.equal(result.length, 3);
  const common = result.find(row => row.classTitle === 'COM' && row.putCall === null);
  assert.equal(common.disclosedManagerCount, 2);
  assert.deepEqual(common.managers.map(row => row.change).sort(), ['increased', 'unavailable']);
  assert.equal(common.managers.find(row => row.cik === '0001067983').shareDelta, 10);
  assert.equal(common.managers.find(row => row.cik === '0001350694').shareDelta, null);
});
```

再加入 service 查询测试：mock repository 只为 Berkshire 与 Bridgewater 提供 `2026-06-30` 快照，令 `loadSubmissions` 在调用时增加计数；调用 `getGuruConsensus('2026-06-30', 'AAPL')` 后断言报告主体数为 2、缺失主体数为 registry 总数减 2、period 只匹配 `2026-06-30` 且 SEC loader 计数为 0。这样锁定“只读缓存、不串季度、不因页面查询额外请求 SEC”。

```js
test('consensus service uses saved exact-period reports without SEC network requests', () => {
  const now = new Date('2026-09-29T00:00:00.000Z');
  const cikA = '0001067983';
  const cikB = '0001350694';
  const reports = [
    { cik: cikA, accession: '0001067983-26-000001', reportPeriod: '2026-06-30', filedAt: '2026-08-14', form: '13F-HR',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1067983/000106798326000001/', fetchedAt: now.toISOString(), contentHash: 'sha256:a',
      positions: [{ issuerName: 'APPLE INC', classTitle: 'COM', cusip: '037833100', shares: 100, reportedValue: 20, reportedValueUsd: 20000, putCall: null }] },
    { cik: cikB, accession: '0001350694-26-000001', reportPeriod: '2026-06-30', filedAt: '2026-08-14', form: '13F-HR',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1350694/000135069426000001/', fetchedAt: now.toISOString(), contentHash: 'sha256:b',
      positions: [{ issuerName: 'APPLE INC', classTitle: 'COM', cusip: '037833100', shares: 50, reportedValue: 25, reportedValueUsd: 25000, putCall: null }] },
  ];
  let secCalls = 0;
  const service = createGuruHoldingsService({
    repository: { listGuru13FReports: cik => reports.filter(report => report.cik === cik) },
    stateStore: { get: () => null, set() {}, acquireLease: () => true, releaseLease: () => true },
    loadSubmissions: async () => { secCalls += 1; throw new Error('must not fetch SEC during a read query'); },
    now: () => now,
  });

  const result = service.getGuruConsensus('2026-06-30', 'AAPL');
  assert.equal(result.reportPeriod, '2026-06-30');
  assert.equal(result.reportManagerCount, 2);
  assert.equal(result.missingManagerCount, GURU_MANAGER_REGISTRY.length - 2);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].disclosedManagerCount, 2);
  assert.equal(secCalls, 0);
});
```

- [ ] **步骤 2：构建并运行新测试，确认 RED**

运行：

```powershell
npm run build
node --test tests/guru-holdings.test.cjs
```

预期：新增用例因 `aggregateGuruConsensus` 尚未导出而失败；既有测试不回归。

- [ ] **步骤 3：添加类型和最小聚合实现**

在 `src/features/guru-holdings.ts` 增加 `GuruConsensusManagerRow`、`GuruConsensusRow` 和纯函数 `aggregateGuruConsensus(reports, reportPeriod)`。每条 manager row 返回 `cik`、机构展示名、`reportPeriod`、`filedAt`、`sourceUrl`、`shares`、`previousShares`、`shareDelta` 和 `change`。按规范化 CUSIP/类别/putCall 分组；排除报告期不匹配和 `comparisonAvailable === false` 的报告；使用 `compare13FReports` 计算变化；代码映射只调用 `resolveGuruMappingByCusip`。

```ts
export interface GuruConsensusManagerRow {
  cik: string;
  filingName: string;
  personAssociation?: string;
  reportPeriod: string;
  filedAt: string;
  sourceUrl: string;
  shares: number | null;
  previousShares: number | null;
  shareDelta: number | null;
  change: GuruHoldingChangeKind;
}

export interface GuruConsensusRow {
  cusip: string;
  classTitle: string;
  putCall: string | null;
  issuerName: string;
  symbol: string | null;
  disclosedManagerCount: number;
  managers: GuruConsensusManagerRow[];
}

export interface GuruConsensusSnapshot {
  market: 'stocks';
  instrument: string | null;
  reportPeriod: string | null;
  availableReportPeriods: string[];
  trackedManagerCount: number;
  reportManagerCount: number;
  missingManagerCount: number;
  unavailableManagerCount: number;
  partialManagerCount: number;
  staleManagerCount: number;
  incomparableManagerCount: number;
  dataStatus: GuruHoldingsDataStatus;
  source: string;
  updatedAt: string | null;
  reason: string | null;
  evidenceRefs: string[];
  rows: GuruConsensusRow[];
}

export function aggregateGuruConsensus(
  reports: Array<{ manager: GuruManagerDefinition; report: Guru13FReport; previous: Guru13FReport | null }>,
  reportPeriod: string,
): GuruConsensusRow[] {
  const groups = new Map<string, GuruConsensusRow>();
  for (const entry of reports) {
    if (entry.report.reportPeriod !== reportPeriod || entry.report.comparisonAvailable === false) continue;
    const sourceUrl = entry.report.informationTableUrl || entry.report.sourceUrl || '';
    for (const change of compare13FReports(entry.previous, entry.report)) {
      const identity = positionIdentity(change);
      let row = groups.get(identity);
      if (!row) {
        row = {
          cusip: change.cusip,
          classTitle: change.classTitle,
          putCall: change.putCall,
          issuerName: change.issuerName,
          symbol: resolveGuruMappingByCusip(change.cusip, change.classTitle)?.symbol || null,
          disclosedManagerCount: 0,
          managers: [],
        };
        groups.set(identity, row);
      }
      row.managers.push({
        cik: entry.manager.cik,
        filingName: entry.manager.filingName,
        ...(entry.manager.personAssociation ? { personAssociation: entry.manager.personAssociation } : {}),
        reportPeriod,
        filedAt: entry.report.filedAt || '',
        sourceUrl,
        shares: change.currentShares,
        previousShares: change.previousShares,
        shareDelta: change.shareDelta,
        change: change.change,
      });
    }
  }
  return [...groups.values()].map(row => ({
    ...row,
    disclosedManagerCount: row.managers.filter(manager => manager.shares != null).length,
    managers: row.managers.sort((a, b) => a.filingName.localeCompare(b.filingName) || a.cik.localeCompare(b.cik)),
  })).sort((a, b) => b.disclosedManagerCount - a.disclosedManagerCount
    || String(a.symbol || a.cusip).localeCompare(String(b.symbol || b.cusip))
    || a.classTitle.localeCompare(b.classTitle));
}
```

将 `getGuruConsensus(period?, symbol?)` 一并加入 `createGuruHoldingsService`：只从 `GURU_MANAGER_REGISTRY` 和仓库快照构造输入，列出实际可用的 distinct periods；缺省选择最新已保存期间；筛选 `symbol` 时只采用已核验 CUSIP/class 映射。返回 `GuruConsensusSnapshot` 中的 tracked/report/missing/incomparable 数量、dataStatus、原因、更新时间和 SEC 证据链接。API 页面查询不得调用 `loadSubmissions` 或 `loadDocuments`。重合行排序按披露主体数降序，再按已映射 ticker、CUSIP 稳定排序。申报市值不得参与变化分类。

```ts
function getGuruConsensus(periodInput?: string, symbolInput?: string): GuruConsensusSnapshot {
  const snapshots = GURU_MANAGER_REGISTRY.map(manager => ({
    manager,
    reports: effectiveGuruReports(repository.listGuru13FReports(manager.cik, 500)),
    snapshot: getGuruManagerSnapshot(manager.cik),
  }));
  const availableReportPeriods = [...new Set(snapshots.flatMap(item => item.reports.map(report => report.reportPeriod || '')))]
    .filter(Boolean).sort((a, b) => b.localeCompare(a));
  const reportPeriod = periodInput || availableReportPeriods[0] || null;
  const matching = reportPeriod ? snapshots.flatMap(item => {
    const index = item.reports.findIndex(report => report.reportPeriod === reportPeriod);
    return index < 0 ? [] : [{ manager: item.manager, report: item.reports[index], previous: item.reports[index + 1] || null }];
  }) : [];
  const usable = matching.filter(item => item.report.comparisonAvailable !== false);
  const unavailableManagerCount = snapshots.filter(item => item.snapshot.dataStatus === 'unavailable').length;
  const partialManagerCount = snapshots.filter(item => item.snapshot.dataStatus === 'partial').length;
  const staleManagerCount = matching.filter(item => item.snapshot.dataStatus === 'delayed').length;
  const unmappedSymbol = Boolean(symbolInput && !GURU_STOCK_MAPPINGS.some(item => item.symbol === symbolInput.toUpperCase()));
  const rows = reportPeriod ? aggregateGuruConsensus(usable, reportPeriod)
    .filter(row => !symbolInput || row.symbol === symbolInput.toUpperCase()) : [];
  const missingManagerCount = GURU_MANAGER_REGISTRY.length - matching.length;
  const incomparableManagerCount = matching.length - usable.length;
  const updatedAt = matching.map(item => item.report.fetchedAt || '').filter(Boolean).sort().at(-1) || null;
  const dataStatus: GuruHoldingsDataStatus = !reportPeriod
    ? snapshots.every(item => item.snapshot.dataStatus === 'empty') ? 'empty' : 'unavailable'
    : matching.length === 0 ? 'empty'
      : missingManagerCount || unavailableManagerCount || partialManagerCount || staleManagerCount || incomparableManagerCount ? 'partial' : 'cached';
  const reason = !reportPeriod ? '尚无已保存的 13F 报告期。'
    : unmappedSymbol ? '该股票尚无已核验的 CUSIP/证券类别映射，不能猜测持仓。'
      : matching.length === 0 ? '该报告期没有已保存的有效申报。'
        : missingManagerCount || unavailableManagerCount || partialManagerCount || staleManagerCount || incomparableManagerCount
          ? '部分申报主体缺报、来源不可用、缓存过期或修订不可比较；未使用其他报告期填充。' : null;
  return {
    market: 'stocks', instrument: symbolInput || null, reportPeriod, availableReportPeriods,
    trackedManagerCount: GURU_MANAGER_REGISTRY.length, reportManagerCount: matching.length,
    missingManagerCount, unavailableManagerCount, partialManagerCount, staleManagerCount, incomparableManagerCount,
    dataStatus, source: GURU_SOURCE, updatedAt, reason,
    evidenceRefs: [...new Set(usable.flatMap(item => [item.report.sourceUrl || '', item.report.informationTableUrl || '']).filter(Boolean))],
    rows,
  };
}
```

实现中还要对未核验 `symbol` 映射返回明确 unavailable 原因；若结果为部分成功，保留有效 rows 并保留缺失/不确定计数。

- [ ] **步骤 4：运行领域测试确认 GREEN**

运行：`npm run build`，随后 `node --test tests/guru-holdings.test.cjs`。预期新增用例与该文件全部测试通过。

- [ ] **步骤 5：提交领域逻辑**

```powershell
git add -- src/features/guru-holdings.ts tests/guru-holdings.test.cjs
git diff --cached --check
git commit -m "feat: aggregate same-period 13F holdings"
```

### 任务 2：每主体四期历史和有界补档

**文件：** 修改 `tests/guru-holdings.test.cjs`、`src/features/guru-holdings.ts`。

- [ ] **步骤 1：添加失败测试，锁定四期边界与幂等补档**

测试注入 mock repository 和 SEC dependencies：submission fixtures 含五个报告期，并为最新报告期加入一个 RESTATEMENT amendment；调用 `refreshGuruManager` 后断言只处理最新四个不同报告期、历史返回四期且 amendment 替代该期原始表、重复强制刷新不重复下载已有 accession。

```js
test('13F refresh backfills at most four distinct periods and history deduplicates amendments', async () => {
  const cik = '0001067983';
  const persisted = [];
  const downloaded = [];
  const states = new Map();
  const periods = ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'];
  const filingDates = ['2026-08-14', '2026-05-14', '2026-02-14', '2025-11-14', '2025-08-14'];
  const filings = periods.map((reportPeriod, index) => ({
    form: '13F-HR', accessionNumber: `${cik}-26-${String(index + 1).padStart(6, '0')}`,
    filingDate: filingDates[index], reportPeriod, primaryDocument: 'primary.xml',
    sourceUrl: `https://www.sec.gov/Archives/edgar/data/1067983/${`${cik}-26-${String(index + 1).padStart(6, '0')}`.replace(/-/g, '')}/`,
  }));
  filings.push({
    form: '13F-HR/A', accessionNumber: `${cik}-26-000006`, filingDate: '2026-08-15', reportPeriod: '2026-06-30',
    primaryDocument: 'amendment.xml', sourceUrl: `https://www.sec.gov/Archives/edgar/data/1067983/${`${cik}-26-000006`.replace(/-/g, '')}/`,
  });
  const repository = {
    listGuru13FReports: cik => persisted.filter(report => report.cik === cik),
    saveGuru13FReport: report => persisted.push(report),
  };
  const service = createGuruHoldingsService({
    repository,
    stateStore: {
      get: key => states.get(key) || null,
      set: (key, value) => states.set(key, value),
      acquireLease: () => true,
      releaseLease: () => true,
    },
    loadSubmissions: async queryCik => ({ cik: queryCik, companyName: 'Berkshire Hathaway Inc.', filings }),
    loadDocuments: async (_queryCik, filing) => {
      downloaded.push(filing.accessionNumber);
      const base = filing.sourceUrl;
      const shares = filing.form === '13F-HR/A' ? 120 : 100;
      return {
        informationTableXml: `<informationTable><infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>037833100</cusip><value>125000</value><shrsOrPrnAmt><sshPrnamt>${shares}</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable></informationTable>`,
        coverPageXml: filing.form === '13F-HR/A'
          ? '<coverPage><isAmendment>true</isAmendment><amendmentNo>1</amendmentNo><amendmentType>RESTATEMENT</amendmentType></coverPage>'
          : '<coverPage><isAmendment>false</isAmendment></coverPage>',
        informationTableUrl: `${base}infotable.xml`,
        sourceUrl: base,
      };
    },
    now: () => new Date('2026-09-29T00:00:00.000Z'),
  });

  await service.refreshGuruManager(cik, true);
  assert.equal(new Set(persisted.map(report => report.reportPeriod)).size, 4);
  assert.equal(persisted.some(report => report.reportPeriod === '2025-06-30'), false);
  const history = service.getGuruManagerHistory(cik, 4);
  assert.equal(history.reports.length, 4);
  assert.equal(history.reports[0].form, '13F-HR/A');
  assert.equal(history.reports[0].positions[0].shares, 120);
  await service.refreshGuruManager(cik, true);
  assert.equal(downloaded.length, 5);
});
```

- [ ] **步骤 2：运行新测试确认 RED**

运行：`npm run build`，随后 `node --test tests/guru-holdings.test.cjs`。预期因为刷新仍只取两个报告期且历史方法未定义而失败。

- [ ] **步骤 3：实现历史读取与四期刷新**

给 `GuruHoldingsServiceDependencies` 所用 service 返回值增加 `getGuruManagerHistory(cik, limit)`；CIK 继续走 `normalizeSecCik`，`limit` 限制为 1–4。历史按 `effectiveGuruReports(repository.listGuru13FReports(cik, 500))` 生成，每个有效报告期只保留修订规则处理后的结果。将刷新选取的 distinct `reportPeriod` 数从 2 改为 4，保留每个报告期内的 amendment 及现有 SEC 队列、租约、失败原因和部分成功状态。

```ts
function getGuruManagerHistory(cikInput: string, limitInput = 4) {
  const cik = normalizeSecCik(cikInput);
  const limit = Math.max(1, Math.min(4, Math.floor(Number(limitInput) || 4)));
  const reports = effectiveGuruReports(repository.listGuru13FReports(cik, 500)).slice(0, limit);
  return { ...getGuruManagerSnapshot(cik), reports, availableReportCount: reports.length, requestedLimit: limit };
}
```

- [ ] **步骤 4：运行领域与持久化测试确认 GREEN**

运行：`npm run build`，随后 `node --test tests/guru-holdings.test.cjs tests/guru-holdings-repository.test.cjs tests/guru-holdings-monitor.test.cjs`。预期历史报告期去重、重启读取、失败后保留旧快照和刷新租约测试全部通过。

- [ ] **步骤 5：提交历史存取**

```powershell
git add -- src/features/guru-holdings.ts tests/guru-holdings.test.cjs
git diff --cached --check
git commit -m "feat: retain four periods of 13F history"
```

### 任务 3：只读机构重合和历史 API

**文件：** 修改 `src/features/guru-holdings-router.ts`、`tests/guru-holdings-api.test.cjs`。

- [ ] **步骤 1：添加失败 API 测试**

测试 `/consensus?reportPeriod=2026-06-30&symbol=AAPL` 把相同筛选传给 service，响应固定 `market: stocks`；测试 `/managers/0001067983/history?limit=4` 返回至多四期；拒绝无效日期、无效股票代码和 `limit=5`。另断言访客可以 `GET` 历史而既有 `POST /refresh` 仍返回 403。

```js
test('consensus and manager history are public read-only stock-scoped endpoints', async () => {
  const calls = [];
  const service = {
    getGuruConsensus: (period, symbol) => { calls.push(['consensus', period, symbol]); return envelope({ reportPeriod: period, rows: [] }); },
    getGuruManagerHistory: (cik, limit) => { calls.push(['history', cik, limit]); return envelope({ reports: [] }); },
  };
  await withApi(service, false, async base => {
    const consensus = await fetch(`${base}/consensus?reportPeriod=2026-06-30&symbol=AAPL`).then(r => r.json());
    const history = await fetch(`${base}/managers/0001067983/history?limit=4`).then(r => r.json());
    assert.equal(consensus.market, 'stocks');
    assert.equal(history.market, 'stocks');
    assert.deepEqual(calls, [['consensus', '2026-06-30', 'AAPL'], ['history', '0001067983', 4]]);
  });
});
```

- [ ] **步骤 2：运行新 API 测试确认 RED**

运行：`npm run build`，随后 `node --test tests/guru-holdings-api.test.cjs`。预期新路由返回 404，确认测试确实覆盖缺失行为。

- [ ] **步骤 3：添加路由 service 方法和输入校验**

为 `GuruHoldingsRouteService` 增加 `getGuruConsensus(period?, symbol?)` 和 `getGuruManagerHistory(cik, limit?)`。在 `GET /managers/:cik` 前注册更具体的 `/managers/:cik/history`；报告期只接受真实日历日期 `YYYY-MM-DD`，股票只接受现有股票代码正则，`limit` 接受 1–4，缺省为 4。`consensus` 永远使用 `envelope()` 的股票市场封套，不开放写操作。

```ts
function isValidReportPeriod(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

router.get('/consensus', (req, res) => {
  if (req.query.reportPeriod != null && typeof req.query.reportPeriod !== 'string') return routeError(res, 400, '报告期参数无效');
  if (req.query.symbol != null && typeof req.query.symbol !== 'string') return routeError(res, 400, '股票代码参数无效');
  const reportPeriod = typeof req.query.reportPeriod === 'string' ? req.query.reportPeriod : undefined;
  const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim().toUpperCase() : undefined;
  if (reportPeriod && !isValidReportPeriod(reportPeriod)) return routeError(res, 400, '报告期必须为有效 YYYY-MM-DD 日期');
  if (symbol && !/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) return routeError(res, 400, '股票代码无效');
  return res.json(envelope(service.getGuruConsensus(reportPeriod, symbol), symbol || null));
});

router.get('/managers/:cik/history', (req, res) => {
  const cik = normalizeCikPath(req.params.cik);
  if (!cik) return routeError(res, 400, 'CIK 必须为 1 至 10 位正整数');
  const rawLimit = req.query.limit == null ? '4' : typeof req.query.limit === 'string' ? req.query.limit : '';
  const limit = Number(rawLimit);
  if (!/^\d+$/.test(rawLimit) || !Number.isInteger(limit) || limit < 1 || limit > 4) {
    return routeError(res, 400, 'limit 必须为 1 至 4 的整数');
  }
  return res.json(envelope(service.getGuruManagerHistory(cik, limit), null));
});
```

- [ ] **步骤 4：运行 API 测试确认 GREEN**

运行：`npm run build`，随后 `node --test tests/guru-holdings-api.test.cjs`。预期新旧 API、访客读权限、管理员刷新边界和跨市场封套测试全部通过。

- [ ] **步骤 5：提交 API**

```powershell
git add -- src/features/guru-holdings-router.ts tests/guru-holdings-api.test.cjs
git diff --cached --check
git commit -m "feat: expose 13F consensus and history APIs"
```

### 任务 4：股票工作区机构重合与历史页面

**文件：** 修改 `src/web/public/index.html`、`tests/market-workspace-flow.test.cjs`、`scripts/browser-market-matrix.cjs`。

- [ ] **步骤 1：添加失败静态和浏览器断言**

`tests/market-workspace-flow.test.cjs` 先断言新增 `data-guru-view="consensus"`、`/consensus` 和 `/history` 接线。浏览器 mock 为 manager 返回四期历史，为 consensus 返回同一期两家管理人持有 AAPL 的事实 fixture；浏览器断言可切换报告期、看到持有人数及 SEC 链接，并从列表打开 Berkshire 历史。

```js
test('Guru holdings exposes same-period consensus and multi-period history views', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/web/public/index.html'), 'utf8');
  assert.match(html, /data-guru-view="consensus"/);
  assert.match(html, /guru-holdings\/consensus/);
  assert.match(html, /guru-holdings\/managers\/.*history/);
});
```

- [ ] **步骤 2：运行新断言确认 RED**

运行：`npm run build`，随后 `node --test tests/market-workspace-flow.test.cjs`。预期新增静态断言失败；浏览器 mock 若先运行，也应因没有新按钮而失败。

- [ ] **步骤 3：接通视图按钮、报告期筛选和历史渲染**

在大神持仓现有两按钮旁增加“机构重合”；视图状态仍限制在 `managers / stocks / consensus`，共享搜索框在该视图作为可选股票代码过滤器，空值代表查看所有已映射证券。重合视图仅调用新 GET API，展示样本覆盖、精确期间、机构列表、股数与变化、证券映射状态和安全 SEC 链接；点机构进入对应机构详情。投资人详情调用 history GET API，展示实际可用报告期数量、逐期来源和申报链接；不以空季度占位。沿用 `marketResearchEscape` 和 `guruSecureSecUrl`，所有外链使用 `target="_blank" rel="noopener noreferrer"`。

```html
<button type="button" class="tab" data-guru-view="consensus" onclick="setGuruHoldingsView('consensus')">机构重合</button>
<select id="guru-holdings-report-period" aria-label="13F报告期" onchange="loadGuruConsensus()"></select>
```

```js
async function loadGuruConsensus() {
  if (activeMarketScope !== 'stocks') return;
  const period = document.getElementById('guru-holdings-report-period')?.value || '';
  const response = await fetch(`/api/stocks/guru-holdings/consensus?reportPeriod=${encodeURIComponent(period)}`, { credentials: 'include', cache: 'no-store' });
  const payload = await response.json();
  renderGuruConsensus(payload);
}
```

实现需沿用现有 request token，市场切换或视图切换后丢弃旧响应；上面片段规定入口，渲染函数负责失败、empty、partial、cached 和 unavailable 状态。

- [ ] **步骤 4：运行工作区和真实浏览器矩阵**

运行：`npm run build`；`node --test tests/market-workspace-flow.test.cjs`；`npm run smoke:browser`。预期股票工作区两条原路径仍工作，新重合/历史页面可交互，期权、虚拟币、预测市场仍不显示大神持仓。

- [ ] **步骤 5：提交 UI 与浏览器验收**

```powershell
git add -- src/web/public/index.html tests/market-workspace-flow.test.cjs scripts/browser-market-matrix.cjs
git diff --cached --check
git commit -m "feat: add 13F consensus and manager history views"
```

### 任务 5：全量验收与安全发布

**文件：** 修改仅限本计划前述源文件/测试；部署通过现有发布脚本完成。

- [ ] **步骤 1：运行完整项目门禁**

运行并保存原始结果：

```powershell
npm test
npm run build
npm run smoke:web
npm run smoke:browser
npm run smoke:auth
npm run security:scan
git diff --check
```

预期全部成功；`npm test` 的统计应为零失败。任何失败先定位修复，不允许跳过后宣称完成。

- [ ] **步骤 2：验证真实生产只读数据**

部署前使用既有只读生产 canary 检查正式域名、构建版本、股票市场接口和既有公开 SEC 数据，确认当前生产基线健康。新 API 的同报告期隔离、机构历史上限、SEC 原文域名及访客权限先由本地 API/浏览器矩阵验证，再在部署后复核。绝不调用刷新写接口作为 guest，不提交模拟/真实订单。

- [ ] **步骤 3：构建固定 release 并记录哈希**

仅使用当前 worktree 的已验证提交构建；记录 build ID 与 release 归档 SHA-256。确认 `git status` 中 `data/lake/`、`data/research.db*` 和 `scratch/` 仍未跟踪且未暂存。

- [ ] **步骤 4：提交最终修复并推送 GitHub**

若验证产生修复，先按上述测试/实现顺序提交；确认工作分支和 `master` 可快进后推送，拒绝时先 fetch/核对，不强推、不改写历史。

- [ ] **步骤 5：备份、部署并验证当前 VPS**

使用 `scripts/deploy-vps-dist.sh` 对现有 `/opt/moneymoney/dist` 原子部署；仅操作 `moneymoney.service` 和 `dist`。确认自动备份/回滚目录、新旧产物哈希、service active、`/api/health/live`、正式域名 `/api/health/version` 和浏览器视图一致；用访客只读请求验证 `/consensus` 与 `/managers/:cik/history?limit=4` 的股票作用域、季度、上限、SEC 链接和真实空状态。失败时按部署脚本自动回滚并检查，不触碰运行数据库、Nginx、TLS、Telegram 密钥或相邻服务。

- [ ] **步骤 6：交付说明**

在最终答复分别报告：功能分支/master 提交、测试门禁原始结果、生产 API/UI 验收、release Hash、备份和回滚路径，以及未解决限制。明确注明 13F 为季度滞后披露、不代表实时持仓。

---

## 计划自检

- 规格“目标与边界、同报告期身份、四期历史、来源状态、浏览器动作、访客只读和真实交易关闭”均由任务 1–5 覆盖。
- 数据持久化继续使用现有 `guru_13f_reports`；不新增数据库表，也不触碰运行数据库文件。
- 计划中没有 CUSIP 猜测、跨季度拼接、以市值变化推断买卖、实盘执行或子代理任务。
- 每个业务变更先加失败测试，再实现，并安排对应定向测试和最终全量门禁。

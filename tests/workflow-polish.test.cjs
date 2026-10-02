const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const page = fs.readFileSync('src/web/public/index.html', 'utf8');
const server = fs.readFileSync('src/web/server.ts', 'utf8');
const { buildBacktestPreflight } = require('../dist/features/backtest-preflight.js');
const { assessResearchFreshness } = require('../dist/features/research-freshness.js');

test('backtest preflight counts valid unique bars and refuses cross-market identities', () => {
  const bars = Array.from({ length: 14 }, (_, index) => ({
    time: Date.UTC(2026, 0, index + 1), open: 10, high: 11, low: 9, close: 10.5, volume: 100,
  }));
  const ready = buildBacktestPreflight({ market: 'stocks', instrument: 'AAPL', bars, source: 'test-source', lookback: 8, holding: 5 });
  assert.equal(ready.dataStatus, 'ready');
  assert.equal(ready.availableBars, 14);
  assert.equal(ready.requiredBars, 14);
  assert.equal(ready.source, 'test-source');
  assert.match(ready.calendarNote, /不推断/);
  const duplicate = buildBacktestPreflight({ market: 'stocks', instrument: 'AAPL', bars: [...bars, bars[0]], source: 'test-source', lookback: 8, holding: 5 });
  assert.equal(duplicate.availableBars, 14);
  const conflictingDuplicate = buildBacktestPreflight({ market: 'stocks', instrument: 'AAPL', bars: [...bars, { ...bars[0], close: 10.75 }], source: 'test-source', lookback: 8, holding: 5 });
  assert.equal(conflictingDuplicate.dataStatus, 'unavailable');
  assert.match(conflictingDuplicate.reason, /异常 OHLCV/);
  const crossed = buildBacktestPreflight({ market: 'crypto', instrument: 'AAPL', bars, source: 'wrong', lookback: 8, holding: 5 });
  assert.equal(crossed.dataStatus, 'unsupported');
  assert.match(crossed.reason, /市场/);
  const malformed = buildBacktestPreflight({ market: 'stocks', instrument: 'AAPL', bars: [{ ...bars[0], low: 12 }], source: 'test-source', lookback: 1, holding: 1 });
  assert.equal(malformed.dataStatus, 'unavailable');
  const sourceFailed = buildBacktestPreflight({ market: 'stocks', instrument: 'AAPL', bars: [], source: 'test-source', sourceStatus: 'unavailable', sourceError: 'timeout', lookback: 1, holding: 1 });
  assert.match(sourceFailed.reason, /来源不可用.*timeout/);
  const sourceEmpty = buildBacktestPreflight({ market: 'stocks', instrument: 'AAPL', bars: [], source: 'test-source', sourceStatus: 'live', lookback: 1, holding: 1 });
  assert.match(sourceEmpty.reason, /成功响应但没有/);
});

test('freshness is unknown without a pinned data snapshot and stale only for matching later evidence', () => {
  const base = {
    market: 'stocks', instrument: 'stock:us:AAPL', timeframe: '1d', createdAt: '2026-01-10T00:00:00.000Z',
    revisions: [], corporateActions: [], strategyVersion: '1', currentStrategyVersion: '1',
  };
  assert.equal(assessResearchFreshness(base).status, 'unknown');
  const pinned = { ...base, dataSnapshotHash: 'a'.repeat(64) };
  assert.equal(assessResearchFreshness(pinned).status, 'current');
  const revised = assessResearchFreshness({ ...pinned, revisions: [
    { market: 'stocks', instrument: 'AAPL', timeframe: '1d', dataset: 'bars', publishedAt: '2026-01-11T00:00:00.000Z', contentHash: 'hash-b' },
    { market: 'crypto', instrument: 'BTCUSDT', timeframe: '1d', dataset: 'bars', publishedAt: '2026-01-12T00:00:00.000Z', contentHash: 'hash-c' },
  ] });
  assert.equal(revised.status, 'stale');
  assert.equal(revised.findings.length, 1);
  const action = assessResearchFreshness({ ...pinned, corporateActions: [
    { market: 'stocks', instrument: 'AAPL', effectiveAt: '2026-01-12T00:00:00.000Z', kind: 'split' },
  ] });
  assert.equal(action.status, 'stale');
  const strategy = assessResearchFreshness({ ...pinned, currentStrategyVersion: '2' });
  assert.equal(strategy.status, 'stale');
});

test('backtest performs a same-market bar coverage preflight before starting the run', () => {
  assert.match(server, /app\.get\('\/api\/backtest\/preflight'/);
  assert.match(server, /buildBacktestPreflight/);
  const runBacktest = page.slice(page.indexOf('async function runBacktest()'), page.indexOf('function drawEquityChart'));
  assert.match(runBacktest, /preflightAssetBacktest[\s\S]*?\/api\/backtest/);
  assert.match(page, /id="backtest-data-preflight"/);
  assert.match(server, /scope === 'stocks'[\s\S]*?stockDataService\.overview/);
  assert.match(server, /scope === 'crypto'[\s\S]*?binanceFeed\.getKlines/);
});

test('research freshness reports later revisions and corporate actions without guessing a snapshot match', () => {
  assert.match(server, /app\.get\('\/api\/research\/experiments\/:id\/freshness'/);
  assert.match(server, /assessResearchFreshness/);
  const pageCandidates = page.slice(page.indexOf('function renderBacktestCandidates'), page.indexOf('window.toggleBacktestCandidates'));
  assert.match(pageCandidates, /refreshBacktestCandidateFreshness/);
  assert.match(page, /人工复跑/);
  assert.match(page, /快照未固定|无法验证/);
});

require('ts-node/register/transpile-only');
test('backfill deduplication preserves requested ranges and enforces queue budget',()=>{
 const os=require('node:os'),path=require('node:path');const {DataLakeCatalog}=require('../src/storage/data-lake');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mm-backfill-budget-'));const catalog=new DataLakeCatalog({lakeRoot:path.join(root,'lake'),databasePath:path.join(root,'catalog.sqlite')});
 try{const input={market:'stocks',dataset:'bars',instrument:'AAPL',timeframe:'1d',from:'2026-01-01',to:'2026-02-01'};const first=catalog.createBackfill(input);assert.equal(catalog.createBackfill(input).id,first.id);assert.notEqual(catalog.createBackfill({...input,to:'2026-02-02'}).id,first.id);for(let day=3;day<=16;day++)catalog.createBackfill({...input,to:'2026-02-'+String(day).padStart(2,'0')});assert.throws(()=>catalog.createBackfill({...input,to:'2026-03-01'}),/预算/);}finally{catalog.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('metric explanation distinguishes unknown, false, true and unusable sources per clause',()=>{
 const {explainMetricConditions}=require('../src/features/unified-alerts');
 const condition={join:'all',clauses:[{field:'price',operator:'gte',value:100},{field:'rsi',operator:'lte',value:30}]};
 const result=explainMetricConditions(condition,{kind:'metric',metrics:{price:110},dataStatus:'delayed'});
 assert.equal(result[0].matched,true);assert.equal(result[1].matched,false);assert.match(result[1].reason,/缺失/);
 const stale=explainMetricConditions(condition,{kind:'metric',metrics:{price:110,rsi:20},dataStatus:'cached'});assert.ok(stale.every(row=>!row.matched));
});
test('guru disclosed concentration requires complete values and holding streak breaks at missing quarters',()=>{
 const guru=require('../src/web/public/guru-replay.js'),security={cusip:'037833100',classTitle:'COM',shareAmountType:'SH',shares:2,reportedValueUsd:100};
 const reports=[{cik:'1',reportPeriod:'2025-12-31',positions:[security]},{cik:'1',reportPeriod:'2026-03-31',positions:[security]},{cik:'1',reportPeriod:'2026-09-30',positions:[security]}];
 assert.equal(guru.reportAnalytics(reports,1).holdings[0].consecutiveQuarters,2);assert.equal(guru.reportAnalytics(reports,2).holdings[0].consecutiveQuarters,1);assert.equal(guru.reportAnalytics(reports,2).top10WeightPct,100);
 reports[2].positions.push({...security,cusip:'02079K305',reportedValueUsd:null});assert.equal(guru.reportAnalytics(reports,2).top10WeightPct,null);
});
test('unknown corporate adjustment preserves raw evidence and verified unadjusted splits produce comparable returns',async()=>{
 const {assembleHistory}=require('../src/features/portfolio-history');
 const rows=[{timestamp:'2026-09-20T20:00:00Z',close:100},{timestamp:'2026-09-21T20:00:00Z',close:50},{timestamp:'2026-09-22T20:00:00Z',close:55}];
 const catalog={queryBarsAsOf:async()=>({rows,source:'source',adjustment:'unadjusted'}),listCorporateActions:()=>[{id:'split1',kind:'split',factor:2,effectiveAt:'2026-09-21T00:00:00Z',publishedAt:'2026-09-19T00:00:00Z',source:'SEC'}]};
 const result=await assembleHistory(catalog,'stocks',['stock:us:AAPL'],'2026-09-30T00:00:00Z');assert.equal(result.series[0].points[0].close,50);assert.equal(result.series[0].points[2].value,10);assert.equal(result.series[0].rawPoints[0].close,100);
 catalog.queryBarsAsOf=async()=>({rows,source:'unknown'});const blocked=await assembleHistory(catalog,'stocks',['stock:us:AAPL'],'2026-09-30T00:00:00Z');assert.equal(blocked.series[0].rawPoints.length,3);assert.equal(blocked.series[0].datedReturns.length,0);
});

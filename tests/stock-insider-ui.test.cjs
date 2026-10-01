const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('src/web/public/index.html', 'utf8');
const renderSource = html.match(/function renderInsiderRadar\(data\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(renderSource, 'renderInsiderRadar should exist in the stock workspace');

function render(data) {
  const target = { innerHTML: '' };
  const document = { getElementById: id => id === 'insider-radar' ? target : null };
  const context = {
    document,
    URL,
    safeNewsText: value => String(value ?? ''),
    stockEscapeHtml: value => String(value ?? ''),
    compactUsd: value => Number(value || 0).toFixed(0),
    workspaceInlineRefresh: () => '<button>刷新</button>',
  };
  vm.runInNewContext(`${renderSource}; renderInsiderRadar(input);`, { ...context, input: data });
  return target.innerHTML;
}

const noData = {
  symbol: 'MU', companyName: 'Micron', windowDays: 90, scannedFilings: 4,
  dataStatus: 'unavailable', reason: 'SEC Form 4 原文 4/4 下载失败',
  signalZh: '买卖信号均衡', adviceZh: '当前买卖较为平衡', confidence: 0,
  buyValueUsd: 0, sellValueUsd: 0, netValueUsd: 0, buyCount: 0, sellCount: 0,
  planSellRatio: 0, ownerCount: 0, transactions: [],
};

test('unavailable Form 4 renders the source failure without fabricated zero-activity analysis', () => {
  const result = render(noData);
  assert.match(result, /SEC Form 4 来源不可用/);
  assert.match(result, /SEC Form 4 原文 4\/4 下载失败/);
  assert.doesNotMatch(result, /信号置信度|解读：|买入偏积极|买卖信号均衡|净额/);
  assert.doesNotMatch(result, /\$0/);
});

test('empty Form 4 result explains no records without presenting zero totals as a signal', () => {
  const result = render({ ...noData, dataStatus: 'empty', reason: 'SEC 已响应；近 90 天没有可解析记录' });
  assert.match(result, /暂无可解析记录/);
  assert.match(result, /SEC 已响应；近 90 天没有可解析记录/);
  assert.doesNotMatch(result, /信号置信度|解读：|净额|\$0/);
});

test('available Form 4 transactions retain the insider activity summary', () => {
  const result = render({
    ...noData,
    dataStatus: 'live', reason: null, signalZh: '买入偏积极', adviceZh: '买入申报高于卖出', confidence: 42,
    transactions: [{ action: 'BUY', ownerName: 'Jane Doe', ownerTitleZh: '高管·CFO', transactionDate: '2026-09-24', shares: 10, priceUsd: 12, valueUsd: 120, plan10b5: false, sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1/0001/form4.xml' }],
  });
  assert.match(result, /信号置信度 42\/100/);
  assert.match(result, /Jane Doe/);
  assert.match(result, /净额/);
  assert.match(result, /href="https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/1\/0001\/form4\.xml"[^>]*>SEC 原文 ↗/);
});

test('insider transaction source links reject non-SEC and non-HTTPS URLs', () => {
  const result = render({
    ...noData,
    dataStatus: 'live', reason: null,
    transactions: [{ action: 'BUY', ownerName: 'Jane Doe', ownerTitleZh: '高管·CFO', transactionDate: '2026-09-24', shares: 10, priceUsd: 12, valueUsd: 120, plan10b5: false, sourceUrl: 'javascript:alert(1)' }],
  });
  assert.doesNotMatch(result, /href="javascript:/);
  assert.doesNotMatch(result, /SEC 原文 ↗/);
});

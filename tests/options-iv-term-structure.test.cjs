const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { getEquityOptionsSnapshot, getOptionsSnapshot } = require('../dist/features/options-market.js');

function cboeOption(symbol, expiry, type, strike, iv, bid = 1, ask = 1.1) {
  const strikeCode = String(Math.round(strike * 1000)).padStart(8, '0');
  return {
    option: `${symbol}${expiry}${type === 'call' ? 'C' : 'P'}${strikeCode}`,
    bid,
    ask,
    volume: 10,
    open_interest: 20,
    iv,
  };
}

async function withCboeOptions(symbol, options, run) {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ data: { current_price: 100, options } }),
  });
  try {
    return await run(await getEquityOptionsSnapshot(symbol));
  } finally {
    global.fetch = originalFetch;
  }
}

test('CBOE snapshot exposes an ATM IV term structure using same-expiry, same-strike call/put pairs', async () => {
  await withCboeOptions('TERM', [
    cboeOption('TERM', '261218', 'call', 100, 0.3),
    cboeOption('TERM', '261218', 'put', 100, 0.4),
    cboeOption('TERM', '261218', 'call', 90, 0.8),
    cboeOption('TERM', '261218', 'put', 110, 0.9),
    cboeOption('TERM', '270115', 'call', 102, 0.35),
    cboeOption('TERM', '270115', 'put', 102, 0.45),
  ], snapshot => {
    const structure = snapshot.ivTermStructure;
    assert.equal(structure.status, 'available');
    assert.equal(structure.source, snapshot.source);
    assert.equal(structure.fetchedAt, snapshot.fetchedAt);
    assert.deepEqual(structure.points.map(point => point.atmStrike), [100, 102]);
    assert.deepEqual(structure.points.map(point => point.callIvPct), [30, 35]);
    assert.deepEqual(structure.points.map(point => point.putIvPct), [40, 45]);
    assert.deepEqual(structure.points.map(point => point.putMinusCallPp), [10, 10]);
    assert.ok(structure.points.every(point => point.pairedContracts === 2));
  });
});

test('Deribit snapshot uses its own real chain and keeps its IV values source-bound', async () => {
  const originalFetch = global.fetch;
  const expiryMs = Date.UTC(2026, 11, 18, 8);
  const names = ['BTC-18DEC26-100-C', 'BTC-18DEC26-100-P'];
  global.fetch = async url => {
    const address = String(url);
    const result = address.includes('get_index_price') ? { price: 100 }
      : address.includes('get_instruments') ? names.map(instrument_name => ({ kind: 'option', instrument_name, expiration_timestamp: expiryMs }))
        : names.map((instrument_name, index) => ({ instrument_name, bid_price: 0.009, ask_price: 0.0095, volume: 10, open_interest: 20, mark_iv: index ? 44 : 42 }));
    return { ok: true, json: async () => ({ result }) };
  };
  try {
    const snapshot = await getOptionsSnapshot('BTC');
    assert.equal(snapshot.ivTermStructure.source, 'Deribit Public API');
    assert.equal(snapshot.ivTermStructure.status, 'available');
    assert.equal(snapshot.ivTermStructure.points[0].callIvPct, 42);
    assert.equal(snapshot.ivTermStructure.points[0].putIvPct, 44);
    assert.equal(snapshot.ivTermStructure.points[0].putMinusCallPp, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('ATM IV term structure does not combine neighboring strikes or different expiries', async () => {
  await withCboeOptions('TIVY', [
    cboeOption('TIVY', '261218', 'call', 100, 0.3),
    cboeOption('TIVY', '261218', 'put', 101, 0.4),
    cboeOption('TIVY', '270115', 'put', 100, 0.5),
  ], snapshot => {
    assert.equal(snapshot.ivTermStructure.status, 'unavailable');
    assert.match(snapshot.ivTermStructure.reason, /同一到期日、同一行权价/);
    assert.equal(snapshot.ivTermStructure.points.length, 0);
  });
});

test('ATM IV term structure excludes stale-looking wide/unquoted contracts and out-of-band strikes', async () => {
  await withCboeOptions('TIVZ', [
    cboeOption('TIVZ', '261218', 'call', 100, 0.3, 0, 0),
    cboeOption('TIVZ', '261218', 'put', 100, 0.4, 1, 2),
    cboeOption('TIVZ', '270115', 'call', 104, 0.3),
    cboeOption('TIVZ', '270115', 'put', 104, 0.4),
  ], snapshot => {
    assert.equal(snapshot.ivTermStructure.status, 'unavailable');
    assert.match(snapshot.ivTermStructure.reason, /近 ATM|双边有效报价/);
    assert.equal(snapshot.ivTermStructure.points.length, 0);
  });
});

test('options workspace renders the current-chain term structure as a scoped data panel', () => {
  const source = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
  const server = fs.readFileSync('src/web/server.ts', 'utf8');
  const renderer = source.match(/function renderOptionIvTermStructure\([\s\S]*?\n\}/)?.[0];
  assert.ok(renderer, 'the options workspace should render a dedicated term-structure panel');
  assert.match(renderer, /ivTermStructure/);
  assert.match(renderer, /来源|source/);
  assert.match(renderer, /缺失|不可用/);
  assert.ok(renderer.includes('不构成价格预测'));
  assert.match(source, /renderOptionIvTermStructure\(optionsSnapshot\)/);
  assert.ok(server.includes("req.query.metadata === '1'"), 'snapshot list has a compact metadata mode for the UI');
  assert.ok(server.includes('compareOptionSnapshotPair(snapshots, fromId, toId)'), 'comparison API accepts only the two selected real snapshot IDs');
});

test('term-structure panel shows source-bound measurements and explicit missing-expiry reasons', () => {
  const source = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
  const renderer = source.match(/function renderOptionIvTermStructure\([\s\S]*?\n\}/)?.[0];
  const dom = new JSDOM('<div id="option-iv-term-structure"></div>');
  const context = {
    document: dom.window.document,
    stockEscapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'),
  };
  const snapshot = {
    ivTermStructure: {
      status: 'partial', source: 'CBOE Delayed Quotes', fetchedAt: '2026-10-12T01:00:00.000Z',
      maxMoneynessPct: 3, coveredExpiries: 2, totalExpiries: 3, coveragePct: 66.7,
      points: [{ label: '2026-12-18', daysToExpiry: 67, atmStrike: 100, moneynessPct: 0, callIvPct: 30,
        putIvPct: 40, atmIvPct: 35, putMinusCallPp: 10, pairedContracts: 2, expiryMs: 1 },
      { label: '2027-03-19', daysToExpiry: 158, atmStrike: 100, moneynessPct: 0.5, callIvPct: 24,
        putIvPct: 28, atmIvPct: 26, putMinusCallPp: 4, pairedContracts: 2, expiryMs: 3 }],
      missingExpiries: [{ label: '2027-01-15', daysToExpiry: 95, expiryMs: 2, reason: '近 ATM 合约缺少有效 IV 或双边报价 <bad>' }],
      reason: '2/3 个到期日有有效配对；其余到期日未纳入曲线',
    },
  };
  const historyLoader = source.match(/async function loadOptionIvSnapshotHistory\([\s\S]*?\n\}/)?.[0];
  assert.ok(historyLoader, 'the options workspace should offer actual snapshot comparison');
  vm.runInNewContext(`${renderer}; renderOptionIvTermStructure(snapshot);`, { ...context, snapshot, window: dom.window, Intl });
  const panel = dom.window.document.querySelector('.option-iv-term');
  assert.match(panel.textContent, /部分覆盖 · 2\/3 个到期日 · 66\.7%/);
  assert.match(panel.textContent, /CBOE Delayed Quotes/);
  assert.match(panel.textContent, /30\.00%/);
  assert.match(panel.textContent, /\+10\.00 个百分点/);
  assert.match(panel.textContent, /24\.00%/);
  assert.match(panel.textContent, /近 ATM 合约缺少有效 IV 或双边报价 <bad>/);
  assert.equal(panel.querySelector('tr.is-unavailable').querySelector('td[colspan="5"]').innerHTML.includes('&lt;bad&gt;'), true);
  assert.equal(panel.querySelectorAll('circle[data-expiry-ms]').length, 6, 'the plotted call/put/ATM samples exactly match the two measured expiries');
  assert.equal(panel.querySelectorAll('path.option-iv-series').length, 0, 'the missing middle expiry breaks lines rather than interpolating across the gap');
  assert.equal(panel.querySelectorAll('tbody tr:not(.is-unavailable)').length, 2, 'table keeps only the two measured expiries');
  assert.equal(panel.querySelector('[data-iv-view="curve"]').getAttribute('aria-pressed'), 'true');
  panel.querySelector('[data-iv-view="table"]').click();
  assert.equal(panel.querySelector('.option-iv-chart').hidden, true);
  assert.equal(panel.querySelector('.option-iv-table').hidden, false);
  panel.querySelector('[data-option-iv-evidence]').click();
  assert.equal(panel.querySelector('[data-option-iv-evidence-detail]').hidden, false);
  assert.match(panel.querySelector('[data-option-iv-evidence-detail]').textContent, /CBOE Delayed Quotes/);
  assert.match(source, /loadOptionIvSnapshotHistory\(optionsSnapshot\)/);
  assert.match(source, /data-option-iv-snapshot-before/);
  assert.match(source, /data-option-iv-snapshot-after/);
  assert.match(source, /fromId/);
  dom.window.close();
});

test('options history UI compares exactly the selected two real snapshots and renders source-bound deltas', async () => {
  const source = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
  const loader = source.match(/async function loadOptionIvSnapshotHistory\([\s\S]*?\n\}/)?.[0];
  const identityHelper = source.match(/function optionSnapshotInstrument\([\s\S]*?\n\}/)?.[0];
  assert.ok(loader);
  assert.ok(identityHelper);
  const dom = new JSDOM('<div id="option-iv-history"></div>');
  const snapshot = { asset: 'AAPL', market: 'us_equity', source: 'CBOE Delayed Quotes' };
  const fetches = [];
  const context = {
    document: dom.window.document,
    optionsSnapshot: snapshot,
    optionHistoryRequestId: 0,
    URLSearchParams,
    stockEscapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'),
    fetch: async url => {
      fetches.push(String(url));
      if (String(url).startsWith('/api/options/history?')) return { ok: true, json: async () => ({ success: true, data: [
        { id: 'snapshot-old', instrument: 'option:cboe:AAPL', source: snapshot.source, fetchedAt: '2026-10-10T14:00:00.000Z', tradeDate: '2026-10-10', contentHash: 'old-hash' },
        { id: 'snapshot-new', instrument: 'option:cboe:AAPL', source: snapshot.source, fetchedAt: '2026-10-11T14:00:00.000Z', tradeDate: '2026-10-11', contentHash: 'new-hash' },
        { id: 'other-source', instrument: 'option:cboe:AAPL', source: 'Other Provider', fetchedAt: '2026-10-12T14:00:00.000Z', tradeDate: '2026-10-12', contentHash: 'other-hash' },
      ] }) };
      return { ok: true, json: async () => ({ success: true, source: snapshot.source, data: { changes: [{ fromAt: '2026-10-10T14:00:00.000Z', toAt: '2026-10-11T14:00:00.000Z', contracts: [{ contract: 'AAPL261218C00100000', fields: { impliedVolPct: { before: 30, after: 35, delta: 5 }, bidPrice: { before: 1, after: 1.2, delta: 0.2 }, askPrice: { before: 1.1, after: 1.3, delta: 0.2 }, volume: { before: 10, after: 12, delta: 2 }, openInterest: { before: 20, after: 22, delta: 2 } } }] }] } }) };
    },
  };
  vm.runInNewContext(`${identityHelper}; ${loader}; loadOptionIvSnapshotHistory(snapshot);`, { ...context, snapshot, window: dom.window });
  for (let i = 0; i < 10 && !dom.window.document.querySelector('[data-option-iv-compare]'); i++) await new Promise(resolve => setTimeout(resolve, 0));
  const before = dom.window.document.querySelector('[data-option-iv-snapshot-before]');
  const after = dom.window.document.querySelector('[data-option-iv-snapshot-after]');
  assert.ok(before && after);
  assert.equal(before.options.length, 2, 'a different provider must not be mixed into this comparison');
  assert.equal(before.value, 'snapshot-old');
  assert.equal(after.value, 'snapshot-new');
  dom.window.document.querySelector('[data-option-iv-compare]').click();
  for (let i = 0; i < 10 && !dom.window.document.querySelector('[data-option-iv-compare-output]').textContent.includes('AAPL261218C00100000'); i++) await new Promise(resolve => setTimeout(resolve, 0));
  const output = dom.window.document.querySelector('[data-option-iv-compare-output]');
  assert.match(output.textContent, /AAPL261218C00100000/);
  assert.match(output.textContent, /30 → 35/);
  assert.match(output.textContent, /CBOE Delayed Quotes/);
  assert.equal(fetches.length, 2);
  assert.match(fetches[1], /fromId=snapshot-old/);
  assert.match(fetches[1], /toId=snapshot-new/);
  dom.window.close();
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { assessOptionQuoteQuality, calculateOptionPayoff, getEquityOptionsSnapshot } = require('../dist/features/options-market.js');
test('multi-leg payoff reports quote age/skew and spread crossing but never represents the estimate as executable',()=>{
 const nowMs=Date.UTC(2026,9,17),row={instrumentName:'SPY-20271014-100-C',strike:100,optionType:'call',bidPrice:10,askPrice:12,quoteQuality:{status:'quoted'},expiryMs:nowMs+86400000,quoteTime:new Date(nowMs).toISOString()};
 const result=calculateOptionPayoff({spot:100,multiplier:100,nowMs,legs:[{row,action:'buy',contracts:1},{row:{...row,instrumentName:'SPY-20271014-110-C',strike:110,quoteTime:new Date(nowMs-90000).toISOString()},action:'sell',contracts:1}]});
 assert.equal(result.quoteAudit.quoteSkewMs,90000);assert.equal(result.quoteAudit.maxAgeMs,90000);assert.equal(result.quoteAudit.spreadCrossingVsMidUsd,200);assert.equal(result.quoteAudit.executable,false);
 assert.equal(result.quoteAudit.legs.length,2);assert.equal(result.quoteAudit.legs[0].referencePrice,12);assert.match(result.quoteAudit.reason,/不同步|同步/);
});
test('option payoff workspace displays quote skew, quote ages and non-executable status',()=>{
 const source=require('./helpers/dashboard-source.cjs').readDashboardSource();assert.match(source,/audit\.dataset\.optionQuoteAudit/);assert.match(source,/data\.quoteAudit\.quoteSkewMs/);assert.match(source,/data\.quoteAudit\.legs/);
});

test('price/time/IV scenarios use declared model assumptions and actual quote-side entry costs with deterministic results',()=>{
 const {calculateOptionScenario}=require('../dist/features/options-market.js');assert.equal(typeof calculateOptionScenario,'function');
 const nowMs=Date.UTC(2026,9,14),expiryMs=nowMs+365.25*86400000,quoteTime=new Date(nowMs).toISOString();
 const row=type=>({instrumentName:'SPY-20271014-100-'+(type==='call'?'C':'P'),strike:100,optionType:type,bidPrice:10,askPrice:11,quoteQuality:{status:'quoted'},expiryMs,quoteTime,impliedVolPct:20});
 const input={spot:100,multiplier:100,legs:[{row:row('call'),action:'buy',contracts:1},{row:row('put'),action:'buy',contracts:1}],nowMs,underlyingSymbol:'SPY',scenario:{spotShockPct:0,elapsedDays:0,ivShiftPctPoints:0,ratePct:5,dividendYieldPct:0,feePerContractUsd:1}};
 const a=calculateOptionScenario(input),b=calculateOptionScenario(input);assert.deepEqual(a,b);assert.equal(a.executionEnabled,false);
 assert.ok(Math.abs(a.legs[0].modelPrice-10.450584)<.00001);assert.ok(Math.abs(a.legs[1].modelPrice-5.573526)<.00001);
 assert.equal(a.entryPremiumUsd,2200);assert.equal(a.entryFeesUsd,2);assert.ok(Math.abs(a.pnlUsd-(-599.589))<.02);assert.ok(a.greeks.gamma>0);assert.ok(a.greeks.vegaPerPctPoint>0);
 const expired=calculateOptionScenario({...input,scenario:{...input.scenario,elapsedDays:365.25,spotShockPct:10}});assert.equal(expired.legs[0].modelPrice,10);assert.equal(expired.legs[1].modelPrice,0);assert.equal(expired.greeks,null);
 assert.throws(()=>calculateOptionScenario({...input,scenario:{...input.scenario,elapsedDays:366}}),/到期/);
 assert.throws(()=>calculateOptionScenario({...input,scenario:{...input.scenario,ratePct:undefined}}),/假设/);
 assert.throws(()=>calculateOptionScenario({...input,legs:[{...input.legs[0],row:{...input.legs[0].row,impliedVolPct:null}},input.legs[1]]}),/IV/);
 assert.throws(()=>calculateOptionScenario({...input,scenario:{...input.scenario,spotShockPct:-100}}),/范围/);
});

test('options builder exposes explicit three-variable model assumptions but does not request a scenario without them',async()=>{
 const html=require('./helpers/dashboard-source.cjs').readDashboardSource(),render=html.match(/function renderOptionPayoffBuilder\(expiry\) \{[\s\S]*?\n\}/)[0];const dom=new JSDOM('<div id="option-payoff-builder"></div>');let calls=0;
 const snapshot={market:'us_equity',asset:'SPY',source:'CBOE Delayed Quotes',fetchedAt:new Date().toISOString(),spot:100};const expiry={expiryMs:Date.now()+86400000,rows:[100,110].map(strike=>({instrumentName:'SPY-20271014-'+strike+'-C',strike,optionType:'call',bidPrice:1,askPrice:1.1,quoteQuality:{status:'quoted'}}))};
 try{vm.runInNewContext(render+';renderOptionPayoffBuilder(expiry);',{document:dom.window.document,optionsSnapshot:snapshot,expiry,stockEscapeHtml:value=>String(value??''),fetch:async()=>{calls++;return {ok:false,json:async()=>({success:false,reason:'fixture'})};}});const checkbox=dom.window.document.querySelector('[data-option-scenario-enabled]');assert.ok(checkbox);checkbox.checked=true;dom.window.document.querySelector('[data-multiplier]').value='100';dom.window.document.querySelector('[data-calculate]').click();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(calls,0);assert.match(dom.window.document.querySelector('[data-result]').textContent,/假设/);}finally{dom.window.close();}
});

test('missing option OI remains unknown, blocks dependent aggregates and preserves source-confirmed zero', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ data: {
      current_price: 100,
      options: [
        { option: 'TEST261218C00100000', bid: 1, ask: 1.2, volume: 0, iv: 0.25, gamma: 0.1 },
        { option: 'TEST261218P00100000', bid: 1, ask: 1.2, volume: 0, open_interest: 0, iv: 0.3, gamma: 0.1 },
      ],
    } }),
  });
  try {
    const snapshot = await getEquityOptionsSnapshot('TEST');
    const expiry = snapshot.expiries[0];
    assert.equal(expiry.callOpenInterest, null, 'missing call OI must not become a real zero');
    assert.equal(expiry.putOpenInterest, 0, 'an explicit source zero must remain zero');
    assert.equal(expiry.putCallOIRatio, null, 'PCR must be unavailable when either side is incomplete');
    assert.equal(expiry.maxPainStrike, null, 'max pain must not aggregate an incomplete OI chain');
    assert.equal(snapshot.totalCallOpenInterest, null, 'the cross-expiry aggregate must remain unknown');
    assert.equal(snapshot.totalPutOpenInterest, 0, 'known zero aggregate must remain zero');
    assert.equal(expiry.callVolume, 0, 'explicit zero volume is valid');
    assert.equal(expiry.strategyIdeas.length, 0, 'scores depending on incomplete OI must be withheld');
    assert.match(expiry.strategyIdeasStatus.reason, /OI/);
    assert.equal(expiry.dataQuality.openInterest.status, 'partial');
  } finally {
    global.fetch = originalFetch;
  }
});

test('missing ATM IV with complete OI withholds IV-dependent strategy scores', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ data: {
      current_price: 100,
      options: [
        { option: 'TSTS261218C00100000', bid: 1, ask: 1.2, volume: 4, open_interest: 10, gamma: 0.1 },
        { option: 'TSTS261218P00100000', bid: 1, ask: 1.2, volume: 5, open_interest: 12, iv: 0.3, gamma: 0.1 },
      ],
    } }),
  });
  try {
    const snapshot = await getEquityOptionsSnapshot('TSTS');
    const expiry = snapshot.expiries[0];
    assert.equal(expiry.dataQuality.openInterest.status, 'complete');
    assert.equal(expiry.dataQuality.impliedVolatility.status, 'partial');
    assert.equal(expiry.strategyIdeas.length, 0);
    assert.match(expiry.strategyIdeasStatus.reason, /隐含波动率/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('missing Gamma with complete OI and ATM IV withholds GEX-dependent strategy scores', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ data: {
      current_price: 100,
      options: [
        { option: 'GEXM261218C00100000', bid: 1, ask: 1.2, volume: 4, open_interest: 10, iv: 0.25 },
        { option: 'GEXM261218P00100000', bid: 1, ask: 1.2, volume: 5, open_interest: 12, iv: 0.3, gamma: 0.1 },
      ],
    } }),
  });
  try {
    const snapshot = await getEquityOptionsSnapshot('GEXM');
    const expiry = snapshot.expiries[0];
    assert.equal(expiry.dataQuality.openInterest.status, 'complete');
    assert.equal(expiry.dataQuality.impliedVolatility.status, 'complete');
    assert.equal(expiry.dataQuality.gammaExposure.status, 'partial');
    assert.equal(expiry.strategyIdeas.length, 0);
    assert.match(expiry.strategyIdeasStatus.reason, /Gamma|GEX/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('option quote quality distinguishes executable two-sided prices, wide spreads and missing quotes', () => {
  assert.deepEqual(assessOptionQuoteQuality({ bidPrice: 1.9, askPrice: 2.1, spreadPct: 10, volume: 20, openInterest: 100 }), {
    status: 'quoted', label: '双边报价可见', referenceAsk: 2.1, referenceBid: 1.9,
  });
  assert.equal(assessOptionQuoteQuality({ bidPrice: 1, askPrice: 2, spreadPct: 66.67, volume: 1, openInterest: 2 }).status, 'wide-spread');
  assert.equal(assessOptionQuoteQuality({ bidPrice: 0, askPrice: 0, spreadPct: null, volume: 0, openInterest: 0 }).status, 'unquoted');
  assert.equal(assessOptionQuoteQuality({ bidPrice: 1, askPrice: 1.1, spreadPct: 9.5, volume: null, openInterest: 10 }).status, 'metrics-incomplete');
});

test('option metric rendering shows unknown as unavailable but keeps a confirmed zero visible', () => {
  const source = require('./helpers/dashboard-source.cjs').readDashboardSource();
  const helper = source.match(/function optionMetric\(value\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper, 'option metrics should use an explicit null-aware formatter');
  const context = { compactUsd: value => `$${Number(value).toFixed(2)}` };
  vm.runInNewContext(`${helper}; globalThis.result = [optionMetric(null), optionMetric(0)];`, context);
  assert.deepEqual(Array.from(context.result), ['--', '$0.00']);
});

test('option payoff remains available from fresh two-sided quotes when nonessential OI or volume fields are missing', () => {
  const nowMs = Date.now();
  const row = { instrumentName: 'SPY261218C00100000', strike: 100, optionType: 'call', bidPrice: 1, askPrice: 1.1,
    quoteQuality: { status: 'metrics-incomplete' }, expiryMs: nowMs + 86_400_000, quoteTime: new Date(nowMs).toISOString() };
  const result = calculateOptionPayoff({ spot: 100, multiplier: 100, nowMs, legs: [
    { row, action: 'buy', contracts: 1 },
    { row: { ...row, instrumentName: 'SPY261218P00100000', optionType: 'put' }, action: 'sell', contracts: 1 },
  ] });
  assert.equal(result.executionEnabled, false);
  assert.equal(result.netPremiumUsd, 10);
});

test('option payoff uses verified bid/ask sides and computes capped vertical-spread risk', () => {
  const quoteTime = new Date().toISOString();
  const call = (strike, bidPrice, askPrice) => ({
    instrumentName: `SPY-20261218-${strike}-C`, strike, optionType: 'call', bidPrice, askPrice,
    quoteQuality: { status: 'quoted' }, expiryMs: Date.UTC(2026, 11, 18), quoteTime,
  });
  const result = calculateOptionPayoff({
    spot: 100,
    multiplier: 100,
    legs: [
      { row: call(100, 4.8, 5), action: 'buy', contracts: 1 },
      { row: call(110, 2, 2.2), action: 'sell', contracts: 1 },
    ],
  });
  assert.equal(result.netPremiumUsd, 300);
  assert.equal(result.payoffAtSpotUsd, -300);
  assert.equal(result.maxLossUsd, 300);
  assert.equal(result.maxGainUsd, 700);
  assert.ok(result.breakEvenPrices.some(price => Math.abs(price - 103) < 1e-8));
  assert.equal(result.curve.find(point => point.underlyingPrice === 120).pnlUsd, 700);
  assert.equal(result.executionEnabled, false);
});

test('option payoff rejects mixed underlyings even when expiry and quote quality match', () => {
  const nowMs = Date.now();
  const quoteTime = new Date(nowMs).toISOString();
  const row = symbol => ({ instrumentName: `${symbol}261218C00100000`, strike: 100, optionType: 'call', bidPrice: 1, askPrice: 1.1,
    quoteQuality: { status: 'quoted' }, expiryMs: Date.UTC(2026, 11, 18), quoteTime });

  assert.throws(() => calculateOptionPayoff({ spot: 100, multiplier: 100, nowMs, legs: [
    { row: row('SPY'), action: 'buy', contracts: 1 },
    { row: row('AAPL'), action: 'sell', contracts: 1 },
  ] }), /同一底层标的/);
});

test('option payoff binds contract identities to the requested underlying symbol', () => {
  const nowMs = Date.now();
  const quoteTime = new Date(nowMs).toISOString();
  const row = { instrumentName: 'SPY261218C00100000', strike: 100, optionType: 'call', bidPrice: 1, askPrice: 1.1,
    quoteQuality: { status: 'quoted' }, expiryMs: Date.UTC(2026, 11, 18), quoteTime };

  assert.throws(() => calculateOptionPayoff({ spot: 100, multiplier: 100, nowMs, underlyingSymbol: 'AAPL', legs: [
    { row, action: 'buy', contracts: 1 },
    { row: { ...row, instrumentName: 'SPY261218P00100000', optionType: 'put' }, action: 'sell', contracts: 1 },
  ] }), /与请求标的不一致/);
});

test('options payoff route binds every leg to the requested CBOE underlying', () => {
  const server = fs.readFileSync('src/web/server.ts', 'utf8');
  assert.match(server, /const input = \{ spot: snapshot\.spot, multiplier, legs, underlyingSymbol: symbol, nowMs:Date\.now\(\) \}/);
  assert.match(server, /calculateOptionPayoff\(input\)/);
  assert.match(server, /calculateOptionScenario\(\{\.\.\.input,scenario:req\.body\.scenario\}\)/);
});

test('options payoff API accepts intact two-sided prices even when nonessential liquidity metrics are missing',()=>{
  const source=fs.readFileSync('src/web/server.ts','utf8'),start=source.indexOf("app.post('/api/options/payoff'"),end=source.indexOf("app.",start+10),route=source.slice(start,end);
  assert.match(route,/\['quoted',\s*'metrics-incomplete'\]\.includes\(row\.quoteQuality\?\.status/);
});

test('option payoff fails closed for missing quotes, mixed expiries and invalid multipliers', () => {
  const row = { instrumentName: 'SPY-C', strike: 100, optionType: 'call', bidPrice: 1, askPrice: 1.1, quoteQuality: { status: 'unquoted' }, expiryMs: 1, quoteTime: new Date().toISOString() };
  assert.throws(() => calculateOptionPayoff({ spot: 100, multiplier: 100, legs: [{ row, action: 'buy', contracts: 1 }, { row, action: 'sell', contracts: 1 }] }), /双边有效报价/);
  const quoted = { ...row, quoteQuality: { status: 'quoted' } };
  assert.throws(() => calculateOptionPayoff({ spot: 100, multiplier: 100, legs: [
    { row: quoted, action: 'buy', contracts: 1 },
    { row: { ...quoted, expiryMs: 2 }, action: 'sell', contracts: 1 },
  ] }), /同一到期日/);
  assert.throws(() => calculateOptionPayoff({ spot: 100, multiplier: 100, legs: [
    { row: { ...quoted, expiryMs: undefined }, action: 'buy', contracts: 1 },
    { row: { ...quoted, expiryMs: undefined }, action: 'sell', contracts: 1 },
  ] }), /同一到期日/);
  assert.throws(() => calculateOptionPayoff({ spot: 100, multiplier: 0, legs: [{ row: quoted, action: 'buy', contracts: 1 }, { row: quoted, action: 'sell', contracts: 1 }] }), /乘数/);
});

test('option payoff rejects missing, stale or future quote timestamps and expired contracts', () => {
  const nowMs = Date.now();
  const row = { instrumentName: 'SPY261218C00100000', strike: 100, optionType: 'call', bidPrice: 1, askPrice: 1.1,
    quoteQuality: { status: 'quoted' }, expiryMs: nowMs + 86_400_000, quoteTime: new Date(nowMs).toISOString() };
  const legs = [{ row, action: 'buy', contracts: 1 }, { row, action: 'sell', contracts: 1 }];

  assert.throws(() => calculateOptionPayoff({ spot: 100, multiplier: 100, legs: legs.map(leg => ({ ...leg, row: { ...row, quoteTime: undefined } })), nowMs }), /报价抓取时间/);
  assert.throws(() => calculateOptionPayoff({ spot: 100, multiplier: 100, legs: legs.map(leg => ({ ...leg, row: { ...row, quoteTime: new Date(nowMs - 300_001).toISOString() } })), nowMs }), /超过 5 分钟/);
  assert.throws(() => calculateOptionPayoff({ spot: 100, multiplier: 100, legs: legs.map(leg => ({ ...leg, row: { ...row, quoteTime: new Date(nowMs + 60_001).toISOString() } })), nowMs }), /未来/);
  assert.throws(() => calculateOptionPayoff({ spot: 100, multiplier: 100, legs: legs.map(leg => ({ ...leg, row: { ...row, expiryMs: nowMs - 1 } })), nowMs }), /到期日已过/);
});

test('option payoff UI requires a verified contract multiplier before requesting a result', async () => {
  const html = require('./helpers/dashboard-source.cjs').readDashboardSource();
  const renderSource = html.match(/function renderOptionPayoffBuilder\(expiry\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(renderSource, 'option payoff builder should be wired to the options workspace');
  const dom = new JSDOM('<div id="option-payoff-builder"></div>', { runScripts: 'outside-only' });
  let requestCount = 0;
  const optionsSnapshot = {
    market: 'us_equity', asset: 'AAPL', source: 'CBOE Delayed Quotes', fetchedAt: new Date().toISOString(), spot: 100,
  };
  const expiry = { expiryMs: Date.now() + 86_400_000, rows: [
    { instrumentName: 'AAPL261013C00100000', strike: 100, optionType: 'call', bidPrice: 1, askPrice: 1.1, quoteQuality: { status: 'quoted' } },
    { instrumentName: 'AAPL261013P00100000', strike: 100, optionType: 'put', bidPrice: 1, askPrice: 1.1, quoteQuality: { status: 'quoted' } },
  ] };
  const context = {
    document: dom.window.document, optionsSnapshot, expiry,
    stockEscapeHtml: value => String(value ?? ''),
    fetch: async () => { requestCount += 1; return { ok: false, json: async () => ({ success: false, reason: 'unexpected request' }) }; },
  };
  vm.runInNewContext(`${renderSource}; renderOptionPayoffBuilder(expiry);`, context);
  const multiplier = dom.window.document.querySelector('[data-multiplier]');
  assert.equal(multiplier.value, '', 'unknown CBOE contract multipliers must not default to 100');
  dom.window.document.querySelector('[data-calculate]').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(requestCount, 0);
  assert.match(dom.window.document.querySelector('[data-result]').textContent, /先核实.*乘数/);
  dom.window.close();
});

test('option payoff late responses cannot populate a newly selected asset', async () => {
  const source=require('./helpers/dashboard-source.cjs').readDashboardSource().match(/function renderOptionPayoffBuilder\(expiry\) \{[\s\S]*?\n\}/)[0];
  const dom=new JSDOM('<div id="option-payoff-builder"></div>');let resolveResponse;
  const snapshot={market:'us_equity',asset:'AAPL',spot:100};
  const expiry={expiryMs:Date.now()+86400000,rows:['CALL','PUT'].map((instrumentName,index)=>({instrumentName,strike:100,optionType:index?'put':'call',bidPrice:1,askPrice:2,quoteQuality:{status:'quoted'}}))};
  const context={document:dom.window.document,optionsSnapshot:snapshot,expiry,stockEscapeHtml:value=>String(value??''),fetch:()=>new Promise(resolve=>{resolveResponse=resolve;})};
  try {vm.runInNewContext(source+';renderOptionPayoffBuilder(expiry);',context);dom.window.document.querySelector('[data-multiplier]').value='100';dom.window.document.querySelector('[data-calculate]').click();context.optionsSnapshot={...snapshot,asset:'MSFT'};resolveResponse({ok:false,json:async()=>({success:false,reason:'stale AAPL response'})});await new Promise(resolve=>setTimeout(resolve,0));assert.doesNotMatch(dom.window.document.querySelector('[data-result]').textContent,/stale AAPL response/);}finally{dom.window.close();}
});

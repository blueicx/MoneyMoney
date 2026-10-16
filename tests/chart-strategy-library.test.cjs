const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const file = 'src/web/public/chart-strategies.js';
const library = fs.existsSync(file) ? require('../' + file) : {};
const analysis = require('../src/web/public/chart-analysis.js');
const ids = ['macdCross','emaPullback','donchianBreakout','bollingerSqueeze','stochasticReversal','cciReversal','obvConfirmation','atrBreakout','sessionVwap','volumeBreakoutV2'];
const start = Date.parse('2026-10-15T00:00:00Z');
const rows = values => values.map((close, i) => ({ time:start+i*60000, open:close, high:close+.1, low:close-.1, close, volume:100 }));
// Long trend legs with shorter pullbacks exercise both trend and oscillator rules.
const wave = rows(Array.from({length:350}, (_,i)=>100+Math.sin(i*.04)*25+Math.sin(i*.5)*4));
wave.forEach((b,i)=>b.volume=100+(i%3)*100);
const context = { market:'crypto', timeframe:'1m', exchangeTimeZone:'UTC', sessionStartMinutes:0 };

test('versioned strategy catalog contains nine additions plus strict volume v2, all opt-in',()=>{
  assert.equal(typeof library.evaluateStrategies, 'function');
  assert.deepEqual(library.STRATEGY_CATALOG.map(s=>s.id), ids);
  assert.ok(library.STRATEGY_CATALOG.every(s=>s.version&&s.label&&s.description&&s.parameters));
  assert.deepEqual(library.evaluateStrategies(wave, {}, context).signals, []);
});

test('new directional algorithms emit both directions with traceable parameters and do not mutate input',()=>{
  const before=JSON.stringify(wave);
  for(const id of ids.filter(id=>!['bollingerSqueeze','sessionVwap','volumeBreakoutV2'].includes(id))){
    const result=library.evaluateStrategies(wave,{[id]:true},context);
    assert.ok(result.signals.some(s=>s.side==='buy'), id+' buy');
    assert.ok(result.signals.some(s=>s.side==='sell'), id+' sell');
    assert.ok(result.signals.every(s=>s.strategy===id&&s.strategyVersion&&s.parameters&&Number.isFinite(s.price)&&s.reason));
  }
  assert.equal(JSON.stringify(wave),before);
});

test('MACD crosses match the existing SMA-seeded 12/26/9 indicator',()=>{
  const expected=[],macd=analysis.calculateMACD(wave);
  for(let i=1;i<wave.length;i++){
    if(macd.histogram[i-1]==null||macd.histogram[i]==null)continue;
    if(macd.histogram[i-1]<=0&&macd.histogram[i]>0)expected.push([i,'buy']);
    if(macd.histogram[i-1]>=0&&macd.histogram[i]<0)expected.push([i,'sell']);
  }
  const actual=library.evaluateStrategies(wave,{macdCross:true},context).signals.map(s=>[s.index,s.side]);
  assert.ok(expected.length);assert.deepEqual(actual,expected);
});

test('Donchian and strict volume breakout use previous highs/lows, while legacy volume rule is unchanged',()=>{
  const input=rows(Array(25).fill(100));input[20]={...input[20],close:100.05,high:100.1,volume:300};
  assert.ok(analysis.detectStrategySignals(input,{maCross:false,volumeBreakout:true}).some(s=>s.index===20));
  assert.equal(library.evaluateStrategies(input,{volumeBreakoutV2:true},context).signals.length,0);
  input[21]={...input[21],close:103,high:104,volume:1000};
  input[22]={...input[22],close:97,low:96,volume:2000};
  for(const id of ['donchianBreakout','volumeBreakoutV2']){
    const signals=library.evaluateStrategies(input,{[id]:true},context).signals;
    assert.ok(signals.some(s=>s.index===21&&s.side==='buy'));
    assert.ok(signals.some(s=>s.index===22&&s.side==='sell'));
  }
});

test('squeeze breakout tests prior narrow bands, not a band widened by the breakout itself',()=>{
  for(const [close,side] of [[108,'buy'],[92,'sell']]){
    const input=rows([...Array(25).fill(100),close]);
    input.at(-1).high=Math.max(100.1,close+.1);input.at(-1).low=Math.min(99.9,close-.1);
    assert.ok(library.evaluateStrategies(input,{bollingerSqueeze:true},context).signals.some(s=>s.index===25&&s.side===side));
  }
});

test('ATR breakout uses prior EMA and Wilder ATR, excluding the current shock from the threshold',()=>{
  const input=rows([...Array(25).fill(100),103]);
  input.forEach((b,i)=>{b.high=i===25?104:101;b.low=i===25?99:99;});
  const result=library.evaluateStrategies(input,{atrBreakout:true},{...context,parameters:{atrBreakout:{multiplier:1}}});
  assert.ok(result.signals.some(s=>s.index===25&&s.side==='buy'));
  assert.match(result.signals.at(-1).reason,/102/);
});

test('VWAP uses volume-weighted typical price, resets at a verified anchor and rejects truncated sessions',()=>{
  const input=rows([100,90,100,90]);input.forEach(b=>{b.high=b.close;b.low=b.close;});
  const result=library.evaluateStrategies(input,{sessionVwap:true},context);
  assert.deepEqual(result.signals.map(s=>[s.index,s.side]),[[2,'buy'],[3,'sell']]);
  assert.equal(library.evaluateStrategies(input.slice(1),{sessionVwap:true},context).signals.length,0);
  assert.match(library.evaluateStrategies(input.slice(1),{sessionVwap:true},context).statuses.sessionVwap.reason,/起点/);
  const nextDay=rows([100,110,100]).map(b=>({...b,time:b.time+86400000}));
  assert.ok(library.evaluateStrategies([...input,...nextDay],{sessionVwap:true},context).signals.some(s=>s.index===6&&s.side==='sell'));
});

test('VWAP respects New York daylight saving and never runs on daily bars or guessed timezone',()=>{
  for(const iso of ['2026-10-15T13:30:00Z','2026-12-15T14:30:00Z']){
    const input=rows([100,90,100]).map((b,i)=>({...b,time:Date.parse(iso)+i*60000,high:b.close,low:b.close}));
    assert.ok(library.evaluateStrategies(input,{sessionVwap:true},{market:'stocks',timeframe:'1m',exchangeTimeZone:'America/New_York',sessionStartMinutes:570}).signals.some(s=>s.index===2));
  }
  for(const ctx of [{...context,timeframe:'1d'},{...context,exchangeTimeZone:''},{...context,sessionStartMinutes:null}]){
    const result=library.evaluateStrategies(rows([100,90,100]),{sessionVwap:true},ctx);
    assert.equal(result.signals.length,0);assert.ok(result.statuses.sessionVwap.reason);
  }
});

test('VWAP stops accumulating after an intraday gap and does not bridge unobserved volume',()=>{
  const input=rows([100,90,100,90]);input.forEach(b=>{b.high=b.close;b.low=b.close;});
  input[2].time+=60000;input[3].time+=60000;
  const result=library.evaluateStrategies(input,{sessionVwap:true},context);
  assert.deepEqual(result.signals,[]);assert.match(result.statuses.sessionVwap.reason,/缺口/);
});

test('warmup, malformed OHLC, missing volume, duplicate time and invalid parameters fail explicitly',()=>{
  assert.match(library.evaluateStrategies(wave.slice(0,3),{macdCross:true},context).statuses.macdCross.reason,/不足/);
  for(const patch of [{close:NaN},{low:999},{time:wave[0].time}]){
    const input=wave.map(b=>({...b}));Object.assign(input[1],patch);
    const result=library.evaluateStrategies(input,{donchianBreakout:true},context);
    assert.equal(result.signals.length,0);assert.ok(result.statuses.donchianBreakout.reason);
  }
  const input=wave.map(({volume,...bar})=>bar);
  assert.equal(library.evaluateStrategies(input,{obvConfirmation:true},context).signals.length,0);
  assert.match(library.evaluateStrategies(input,{obvConfirmation:true},context).statuses.obvConfirmation.reason,/成交量/);
  assert.ok(library.evaluateStrategies(input,{macdCross:true},context).signals.length);
  const invalid=library.evaluateStrategies(wave,{macdCross:true,cciReversal:true},{...context,parameters:{macdCross:{fast:50,slow:10}}});
  assert.equal(invalid.signals.some(s=>s.strategy==='macdCross'),false);assert.ok(invalid.signals.some(s=>s.strategy==='cciReversal'));
  assert.match(invalid.statuses.macdCross.reason,/参数/);
});

test('null, absent and out-of-calendar rows produce unavailable reasons instead of throwing',()=>{
  for(const row of [null,undefined,{...wave[0],time:1e20}]){
    const result=library.evaluateStrategies([row],{macdCross:true,sessionVwap:true},context);
    assert.deepEqual(result.signals,[]);
    assert.ok(Object.values(result.statuses).every(status=>status.state==='unavailable'&&status.reason));
  }
});

test('every algorithm is prefix-stable: later data cannot change earlier signals',()=>{
  for(const id of ids){
    const enabled={[id]:true},short=library.evaluateStrategies(wave.slice(0,100),enabled,context).signals;
    const full=library.evaluateStrategies(wave,enabled,context).signals.filter(s=>s.index<100);
    assert.deepEqual(short,full,id);
  }
});

test('new parameters and versions reach stable chart IDs, forming states and mature outcomes',()=>{
  const input=rows([...Array(25).fill(100),108,110,112,115,116,117]);
  const enabled={maCross:false,donchianBreakout:true};
  const signals=analysis.detectStrategySignals(input,enabled,{...context,parameters:{donchianBreakout:{lookback:10}}});
  assert.ok(signals.some(s=>s.strategy==='donchianBreakout'));
  const points=analysis.buildStrategyChartPoints({bars:input,signals,market:'stocks',instrument:'stock:us:AAPL',timeframe:'1m',live:true,sourceFresh:true,currentBarClosed:false});
  assert.ok(points.some(p=>p.status==='forming'));
  assert.ok(points.some(p=>p.status==='confirmed'&&p.outcomes));
  const changed=analysis.detectStrategySignals(input,enabled,{...context,parameters:{donchianBreakout:{lookback:20}}});
  const other=analysis.buildStrategyChartPoints({bars:input,signals:changed,market:'stocks',instrument:'stock:us:AAPL',timeframe:'1m'});
  const a=points.find(p=>p.time===input[25].time),b=other.find(p=>p.time===input[25].time);
  assert.notEqual(a.id,b.id);assert.equal(a.parameters.lookback,10);
  assert.deepEqual(analysis.buildStrategyChartPoints({bars:input.slice(0,26),signals:signals.filter(s=>s.index===25),market:'stocks',instrument:'stock:us:AAPL',timeframe:'1m',live:true,sourceFresh:false}),[]);
});

test('new strategy forward outcomes mature only after the requested completed bars and retain cost assumptions',()=>{
  const input=rows([...Array(25).fill(100),...Array.from({length:30},(_,i)=>108+i)]);
  const signals=analysis.detectStrategySignals(input,{maCross:false,donchianBreakout:true},context);
  const points=analysis.buildStrategyChartPoints({bars:input,signals,market:'crypto',instrument:'crypto:binance:BTCUSDT',timeframe:'1m',costBps:10});
  const first=points.find(p=>p.index===25);
  assert.deepEqual(first.outcomes.map(o=>o.horizon),[1,3,5,20]);
  assert.ok(first.outcomes.every(o=>o.status==='matured'&&Number.isFinite(o.mfePct)&&Number.isFinite(o.maePct)));
  assert.ok(first.outcomes.every(o=>Math.abs(o.returnPct-o.netReturnPct-.1)<1e-10));
  const short=analysis.buildStrategyChartPoints({bars:input.slice(0,26),signals:signals.filter(s=>s.index===25),market:'crypto',instrument:'crypto:binance:BTCUSDT',timeframe:'1m'});
  assert.ok(short[0].outcomes.every(o=>o.status!=='matured'&&o.reason));
});

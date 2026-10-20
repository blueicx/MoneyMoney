const test=require('node:test'),assert=require('node:assert/strict');
require('ts-node/register/transpile-only');
const engine=require('../src/features/strategy-definitions').restrictedStrategy;
const start=Date.parse('2026-01-01T00:00:00Z'),step=300000;
const definition={name:'Isolated execution study',market:'stocks',timeframe:'5m',entry:{op:'gt',left:{field:'close',lag:0},right:{value:10}},exit:{op:'lt',left:{field:'close',lag:0},right:{value:9}},position:{maxAllocationPct:20},costs:{feeBps:10,slippageBps:10}};
const rows=[11,12,8,9].map((close,i)=>({time:start+i*step,open:10+i,high:Math.max(10+i,close)+1,low:Math.min(10+i,close)-1,close,volume:100,publishedAt:start+(i+1)*step}));
const input=()=>({version:{id:'strategy_12345678-1234-1234-1234-123456789012',hash:'a'.repeat(64),version:1,market:'stocks',interpreterVersion:engine.version,definition},market:'stocks',instrument:'stock:us:AAPL',asOf:start+5*step,source:'Isolated fixture — not market data',snapshotId:'pit_fixture',dataHash:'b'.repeat(64),bars:rows});
function run(value){let fn;try{fn=require('../src/features/restricted-experiment').runRestrictedHistoricalExperiment;}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}assert.equal(typeof fn,'function','restricted conditions need a causal adapter into the existing experiment/backtest engine');return fn(value);}
test('restricted historical study enters only on the next open, sizes whole shares within allocation and includes both costs',()=>{
 const r=run(input());assert.equal(r.backtest.trades.length,2);const [buy,sell]=r.backtest.trades;assert.equal(buy.timeIndex,1);assert.equal(buy.price,11);assert.equal(buy.volume,18);assert.ok(buy.fee>0&&buy.slippage>0);assert.equal(sell.timeIndex,3);assert.equal(sell.price,13);assert.equal(sell.volume,18);assert.equal(r.experiment.strategyVersion,'a'.repeat(64));assert.equal(r.experiment.dataSnapshotHash,'b'.repeat(64));assert.equal(r.gate.monitoringAllowed,false);assert.equal(r.gate.passed,false);assert.equal(r.evidence.outOfSample,null);assert.equal(r.executionModel,'restricted-next-open-v1');assert.ok(r.warnings.length);assert.equal(r.signals[0].signalTime,start);assert.equal(r.signals[0].knownAt,start+step);
});
test('missing/late publication, missing volume, gaps and final unfilled signals are explicit non-fills',()=>{
 for(const changes of [rows.map(b=>({...b,publishedAt:null})),rows.map(b=>({...b,publishedAt:start+4*step})),rows.map(b=>({...b,volume:undefined})),rows.map((b,i)=>({...b,time:start+2*i*step}))]){const r=run({...input(),bars:changes});assert.equal(r.backtest.trades.length,0);assert.ok(r.rejections.length>0);}
 const r=run({...input(),bars:rows.map(b=>({...b,close:11,high:20,low:1}))});assert.ok(r.rejections.some(v=>/下一根/.test(v.reason)));
});
test('same saved version, snapshot and configuration reproduce identity and trades without forced liquidation',()=>{
 const a=run(input()),b=run(input());assert.equal(a.experiment.id,b.experiment.id);assert.deepEqual(a.backtest,b.backtest);const open=run({...input(),bars:rows.map(b=>({...b,close:11,high:20,low:1}))});assert.ok(open.backtest.remainingPositions>0);assert.equal(open.backtest.trades.filter(t=>t.direction==='sell').length,0);assert.equal(open.backtest.startingBalance,1000);
});
test('unsupported markets, mismatched identity, future asOf and invalid model costs fail closed',()=>{
 for(const changes of [{market:'crypto',instrument:'crypto:binance:BTCUSDT'},{instrument:'crypto:binance:BTCUSDT'},{asOf:Date.now()+10000},{version:{...input().version,definition:{...definition,costs:{feeBps:1,slippageBps:10000}}}}])assert.throws(()=>run({...input(),...changes}));
});
test('historical model caps fills to observed whole-share volume and never publishes intraday annualization or low-sample win rates',()=>{
 const r=run({...input(),bars:rows.map(b=>({...b,volume:2}))});assert.ok(r.backtest.trades.every(t=>t.volume<=2));assert.equal(r.backtest.metrics.winRatePct,null);assert.equal(r.backtest.metrics.sharpeRatio,undefined);assert.equal(r.backtest.metrics.cagrPct,undefined);assert.equal(r.quality.closedTrades,1);
});
test('existing experiment comparison propagates execution warnings and handles absent out-of-sample evidence',()=>{
 const {compareExperiments}=require('../src/features/experiment-comparison'),a=run(input()),b=run({...input(),version:{...input().version,hash:'c'.repeat(64)}});const comparison=compareExperiments([a,b]);assert.equal(comparison.experiments[0].outOfSample,null);assert.ok(comparison.warnings.some(v=>v.includes('理论成交模型')));const text=require('node:fs').readFileSync('src/web/public/action-research-workspace.js','utf8');assert.match(text,/outOfSample\?\.totalReturnPct/);assert.match(text,/未验证/);
});

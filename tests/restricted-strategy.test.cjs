const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const file=path.resolve(__dirname,'../src/web/public/restricted-strategy.js');
const engine=()=>{assert.ok(fs.existsSync(file),'one restricted interpreter must serve browser and server');return require(file);};
const compare=(field,value,op='gt')=>({op,left:{field,lag:0},right:{value}});
const definition=()=>({name:'因果条件实验',market:'stocks',timeframe:'5m',entry:compare('close',10),exit:compare('close',9,'lt'),position:{maxAllocationPct:20},costs:{feeBps:10,slippageBps:10}});
const start=Date.parse('2026-01-01T00:00:00Z');
const bars=Array.from({length:8},(_,i)=>({time:start+i*300000,open:10+i,high:11+i,low:9+i,close:10+i,volume:100+i,closed:true}));
test('restricted schema canonicalizes key order and rejects code, arbitrary keys, invalid risk and unbounded trees',()=>{
 const e=engine(),d=definition();assert.deepEqual(e.validate(d),e.validate({...d,entry:{right:{value:10},left:{lag:0,field:'close'},op:'gt'}}));
 for(const bad of [{...d,sql:'select 1'},{...d,entry:{op:'eval',code:'process.exit()'}},{...d,position:{maxAllocationPct:101}},{...d,costs:{feeBps:-1,slippageBps:0}},{...d,timeframe:'unknown'}])assert.throws(()=>e.validate(bad));
 assert.throws(()=>e.validate({...d,filter:null}),'an explicitly invalid filter must not disappear');
 let deep=compare('close',1);for(let i=0;i<10;i++)deep={op:'not',child:deep};assert.throws(()=>e.validate({...d,entry:deep}),/深度|depth/);
});
test('causal completed-bar evaluation and explanation use the same index without future values',()=>{
 const e=engine(),d=definition(),asOf=start+8*300000;const result=e.evaluate(d,bars,asOf);assert.equal(result.points[0].time,bars[1].time);assert.equal(result.points[0].price,bars[1].close);assert.equal(result.points[0].direction,'buy');assert.equal(result.latest.entry.state,'met');
 const changed=bars.map((b,i)=>i>3?{...b,close:100,high:101}:b);assert.deepEqual(e.evaluate(d,changed,asOf).observations.slice(0,4),result.observations.slice(0,4));
 const unclosed=e.evaluate(d,[...bars.slice(0,-1),{...bars.at(-1),closed:false}],asOf);assert.equal(unclosed.observations.length,7);
 assert.equal(e.evaluate(d,bars,start+300000).observations.length,1);
});
test('missing data and nested NOT fail closed rather than turning an unknown into a signal',()=>{
 const e=engine(),d=definition();d.entry={op:'not',child:{op:'gt',left:{indicator:'sma',field:'volume',period:20,lag:0},right:{value:0}}};const result=e.evaluate(d,bars,start+8*300000);assert.equal(result.latest.entry.state,'insufficient');assert.equal(result.points.length,0);assert.match(result.latest.entry.reason,/不足/);
 const invalid=bars.map((b,i)=>i===1?{...b,high:0}:b);assert.throws(()=>e.evaluate(definition(),invalid,start+8*300000),/OHLC/);
});
test('crossovers use the previous complete observation; RSI flat history is neutral',()=>{
 const e=engine(),d=definition();d.entry={op:'crossAbove',left:{field:'close',lag:0},right:{value:12}};const result=e.evaluate(d,bars,start+8*300000);assert.deepEqual(result.points.map(p=>p.time),[bars[3].time]);
 d.entry={op:'gt',left:{indicator:'rsi',field:'close',period:3,lag:0},right:{value:50}};const flat=bars.map(b=>({...b,open:10,high:10,low:10,close:10}));assert.equal(e.evaluate(d,flat,start+8*300000).latest.entry.state,'not-met');
});
test('browser and server run exactly the same restricted interpreter',()=>{
 const e=engine(),sandbox={};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(file,'utf8'),sandbox);assert.equal(JSON.stringify(sandbox.MoneyRestrictedStrategy.evaluate(definition(),bars,start+8*300000)),JSON.stringify(e.evaluate(definition(),bars,start+8*300000)));
});
test('an intraday history gap invalidates rolling indicators and crossovers instead of treating distant bars as adjacent',()=>{
 const e=engine(),d=definition();d.entry={op:'gt',left:{indicator:'sma',field:'close',period:3,lag:0},right:{value:0}};const gap=bars.map((b,i)=>({...b,time:b.time+(i>=4?300000:0)}));const r=e.evaluate(d,gap,start+9*300000);assert.equal(r.observations[4].entry.state,'insufficient');assert.equal(r.observations[6].entry.state,'met');d.entry={op:'crossAbove',left:{field:'close',lag:0},right:{value:13}};assert.equal(e.evaluate(d,gap,start+9*300000).observations[4].entry.state,'insufficient');
});
module.exports={definition,bars,start};

test('RSI warms up again after gaps while daily trading observations may span weekends',()=>{
 const d=definition(),gap=bars.map((b,i)=>({...b,time:b.time+(i>=4?300000:0)}));d.entry={op:'gt',left:{indicator:'rsi',field:'close',period:3,lag:0},right:{value:50}};
 const r=engine().evaluate(d,gap,start+9*300000);assert.equal(r.observations[4].entry.state,'insufficient');assert.equal(r.observations[7].entry.state,'met');
 d.timeframe='1d';const daily=bars.map((b,i)=>({...b,time:start+(i+(i>=4?2:0))*86400000}));assert.equal(engine().evaluate(d,daily,start+11*86400000).observations[4].entry.state,'met');
});

test('long RSI previews read each candle a bounded number of times rather than re-running every prefix',()=>{
 const d=definition();d.entry={op:'gt',left:{indicator:'rsi',field:'close',period:14,lag:0},right:{value:50}};let reads=0;
 const long=Array.from({length:500},(_,i)=>({time:start+i*300000,open:20+i%7,high:30,low:10,get close(){reads++;return 20+i%7;},volume:100}));
 const result=engine().evaluate(d,long,start+501*300000);assert.equal(result.observations.length,500);assert.ok(reads<500*50,`RSI should use a causal cached series, read count ${reads}`);
});

test('cached RSI retains exact Wilder values across periods, lags and gap warm-up',()=>{
 const data=Array.from({length:120},(_,i)=>({time:start+(i+(i>=60?1:0))*300000,open:20+i%7,high:30,low:10,close:20+i%7,volume:100}));
 for(const period of [3,14,21])for(const lag of [0,2]){const d=definition();d.entry={op:'gt',left:{indicator:'rsi',field:'close',period,lag},right:{value:50}};const result=engine().evaluate(d,data,start+122*300000);for(let i=0;i<data.length;i++){const end=i-lag,begin=end>=60?60:0;let expected=null;if(end-begin>=period){let gain=0,loss=0;for(let j=begin+1;j<=end;j++){const delta=data[j].close-data[j-1].close,g=Math.max(0,delta),l=Math.max(0,-delta);if(j-begin<=period){gain+=g/period;loss+=l/period;}else{gain=(gain*(period-1)+g)/period;loss=(loss*(period-1)+l)/period;}}expected=gain===0&&loss===0?50:loss===0?100:100-100/(1+gain/loss);}assert.equal(result.observations[i].entry.left,expected);}}
});

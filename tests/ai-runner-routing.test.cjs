const test = require('node:test');
const assert = require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'runner-routing-'));
process.env.MONEYMONEY_DATA_DIR=root;
test.after(()=>{require('../dist/storage/sqlite-state').stateStore.close();fs.rmSync(root,{recursive:true,force:true});});
const { requestAiRunnerIntent } = require('../dist/features/ai-runner-model');
const { stockQuoteObservationTime } = require('../dist/features/stock-signal-schedule');
const { parseNasdaqQuotePayload } = require('../dist/features/nasdaq-stock-source');
const { stateStore } = require('../dist/storage/sqlite-state');
const runtime = { configured:true, apiKey:'fixture', apiUrl:'https://openrouter.ai/api/v1/chat/completions', model:'retired-model' };
const runner = { model:'retired-model', modelSelection:'available-free', universe:{market:'stocks',instruments:[{venue:'Stocks',symbolOrMarketId:'MU'}]} };
const intent = { action:'HOLD',instrument:'MU',market:'stocks',confidence:0.6,rationale:'等待有效报价及指标证据',counterEvidence:[],riskNotes:[] };
test('free failover switches after 404, excludes paid models and accounts for each attempt', async () => {
  const attempted=[];
  const result=await requestAiRunnerIntent(runner,runtime,[],async(url,init)=>{
    if(url.endsWith('/models'))return {ok:true,json:async()=>({data:[{id:'paid:free',pricing:{prompt:'1',completion:'0'},architecture:{output_modalities:['text']}},{id:'valid:free',pricing:{prompt:'0',completion:'0'},architecture:{output_modalities:['text']}}]})};
    const model=JSON.parse(init.body).model;
    if(model==='openrouter/free')return {ok:false,status:404};
    assert.equal(model,'valid:free');
    return {ok:true,json:async()=>({model,choices:[{message:{content:JSON.stringify(intent)}}]})};
  },model=>attempted.push(model));
  assert.equal(result.ok,true);assert.equal(result.model,'valid:free');assert.deepEqual(attempted,['openrouter/free','valid:free']);
});
test('authorization/rate errors stop switching and quota denial prevents a second request',async()=>{
  let calls=0;
  let result=await requestAiRunnerIntent(runner,runtime,[],async()=>{calls++;return {ok:false,status:429};},()=>{});
  assert.equal(result.ok,false);assert.equal(calls,1);
  calls=0;
  result=await requestAiRunnerIntent(runner,runtime,[],async(url)=>{if(url.endsWith('/models'))return {ok:true,json:async()=>({data:[{id:'other:free',pricing:{prompt:'0',completion:'0'},architecture:{output_modalities:['text']}}]})};calls++;return {ok:false,status:404};},()=>{if(calls)throw new Error('每日上限');});
  assert.equal(result.ok,false);assert.equal(calls,1);assert.match(result.reason,/上限/);
});
test('Nasdaq month-name source time retains exchange timezone and actual bid/ask',()=>{
  assert.equal(stockQuoteObservationTime('Oct 6, 2026 11:22 AM ET'),Date.parse('2026-10-06T15:22:00Z'));
  assert.equal(stockQuoteObservationTime('Feb 30, 2026 11:22 AM ET'),null);
  const q=parseNasdaqQuotePayload('MU',{data:{symbol:'MU',primaryData:{lastSalePrice:'$10.03',percentageChange:'+1%',lastTradeTimestamp:'Oct 6, 2026 11:22 AM ET',bidPrice:'$10.01',askPrice:'$10.03',isRealTime:true}}});
  assert.equal(q.bestBid,10.01);assert.equal(q.bestAsk,10.03);assert.equal(q.isRealTime,true);
});
test('best valid quote selection is deterministic: newest first, tighter spread on ties, stable provider tie-break',()=>{
  const helpers=require('../dist/features/ai-paper-runner');
  assert.equal(typeof helpers.selectRunnerStockQuote,'function');
  const now=Date.parse('2026-10-06T15:22:30Z');
  const candidate=(source,symbol='MU',at='2026-10-06T15:22:00Z',bid=10,ask=11)=>({source,quote:{symbol,asOf:at,currency:'USD',price:(bid+ask)/2,bestBid:bid,bestAsk:ask,isRealTime:true}});
  const invalid=[candidate('wrong','SNDK'),candidate('stale','MU','2026-10-06T15:00:00Z'),candidate('crossed','MU',undefined,12,11),candidate('future','MU','2026-10-06T15:23:00Z')];
  const freshWide=candidate('Yahoo fresh wide','MU','2026-10-06T15:22:20Z',10,11);
  const olderTight=candidate('Nasdaq older tight','MU','2026-10-06T15:22:00Z',10.4,10.6);
  assert.equal(helpers.selectRunnerStockQuote('MU',[...invalid,olderTight,freshWide],120000,now).source,'Yahoo fresh wide');
  const sameTimeWide=candidate('Nasdaq','MU','2026-10-06T15:22:20Z',10,11);
  const sameTimeTight=candidate('Yahoo','MU','2026-10-06T15:22:20Z',10.4,10.6);
  assert.equal(helpers.selectRunnerStockQuote('MU',[sameTimeWide,sameTimeTight],120000,now).source,'Yahoo');
  const tieRows=[candidate('Yahoo','MU','2026-10-06T15:22:20Z',10,10.2),candidate('Nasdaq','MU','2026-10-06T15:22:20Z',10,10.2)];
  assert.equal(helpers.selectRunnerStockQuote('MU',tieRows,120000,now).source,'Nasdaq');
  assert.equal(helpers.selectRunnerStockQuote('MU',[...tieRows].reverse(),120000,now).source,'Nasdaq');
  assert.equal(helpers.selectRunnerStockQuote('MU',invalid,120000,now),null);
});
test('controlled comparison quote selection remains deterministic under the shared quote arbitration',()=>{
  const helpers=require('../dist/features/ai-paper-runner'),now=Date.parse('2026-10-08T15:22:30Z');
  assert.equal(typeof helpers.selectControlledStockQuote,'function','缺少对照组固定报价选择');
  const row=source=>({source,status:'live',quote:{symbol:'AAPL',currency:'USD',price:100,bestBid:99,bestAsk:101,isRealTime:true,asOf:'2026-10-08T15:22:00Z'}});
  assert.equal(helpers.selectControlledStockQuote('AAPL',[row('secondary'),row('primary')],120000,now).source,'primary');
  assert.equal(helpers.selectControlledStockQuote('AAPL',[row('wrong')],120000,now+3600000),null);
});
test('new runners use best-valid quotes and legacy random selection requests are normalized',()=>{
  const helpers=require('../dist/features/ai-paper-runner');
  const created=helpers.createAiRunner('Stocks','MU','Micron',1000,{}, {startPaused:true,createdAt:'2026-10-08T00:00:00.000Z'});
  assert.equal(created.quoteSelection,'best-valid');
  const updated=helpers.updateAiRunnerRouting(created.id,{modelSelection:'fixed',quoteSelection:'random-valid'});
  assert.equal(updated.quoteSelection,'best-valid');
  stateStore.set('ai-paper-runners',[{...updated,status:'RUNNING',modelSelection:'available-free',quoteSelection:'random-valid'}],1);
  const loaded=helpers.getAiRunners().find(row=>row.id===created.id);
  assert.equal(loaded.quoteSelection,'best-valid');
  assert.equal(loaded.modelSelection,'available-free');assert.equal(loaded.status,'RUNNING');assert.equal(loaded.budgetUsd,1000);
});
test('runner card names deterministic quote arbitration and exposes the latest model request',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../src/web/public/modules/dashboard-runtime.js'),'utf8');
  assert.match(html,/r\.modelSelection === 'available-free'/);
  assert.match(html,/r\.quoteSelection === 'best-valid' \|\| r\.quoteSelection === 'random-valid'/);
  assert.match(html,/最近模型请求/);
  assert.doesNotMatch(html,/有效来源随机选择/);
  assert.match(html,/safeNewsText\(r\.lastDataSource/);
});
test('decision clock is captured after asynchronous quotes so a completed new-minute candle is not misclassified as future',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/web/server.ts'),'utf8');
  const prepare=source.slice(source.indexOf('async function prepareAiRunnerTick('),source.indexOf('const records = snapshots.map',source.indexOf('async function prepareAiRunnerTick(')));
  assert.match(prepare,/loadAiRunnerInstrumentSnapshot\(runner, ref\)[\s\S]*if \(!sample\) now = new Date\(\)/);
  const {evaluateRunnerIndicatorEvidence}=require('../dist/features/ai-paper-runner');
  const evidence={status:'delayed',dataAt:'2026-10-06T15:36:00Z',retrievedAt:'2026-10-06T15:36:01Z'};
  assert.equal(evaluateRunnerIndicatorEvidence(evidence,120000,new Date('2026-10-06T15:35:59Z')).allowed,false);
  assert.equal(evaluateRunnerIndicatorEvidence(evidence,120000,new Date('2026-10-06T15:36:02Z')).allowed,true);
});
test('fetching old candles now does not make their indicators fresh',()=>{
  const {evaluateRunnerIndicatorEvidence}=require('../dist/features/ai-paper-runner');
  const result=evaluateRunnerIndicatorEvidence({status:'delayed',dataAt:'2026-10-06T14:00:00Z',retrievedAt:'2026-10-06T15:36:01Z'},120000,new Date('2026-10-06T15:36:02Z'));
  assert.equal(result.allowed,false);assert.match(result.reason,/过期/);
});

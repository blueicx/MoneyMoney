const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');require('ts-node/register/transpile-only');
const testDataRoot=fs.mkdtempSync(path.join(os.tmpdir(),'moneymoney-runner-options-'));process.env.MONEYMONEY_DATA_DIR=testDataRoot;
const runnerModule=require('../src/features/ai-paper-runner');
const {resolveRunnerFill,calculateRunnerExecutionCosts,normalizeDeribitOptionExecutionQuote,fetchDeribitOptionExecutionQuote,createAiRunner,runnerOpenPosition,runnerClosePosition,getAiRunners}=runnerModule;
const {stateStore}=require('../src/storage/sqlite-state');
test.after(()=>{stateStore.close();fs.rmSync(testDataRoot,{recursive:true,force:true});});
const at='2026-10-08T00:00:00Z',policy={minFreshnessMs:120000,feeRateBps:10,additionalSlippageBps:5};
const quote={market:'options',price:2,status:'delayed',fetchedAt:at,bestBid:1.9,bestAsk:2.1,optionContract:{instrumentId:'option:us:SPY:2027-01-15:500:C',source:'fixture-exchange',verified:true,currency:'USD',multiplier:100,expiresAt:'2027-01-15T21:00:00Z'}};
test('option quote without verified identity multiplier currency or expiry cannot fill',()=>{
 for(const bad of [{...quote,optionContract:undefined},{...quote,optionContract:{...quote.optionContract,verified:false}},{...quote,optionContract:{...quote.optionContract,multiplier:0}},{...quote,optionContract:{...quote.optionContract,currency:'BTC'}},{...quote,optionContract:{...quote.optionContract,expiresAt:at}},{...quote,optionContract:{...quote.optionContract,instrumentId:'stock:us:SPY'}}])assert.equal(resolveRunnerFill(policy,bad,'BUY',new Date(at)).allowed,false);
 assert.equal(resolveRunnerFill(policy,quote,'BUY',new Date(at)).allowed,true);
});
test('option execution costs use premium times contract count times verified multiplier',()=>{
 const costs=calculateRunnerExecutionCosts(policy,quote,'BUY',2);assert.equal(costs.feeUsd,0.42);assert.equal(costs.slippageUsd,0.21);assert.equal(costs.spreadUsd,20);
 assert.throws(()=>calculateRunnerExecutionCosts(policy,quote,'BUY',0.5),/整数|合约/);
});
test('underlying aliases and contract-expiry disagreement never satisfy option execution identity',()=>{
 for(const identity of ['option:us:SPY','option:us:SPY:2027-02-30:500:C','option:us:SPY:2027-01-15:0:C','option:us:SPY:2027-02-15:500:C'])assert.equal(resolveRunnerFill(policy,{...quote,optionContract:{...quote.optionContract,instrumentId:identity}},'BUY',new Date(at)).allowed,false);
});

test('Deribit BTC option quote normalizes only an exact open contract with fresh USD index and visible depth',()=>{
 assert.equal(typeof normalizeDeribitOptionExecutionQuote,'function');
 const now=new Date('2026-10-09T00:00:05.000Z');
 const name='BTC-19OCT26-65000-C';
 const instrument={instrument_name:name,kind:'option',state:'open',is_active:true,instrument_type:'reversed',base_currency:'BTC',quote_currency:'BTC',settlement_currency:'BTC',counter_currency:'USD',price_index:'btc_usd',option_type:'call',strike:65000,expiration_timestamp:Date.parse('2026-10-19T08:00:00.000Z'),contract_size:1,min_trade_amount:0.1,taker_commission:0.0003};
 const ticker={instrument_name:name,state:'open',timestamp:Date.parse('2026-10-09T00:00:00.000Z'),best_bid_price:0.001,best_ask_price:0.0011,best_bid_amount:2,best_ask_amount:1,index_price:80000};
 const normalized=normalizeDeribitOptionExecutionQuote(instrument,ticker,now,120000);
 assert.equal(normalized.market,'options');
 assert.equal(normalized.price,84);
 assert.equal(normalized.bestBid,80);
 assert.equal(normalized.bestAsk,88);
 assert.equal(normalized.bestBidSize,2);
 assert.equal(normalized.bestAskSize,1);
 assert.equal(normalized.optionContract.instrumentId,'option:deribit:BTC-19OCT26-65000-C');
 assert.equal(normalized.optionContract.multiplier,1);
 assert.equal(normalized.optionContract.takerCommission,0.0003);
 assert.equal(resolveRunnerFill(policy,normalized,'BUY',now,1).allowed,true);
 assert.equal(resolveRunnerFill(policy,normalized,'BUY',now,2).allowed,false);
 assert.equal(resolveRunnerFill(policy,normalized,'SELL',now,2).allowed,true);
});

test('Deribit option normalization rejects mismatched identity, non-USD basis, stale or non-open contracts',()=>{
 assert.equal(typeof normalizeDeribitOptionExecutionQuote,'function');
 const now=new Date('2026-10-09T00:00:05.000Z');
 const name='ETH-19OCT26-4000-P';
 const instrument={instrument_name:name,kind:'option',state:'open',is_active:true,instrument_type:'reversed',counter_currency:'USD',base_currency:'ETH',quote_currency:'ETH',settlement_currency:'ETH',price_index:'eth_usd',option_type:'put',strike:4000,expiration_timestamp:Date.parse('2026-10-19T08:00:00.000Z'),contract_size:1,min_trade_amount:0.1,taker_commission:0.0003};
 const ticker={instrument_name:name,state:'open',timestamp:Date.parse('2026-10-09T00:00:00.000Z'),best_bid_price:0.002,best_ask_price:0.0022,best_bid_amount:1,best_ask_amount:1,index_price:3000};
 for(const [badInstrument,badTicker] of [
  [{...instrument,instrument_name:'ETH-19OCT26-4000-C'},ticker],
  [{...instrument,quote_currency:'USD'},ticker],
  [{...instrument,contract_size:0.1},ticker],
  [{...instrument,taker_commission:undefined},ticker],
  [{...instrument,taker_commission:0},ticker],
  [{...instrument,taker_commission:0.02},ticker],
  [{...instrument,state:'settlement'},ticker],
  [instrument,{...ticker,instrument_name:'ETH-19OCT26-4000-C'}],
  [instrument,{...ticker,timestamp:Date.parse('2026-10-08T00:00:00.000Z')}],
  [instrument,{...ticker,best_ask_amount:0}],
  [instrument,{...ticker,index_price:0}],
 ]) assert.throws(()=>normalizeDeribitOptionExecutionQuote(badInstrument,badTicker,now,120000));
});

test('Deribit execution costs accept a fresh quote whose source timestamp precedes its retrieval time',()=>{
 const retrievedAt=new Date('2026-10-09T00:00:05.000Z');
 const name='BTC-19OCT26-65000-C';
 const instrument={instrument_name:name,kind:'option',state:'open',is_active:true,instrument_type:'reversed',counter_currency:'USD',base_currency:'BTC',quote_currency:'BTC',settlement_currency:'BTC',price_index:'btc_usd',option_type:'call',strike:65000,expiration_timestamp:Date.parse('2026-10-19T08:00:00.000Z'),contract_size:1,min_trade_amount:0.1,taker_commission:0.0003};
 const ticker={instrument_name:name,state:'open',timestamp:Date.parse('2026-10-09T00:00:00.000Z'),best_bid_price:0.001,best_ask_price:0.0011,best_bid_amount:1,best_ask_amount:1,index_price:80000};
 const normalized=normalizeDeribitOptionExecutionQuote(instrument,ticker,retrievedAt,120000);
 assert.doesNotThrow(()=>calculateRunnerExecutionCosts(policy,normalized,'BUY',1));
 const impossibleSequence={...normalized,optionContract:{...normalized.optionContract,retrievedAt:'2026-10-08T23:59:59.000Z'}};
 assert.equal(resolveRunnerFill(policy,impossibleSequence,'BUY',retrievedAt,1).allowed,false);
});

test('Deribit option taker fees use source commission and the official 12.5 percent premium cap',()=>{
 const now=new Date('2026-10-09T00:00:05.000Z');
 const name='BTC-19OCT26-65000-C';
 const instrument={instrument_name:name,kind:'option',state:'open',is_active:true,instrument_type:'reversed',counter_currency:'USD',base_currency:'BTC',quote_currency:'BTC',settlement_currency:'BTC',price_index:'btc_usd',option_type:'call',strike:65000,expiration_timestamp:Date.parse('2026-10-19T08:00:00.000Z'),contract_size:1,min_trade_amount:0.1,taker_commission:0.0003};
 const ticker={instrument_name:name,state:'open',timestamp:Date.parse('2026-10-09T00:00:00.000Z'),best_bid_price:0.001,best_ask_price:0.0011,best_bid_amount:2,best_ask_amount:2,index_price:80000};
 const quote=normalizeDeribitOptionExecutionQuote(instrument,ticker,now,120000);
 const costs=calculateRunnerExecutionCosts(policy,quote,'BUY',1);
 // $24 (0.03% of BTC index) is capped at 12.5% of the $88 ask premium = $11.
 assert.equal(costs.feeUsd,11);
 const cappedAtIndex=normalizeDeribitOptionExecutionQuote({...instrument,taker_commission:0.0001},ticker,now,120000);
 assert.equal(calculateRunnerExecutionCosts(policy,cappedAtIndex,'BUY',1).feeUsd,8);
 assert.equal(resolveRunnerFill(policy,{...quote,optionContract:{...quote.optionContract,takerCommission:undefined}},'BUY',now,1).allowed,false);
});

test('Deribit fill gate rejects zero, negative, and fractional contract quantities',()=>{
 const now=new Date('2026-10-09T00:00:05.000Z');
 const name='BTC-19OCT26-65000-C';
 const instrument={instrument_name:name,kind:'option',state:'open',is_active:true,instrument_type:'reversed',counter_currency:'USD',base_currency:'BTC',quote_currency:'BTC',settlement_currency:'BTC',price_index:'btc_usd',option_type:'call',strike:65000,expiration_timestamp:Date.parse('2026-10-19T08:00:00.000Z'),contract_size:1,min_trade_amount:0.1,taker_commission:0.0003};
 const ticker={instrument_name:name,state:'open',timestamp:Date.parse('2026-10-09T00:00:00.000Z'),best_bid_price:0.001,best_ask_price:0.0011,best_bid_amount:2,best_ask_amount:2,index_price:80000};
 const normalized=normalizeDeribitOptionExecutionQuote(instrument,ticker,now,120000);
 for(const quantity of [0,-1,0.5]) assert.equal(resolveRunnerFill(policy,normalized,'BUY',now,quantity).allowed,false,`quantity ${quantity}`);
});

test('Deribit execution gate revalidates positive USD-index basis, two-sided depth, and contract quantity step',()=>{
 const now=new Date('2026-10-09T00:00:05.000Z');
 const name='BTC-19OCT26-65000-C';
 const instrument={instrument_name:name,kind:'option',state:'open',is_active:true,instrument_type:'reversed',counter_currency:'USD',base_currency:'BTC',quote_currency:'BTC',settlement_currency:'BTC',price_index:'btc_usd',option_type:'call',strike:65000,expiration_timestamp:Date.parse('2026-10-19T08:00:00.000Z'),contract_size:1,min_trade_amount:0.1,taker_commission:0.0003};
 const ticker={instrument_name:name,state:'open',timestamp:Date.parse('2026-10-09T00:00:00.000Z'),best_bid_price:0.001,best_ask_price:0.0011,best_bid_amount:2,best_ask_amount:2,index_price:80000};
 const normalized=normalizeDeribitOptionExecutionQuote(instrument,ticker,now,120000);
 const invalidQuotes=[
  {...normalized,optionContract:{...normalized.optionContract,minTradeAmount:2}},
  {...normalized,optionContract:{...normalized.optionContract,instrumentType:'linear'}},
  {...normalized,optionContract:{...normalized.optionContract,counterCurrency:'USDC'}},
  {...normalized,optionContract:{...normalized.optionContract,indexPrice:-80000,rawBestBidPrice:-0.001,rawBestAskPrice:-0.0011}},
  {...normalized,bestBidSize:0,optionContract:{...normalized.optionContract,bestBidAmount:0}},
 ];
 for(const invalid of invalidQuotes) assert.equal(resolveRunnerFill(policy,invalid,'BUY',now,1).allowed,false);
});

test('Deribit option normalization rejects a non-inverse instrument or non-USD counter currency',()=>{
 const now=new Date('2026-10-09T00:00:05.000Z');
 const name='BTC-19OCT26-65000-C';
 const instrument={instrument_name:name,kind:'option',state:'open',is_active:true,instrument_type:'reversed',base_currency:'BTC',quote_currency:'BTC',settlement_currency:'BTC',counter_currency:'USD',price_index:'btc_usd',option_type:'call',strike:65000,expiration_timestamp:Date.parse('2026-10-19T08:00:00.000Z'),contract_size:1,min_trade_amount:0.1,taker_commission:0.0003};
 const ticker={instrument_name:name,state:'open',timestamp:Date.parse('2026-10-09T00:00:00.000Z'),best_bid_price:0.001,best_ask_price:0.0011,best_bid_amount:2,best_ask_amount:2,index_price:80000};
 assert.throws(()=>normalizeDeribitOptionExecutionQuote({...instrument,instrument_type:'linear'},ticker,now,120000),/计价|合约/);
 assert.throws(()=>normalizeDeribitOptionExecutionQuote({...instrument,counter_currency:'USDC'},ticker,now,120000),/计价|合约/);
});

test('Deribit runner fetch uses only the fixed public host and refuses mismatched source payload identity',async()=>{
 assert.equal(typeof fetchDeribitOptionExecutionQuote,'function');
 const now=new Date();
 const expiration=new Date(now.getTime()+10*24*60*60*1000);expiration.setUTCHours(8,0,0,0);
 const day=expiration.getUTCDate(),month=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][expiration.getUTCMonth()],year=String(expiration.getUTCFullYear()).slice(-2);
 const name=`ETH-${day}${month}${year}-4000-P`;
 const instrument={instrument_name:name,kind:'option',state:'open',is_active:true,instrument_type:'reversed',counter_currency:'USD',base_currency:'ETH',quote_currency:'ETH',settlement_currency:'ETH',price_index:'eth_usd',option_type:'put',strike:4000,expiration_timestamp:expiration.getTime(),contract_size:1,min_trade_amount:0.1,taker_commission:0.0003};
 const ticker={instrument_name:name,state:'open',timestamp:now.getTime(),best_bid_price:0.002,best_ask_price:0.0022,best_bid_amount:1,best_ask_amount:1,index_price:3000};
 const urls=[];
 const fetcher=async url=>{const parsed=new URL(String(url));urls.push(parsed);const method=parsed.pathname.endsWith('/get_instrument')?'get_instrument':'ticker';return {ok:true,json:async()=>({result:method==='get_instrument'?instrument:ticker})};};
 const quote=await fetchDeribitOptionExecutionQuote(name,{fetcher,now,maxAgeMs:120000});
 assert.equal(quote.optionContract.instrumentId,`option:deribit:${name}`);
 assert.equal(urls.length,2);
 assert.ok(urls.every(url=>url.origin==='https://www.deribit.com'&&url.searchParams.get('instrument_name')===name));
 ticker.instrument_name='ETH-OTHER-4000-P';
 await assert.rejects(()=>fetchDeribitOptionExecutionQuote(name,{fetcher,now,maxAgeMs:120000}),/身份不一致/);
 const differentName=name.replace('-4000-P','-4100-P');
 instrument.strike=4100;
 instrument.instrument_name=differentName;ticker.instrument_name=differentName;
 await assert.rejects(()=>fetchDeribitOptionExecutionQuote(name,{fetcher,now,maxAgeMs:120000}),/请求的合约身份/);
 await assert.rejects(()=>fetchDeribitOptionExecutionQuote('BTC-PERPETUAL',{fetcher,now,maxAgeMs:120000}),/期权合约标识/);
});

test('a runner accepts only an exact Deribit contract and links long-only paper fills to its own ledger',()=>{
 const expiration=new Date(Date.now()+10*24*60*60*1000);expiration.setUTCHours(8,0,0,0);
 const day=expiration.getUTCDate(),month=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][expiration.getUTCMonth()],year=String(expiration.getUTCFullYear()).slice(-2);
 const name=`BTC-${day}${month}${year}-65000-C`;
 const runner=createAiRunner('Options',name,name,1000,undefined,{mode:'rules'});
 assert.equal(runner.universe.market,'options');
 assert.equal(runner.universe.instruments[0].symbolOrMarketId,name);
 assert.throws(()=>createAiRunner('Options','BTC', 'Bitcoin options',1000),/Deribit|合约/);
 const now=new Date();
 const instrument={instrument_name:name,kind:'option',state:'open',is_active:true,instrument_type:'reversed',counter_currency:'USD',base_currency:'BTC',quote_currency:'BTC',settlement_currency:'BTC',price_index:'btc_usd',option_type:'call',strike:65000,expiration_timestamp:expiration.getTime(),contract_size:1,min_trade_amount:0.1,taker_commission:0.0003};
 const ticker={instrument_name:name,state:'open',timestamp:now.getTime(),best_bid_price:0.001,best_ask_price:0.0011,best_bid_amount:2,best_ask_amount:1,index_price:80000};
 const quote=normalizeDeribitOptionExecutionQuote(instrument,ticker,now,120000);
 assert.equal(runnerOpenPosition(runner.id,quote.bestAsk,1,'SHORT','invalid side',undefined,{quote,source:quote.source,dataAt:quote.fetchedAt}),false);
 assert.equal(runnerOpenPosition(runner.id,quote.bestAsk,1,'LONG','test',undefined,{quote,source:quote.source,dataAt:quote.fetchedAt}),true);
 const accountStore=require('../src/features/unified-paper-trading').unifiedPaperLedgerStore;
 let account=accountStore.getRunnerAccount(runner.accountId);
 assert.equal(account.positions[0].instrumentId,`option:deribit:${name}`);
 assert.equal(account.positions[0].contractMultiplier,1);
 const openPosition=getAiRunners().find(item=>item.id===runner.id).positions[0];
 assert.equal(runnerClosePosition(runner.id,openPosition.id,quote.bestBid,'test close',{quote,source:quote.source,dataAt:quote.fetchedAt}),-8);
 account=accountStore.getRunnerAccount(runner.accountId);
 assert.equal(account.positions.length,0);
 assert.equal(account.orders[1].instrumentId,`option:deribit:${name}`);
});

test('runner open and close reject a valid quote belonging to a different frozen option contract',()=>{
 const expiration=new Date(Date.now()+10*24*60*60*1000);expiration.setUTCHours(8,0,0,0);
 const day=expiration.getUTCDate(),month=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][expiration.getUTCMonth()],year=String(expiration.getUTCFullYear()).slice(-2);
 const name=`BTC-${day}${month}${year}-65000-C`;
 const runner=createAiRunner('Options',name,name,1000,undefined,{mode:'rules'});
 const makeQuote=(contractName,strike)=>{
  const now=new Date();
  const instrument={instrument_name:contractName,kind:'option',state:'open',is_active:true,instrument_type:'reversed',counter_currency:'USD',base_currency:'BTC',quote_currency:'BTC',settlement_currency:'BTC',price_index:'btc_usd',option_type:'call',strike,expiration_timestamp:expiration.getTime(),contract_size:1,min_trade_amount:0.1,taker_commission:0.0003};
  const ticker={instrument_name:contractName,state:'open',timestamp:now.getTime(),best_bid_price:0.001,best_ask_price:0.0011,best_bid_amount:2,best_ask_amount:2,index_price:80000};
  return normalizeDeribitOptionExecutionQuote(instrument,ticker,now,120000);
 };
 const correct=makeQuote(name,65000),wrong=makeQuote(`BTC-${day}${month}${year}-66000-C`,66000);
 assert.equal(runnerOpenPosition(runner.id,wrong.bestAsk,1,'LONG','wrong contract',undefined,{quote:wrong,source:wrong.source,dataAt:wrong.fetchedAt}),false);
 assert.equal(runnerOpenPosition(runner.id,correct.bestAsk,1,'LONG','correct contract',undefined,{quote:correct,source:correct.source,dataAt:correct.fetchedAt}),true);
 const openPosition=getAiRunners().find(item=>item.id===runner.id).positions[0];
 assert.equal(runnerClosePosition(runner.id,openPosition.id,wrong.bestBid,'wrong contract',{quote:wrong,source:wrong.source,dataAt:wrong.fetchedAt}),null);
});

test('Deribit paper sizing reduces quantity to fit the source fee model and visible ask depth',()=>{
 const {sizeDeribitOptionPaperOrder}=require('../src/features/ai-paper-runner');
 const now=new Date('2026-10-09T00:00:05.000Z');
 const name='BTC-19OCT26-65000-C';
 const instrument={instrument_name:name,kind:'option',state:'open',is_active:true,instrument_type:'reversed',counter_currency:'USD',base_currency:'BTC',quote_currency:'BTC',settlement_currency:'BTC',price_index:'btc_usd',option_type:'call',strike:65000,expiration_timestamp:Date.parse('2026-10-19T08:00:00.000Z'),contract_size:1,min_trade_amount:0.1,taker_commission:0.0003};
 const ticker={instrument_name:name,state:'open',timestamp:Date.parse('2026-10-09T00:00:00.000Z'),best_bid_price:0.001,best_ask_price:0.0011,best_bid_amount:20,best_ask_amount:20,index_price:80000};
 const quote=normalizeDeribitOptionExecutionQuote(instrument,ticker,now,120000);
 // Eleven contracts need $968 premium plus the $121 official-fee cap; ten fit within $1,000.
 assert.equal(sizeDeribitOptionPaperOrder(policy,quote,1000,now),10);
 const shallow={...quote,bestAskSize:6,optionContract:{...quote.optionContract,bestAskAmount:6}};
 assert.equal(sizeDeribitOptionPaperOrder(policy,shallow,1000,now),6);
 assert.equal(sizeDeribitOptionPaperOrder(policy,quote,100,now),1);
 assert.equal(sizeDeribitOptionPaperOrder(policy,{...quote,dataStatus:'stale',status:'stale'},1000,now),0);
});

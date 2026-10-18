const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
test('why formatter is bounded, escapes saved facts and never invents a model quota or successful source gate',()=>{
 assert.ok(require('node:fs').existsSync('src/features/telegram-runner-why.ts'),'bounded saved-decision formatter missing');const {formatTelegramRunnerWhy}=require('../src/features/telegram-runner-why');assert.equal(typeof formatTelegramRunnerWhy,'function');
 const row={at:'2026-10-01',instrument:'stock:us:AAPL',action:'REJECTED',reason:'<unsafe>'.repeat(2000),strategyVersion:'v1',modelVersion:'free',dataGate:{source:'SEC',dataAt:'saved-time',dataStatus:'partial'},model:{status:'skipped'},blockedChecks:['budget blocked'],snapshotHash:'abc',decisionId:'d'};
 const message=formatTelegramRunnerWhy(Array.from({length:3},(_,i)=>({title:'<run'+i+'>',mode:'ai-autonomous-paper',report:{rows:[row,row,row]},callsToday:null,sharedQuota:true})));
 assert.ok(message.length<=3800);assert.ok(!message.includes('<unsafe>'));assert.ok(message.includes('未核验'));assert.ok(message.includes('共享额度'));assert.ok(message.includes('partial'));assert.ok(message.includes('budget blocked'));assert.ok(message.includes('不调用模型'));
});
test('known saved request use is distinguished from approval to make a new model request',()=>{
 assert.ok(require('node:fs').existsSync('src/features/telegram-runner-why.ts'),'saved quota formatter missing');const {formatTelegramRunnerWhy}=require('../src/features/telegram-runner-why');
 const message=formatTelegramRunnerWhy([{title:'rules',mode:'rules',report:{rows:[]},callsToday:0},{title:'ai',mode:'ai-review',report:{rows:[]},callsToday:24}]);
 assert.match(message,/规则模式/);assert.match(message,/24\/24/);assert.match(message,/UTC/);assert.match(message,/尚无决策/);assert.doesNotMatch(message,/可立即下单/);
});

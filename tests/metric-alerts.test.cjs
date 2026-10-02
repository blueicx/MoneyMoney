const test=require('node:test'),assert=require('node:assert/strict');
const {validateUnifiedAlertRule,evaluateUnifiedAlert,UnifiedAlertStore,triggerUnifiedAlerts,previewUnifiedAlerts}=require('../dist/features/unified-alerts');
const rule={instrumentId:'stock:us:AAPL',scope:'stocks',kind:'metric',enabled:true,condition:{join:'all',clauses:[{field:'price',operator:'gte',value:100},{field:'volume',operator:'gte',value:10}],durationMinutes:2},channels:{web:true,telegram:false},cooldownMinutes:1};
const observation=(at,price=110)=>({kind:'metric',scope:'stocks',observedAt:at,metrics:{price,volume:12},dataStatus:'delayed'});
test('compound conditions validate market capabilities and reject missing data',()=>{
 assert.equal(validateUnifiedAlertRule(rule).ok,true);
 assert.equal(validateUnifiedAlertRule({...rule,condition:{...rule.condition,clauses:[{field:'fundingRatePct',operator:'gte',value:1}]}}).ok,false);
 assert.equal(evaluateUnifiedAlert(rule,{...observation('2026-09-30T00:00:00Z'),metrics:{price:110}}).matched,false);
 assert.equal(evaluateUnifiedAlert(rule,observation('2026-09-30T00:00:00Z')).matched,true);
});
test('duration persists, dry run does not mutate and a failed/gapped sample resets continuity',()=>{
 assert.equal(validateUnifiedAlertRule(rule).ok,true);
 const store=new UnifiedAlertStore({keyPrefix:'test-metric-'+Date.now()});store.createRule({...rule,id:'duration'});
 const run=(at,obs=observation(at))=>triggerUnifiedAlerts(store,[{instrumentId:rule.instrumentId,observation:obs}],new Date(at));
 assert.equal(run('2026-09-30T00:00:00Z').length,0);
 assert.equal(run('2026-09-30T00:01:00Z').length,0);
 const before=store.getRule('duration').matchedSince;
 previewUnifiedAlerts(store,[{instrumentId:rule.instrumentId,observation:observation('2026-09-30T00:02:00Z')}],new Date('2026-09-30T00:02:00Z'));
 assert.equal(store.getRule('duration').matchedSince,before);
 assert.equal(run('2026-09-30T00:02:00Z').length,1);
 assert.equal(run('2026-09-30T00:06:00Z',{...observation('2026-09-30T00:06:00Z'),dataStatus:'unavailable'}).length,0);
 assert.equal(store.getRule('duration').matchedSince,undefined);
 assert.equal(run('2026-09-30T00:07:00Z').length,0);
});
test('web alert monitor starts independently of Telegram configuration and has a SQLite lease',()=>{
 const fs=require('node:fs'),source=fs.readFileSync('src/web/server.ts','utf8');
 assert.match(source,/function startUnifiedAlertMonitor\(\)/);assert.match(source,/stateStore\.acquireLease\('unified-alert-monitor'/);assert.match(source,/app\.listen\([\s\S]*startUnifiedAlertMonitor\(\);/);
 const start=source.indexOf('function startTelegramCommandCenterMonitor()'),end=source.indexOf('function stopTelegramCommandCenterMonitor()',start);assert.doesNotMatch(source.slice(start,end),/monitorUnifiedAlertRules\(\)/);
});
test('legacy price monitor does not route unknown or option identities through stock quotes',()=>{
 const fs=require('node:fs'),source=fs.readFileSync('src/web/server.ts','utf8'),start=source.indexOf('async function runUnifiedAlertMonitor()'),end=source.indexOf('function startTelegramCommandCenterMonitor()',start),body=source.slice(start,end);
 assert.match(body,/else if \(rule.instrumentId.startsWith\('stock:us:'\)\) price/);assert.match(body,/kind: 'price', scope: priceScope/);
});
test('source budget refuses a seventh active metric instrument instead of silently starving rules',()=>{
 const store=new UnifiedAlertStore({keyPrefix:'test-metric-capacity-'+Date.now()});
 for(let i=1;i<=6;i++)store.createRule({...rule,id:'capacity-'+i,instrumentId:'stock:us:A'+i});
 assert.throws(()=>store.createRule({...rule,instrumentId:'stock:us:SEVENTH'}),/预算|6/);store.updateRule('capacity-1',{enabled:false});store.createRule({...rule,instrumentId:'stock:us:SEVENTH'});assert.throws(()=>store.updateRule('capacity-1',{enabled:true}),/预算|6/);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { buildSettlementEndpoint, buildPolymarketResolutionEndpoint, settlementPayloadMatches, normalizeSettlementEvidence, PredictionSettlementRepository, buildSettlementTimeline } = require('../dist/features/prediction-settlement');

test('rule audit compares same-identity captured text and deadlines without future or corrupted evidence',()=>{
  const first=normalizeSettlementEvidence({platform:'Kalshi',marketId:'KXTEST-26',capturedAt:'2026-10-01T00:00:00Z',payload:{rules_primary:'If A by Friday.',close_time:'2026-10-02T00:00:00Z'}});
  const latest=normalizeSettlementEvidence({platform:'Kalshi',marketId:'KXTEST-26',capturedAt:'2026-10-03T00:00:00Z',payload:{rules_primary:'If B by Friday.',close_time:'2026-10-04T00:00:00Z'}});
  const other=normalizeSettlementEvidence({platform:'Kalshi',marketId:'OTHER-26',capturedAt:'2026-10-02T00:00:00Z',payload:{rules_primary:'OTHER'}});
  const future={...latest,capturedAt:'2026-10-05T00:00:00Z'};
  const audit=buildSettlementTimeline(latest,[future,other,latest,first]).ruleComparisons;
  assert.ok(audit,'rule changes must be available');assert.equal(audit.length,1);assert.equal(audit[0].status,'changed');assert.deepEqual(audit[0].textChange,{removed:'A',added:'B'});assert.equal(audit[0].fields.find(field=>field.field==='closeAt').before,first.closeAt);assert.equal(audit[0].beforeHash,first.rulesHash);
  const broken=buildSettlementTimeline({...latest,rulesHash:'wrong'},[first,{...latest,rulesHash:'wrong'}]).ruleComparisons[0];assert.equal(broken.status,'unavailable');assert.equal(broken.textChange,null);
});

test('rule comparison UI escapes exact changed text and keeps source-time uncertainty',()=>{
  const source=require('./helpers/dashboard-source.cjs').readDashboardSource(),render=source.match(/function renderPredictionRuleAudit\(comparisons\) \{[\s\S]*?\n\}/)?.[0];assert.ok(render);
  const vm=require('node:vm');const html=vm.runInNewContext(render+';renderPredictionRuleAudit(comparisons);',{safeNewsText:value=>String(value??'').replaceAll('<','&lt;'),comparisons:[{status:'changed',beforeAt:'2026-10-01',afterAt:'2026-10-02',textChange:{removed:'old',added:'<script>new'},fields:[{field:'closeAt',before:null,after:'2026-10-03'}],reason:'抓取时间不是生效时间',beforeHash:'a',afterHash:'b'}]});assert.match(html,/old/);assert.match(html,/&lt;script>/);assert.doesNotMatch(html,/<script>/);assert.match(html,/抓取时间不是生效时间/);
});

test('settlement source payload must identify the exact requested venue market', () => {
  assert.equal(settlementPayloadMatches('Kalshi', 'KXTEST-26', { ticker: 'KXTEST-26' }), true);
  assert.equal(settlementPayloadMatches('Kalshi', 'KXTEST-26', { ticker: 'OTHER-26' }), false);
  assert.equal(settlementPayloadMatches('Kalshi', 'KXTEST-26', {}), false);
  assert.equal(settlementPayloadMatches('Polymarket', '12345', { id: '12345' }), true);
  assert.equal(settlementPayloadMatches('Polymarket', '12345', { id: '54321' }), false);
  assert.equal(settlementPayloadMatches('Polymarket', '12345', {}), false);
});

test('Kalshi settlement keeps official rules, explicit outcome and settlement timestamps', () => {
  const evidence = normalizeSettlementEvidence({ platform: 'Kalshi', marketId: 'KXTEST-26', capturedAt: '2026-09-26T12:00:00.000Z', payload: {
    status: 'settled', result: 'yes', rules_primary: 'If the agency publishes X by date Y.', rules_secondary: 'See linked bulletin.', close_time: '2026-09-25T20:00:00Z', settlement_ts: '2026-09-26T11:00:00Z',
  } });
  assert.equal(evidence.market, 'prediction');
  assert.equal(evidence.status, 'settled');
  assert.equal(evidence.result, 'YES');
  assert.equal(evidence.rulesText, 'If the agency publishes X by date Y.\n\nSee linked bulletin.');
  assert.equal(evidence.determinationAt, null);
  assert.equal(evidence.settlementAt, '2026-09-26T11:00:00.000Z');
  assert.ok(evidence.rulesHash);
  assert.ok(evidence.evidenceHash);
});

test('Polymarket closing prices are never treated as a settlement result', () => {
  const evidence = normalizeSettlementEvidence({ platform: 'Polymarket', marketId: '12345', capturedAt: '2026-09-26T12:00:00.000Z', payload: {
    closed: true, outcomePrices: '["1","0"]', description: 'Resolution rules.', resolutionSource: 'https://example.org/official', closedTime: '2026-09-26T10:00:00Z',
  } });
  assert.equal(evidence.status, 'closed');
  assert.equal(evidence.result, null);
  assert.equal(evidence.resolutionSourceUrl, 'https://example.org/official');
  assert.match(evidence.reason, /未提供可核实的最终结果/);
});

test('Polymarket official resolution payout evidence determines binary outcome without reading market prices', () => {
  const conditionId = `0x${'a'.repeat(64)}`;
  const evidence = normalizeSettlementEvidence({
    platform: 'Polymarket', marketId: '12345', capturedAt: '2026-09-26T12:00:00.000Z',
    payload: { id: '12345', conditionId, closed: true, outcomes: '["Yes","No"]', outcomePrices: '["0.01","0.99"]', description: 'Official rules.' },
    resolutionPayload: { data: [{
      condition_id: conditionId, status: 'resolved', payouts: [1, 0], resolved_at: '2026-09-26T11:00:00Z',
      transaction_hash: '0xsettled', resolution_source: 'https://example.org/final-bulletin', was_disputed: false,
    }] },
  });
  assert.equal(evidence.status, 'settled');
  assert.equal(evidence.result, 'YES');
  assert.equal(evidence.determinationAt, '2026-09-26T11:00:00.000Z');
  assert.equal(evidence.settlementAt, null);
  assert.equal(evidence.resolutionEvidence.status, 'resolved');
  assert.deepEqual(evidence.resolutionEvidence.payouts, [1, 0]);
  assert.equal(evidence.resolutionEvidence.transactionHash, '0xsettled');
  assert.match(evidence.determinationSourceUrl, /data-api\.polymarket\.com\/v2\/resolutions/);
  assert.equal(evidence.resolutionSourceUrl, 'https://example.org/final-bulletin');
});

test('Polymarket payout evidence is not final unless official resolution status and binary outcome labels agree', () => {
  const conditionId = `0x${'b'.repeat(64)}`;
  const pending = normalizeSettlementEvidence({ platform: 'Polymarket', marketId: '12345', payload: { closed: true, outcomes: '["Yes","No"]', outcomePrices: '["1","0"]' }, resolutionPayload: { data: [{ condition_id: conditionId, status: 'proposed', payouts: [1, 0] }] } });
  const ambiguous = normalizeSettlementEvidence({ platform: 'Polymarket', marketId: '12345', payload: { closed: true, outcomes: '["A","B"]' }, resolutionPayload: { data: [{ condition_id: conditionId, status: 'resolved', payouts: [1, 0] }] } });
  assert.equal(pending.result, null);
  assert.equal(ambiguous.result, null);
  assert.notEqual(pending.status, 'settled');
  assert.notEqual(ambiguous.status, 'settled');
});

test('prediction announcements, active disputes and final settlements remain distinct states',()=>{
  const conditionId=`0x${'c'.repeat(64)}`;
  const announced=normalizeSettlementEvidence({platform:'Polymarket',marketId:'2468',payload:{id:'2468',closed:true,status:'closed',result:'YES',outcomes:'["Yes","No"]'},resolutionPayload:{data:[]}});
  assert.equal(announced.announcedResult,'YES');assert.equal(announced.result,null);assert.equal(announced.status,'closed');assert.equal(announced.platformStatus,'closed');
  const disputed=normalizeSettlementEvidence({platform:'Polymarket',marketId:'2468',payload:{id:'2468',conditionId,closed:true,status:'closed',outcomes:'["Yes","No"]'},resolutionPayload:{data:[{condition_id:conditionId,status:'proposed',payouts:[1,0],was_disputed:true}]}});
  assert.equal(disputed.status,'disputed');assert.equal(disputed.result,null);assert.equal(disputed.disputeStatus,'disputed');assert.equal(disputed.platformStatus,'closed');assert.equal(disputed.resolutionEvidence.status,'proposed');
});

test('explicit result is accepted but venue, id and endpoint are fixed and validated', () => {
  const evidence = normalizeSettlementEvidence({ platform: 'Polymarket', marketId: '12345', payload: { closed: true, resolved: true, result: 'NO' } });
  assert.equal(evidence.status, 'settled');
  assert.equal(evidence.result, 'NO');
  assert.equal(buildSettlementEndpoint('Kalshi', 'KXTEST-26'), 'https://external-api.kalshi.com/trade-api/v2/markets/KXTEST-26');
  assert.equal(buildSettlementEndpoint('Polymarket', '12345'), 'https://gamma-api.polymarket.com/markets/12345');
  assert.equal(buildPolymarketResolutionEndpoint(`0x${'a'.repeat(64)}`), `https://data-api.polymarket.com/v2/resolutions?condition=0x${'a'.repeat(64)}`);
  assert.throws(() => buildSettlementEndpoint('Kalshi', 'https://evil.test'), /invalid/i);
  assert.throws(() => buildPolymarketResolutionEndpoint('https://evil.test'), /invalid/i);
  assert.throws(() => buildSettlementEndpoint('Manifold', '123'), /unsupported/i);
});

test('settlement repository records rules revisions and keeps venue identities isolated', () => {
  const documents = new Map();
  const store = { get: key => documents.get(key) || null, set: (key, value) => documents.set(key, value) };
  const repository = new PredictionSettlementRepository(store);
  const first = repository.save(normalizeSettlementEvidence({ platform: 'Kalshi', marketId: 'KXTEST-26', payload: { status: 'open', rules_primary: 'Rule A' } }));
  const updated = repository.save(normalizeSettlementEvidence({ platform: 'Kalshi', marketId: 'KXTEST-26', payload: { status: 'open', rules_primary: 'Rule B' } }));
  repository.save(normalizeSettlementEvidence({ platform: 'Polymarket', marketId: '987', payload: { closed: true } }));
  assert.notEqual(first.rulesHash, updated.rulesHash);
  assert.equal(repository.history('Kalshi', 'KXTEST-26').length, 2);
  assert.equal(repository.latest('Polymarket', '987').platform, 'Polymarket');
  assert.throws(()=>repository.save({...first,instrument:'prediction:kalshi:OTHER-26'}),/identity/i);
});

test('settlement API and prediction cards expose rules, evidence and explicit unknown state', () => {
  const server = fs.readFileSync('src/web/server.ts', 'utf8');
  const html = require('./helpers/dashboard-source.cjs').readDashboardSource();
  const feature = fs.readFileSync('src/features/prediction-settlement.ts', 'utf8');
  assert.match(server, /\/api\/prediction\/settlement\/:platform\/:marketId/);
  assert.match(server, /PredictionSettlementRepository/);
  assert.match(server, /buildPolymarketResolutionEndpoint/);
  assert.match(server, /settlementPayloadMatches\(platform, marketId, payload\)/);
  assert.match(server, /resolutionPayload/);
  assert.match(html, /togglePredictionSettlement\(/);
  assert.match(html, /结算规则与证据/);
  assert.match(html,/平台公布\/报告结果/);
  assert.match(html,/结果争议中/);
  assert.match(feature, /未提供可核实的最终结果/);
  assert.match(feature,/announcedResult/);
  assert.match(server,/sourceStatus:\s*'failed'/);
  assert.match(server,/timeline:buildSettlementTimeline\(evidence,history\)/);
  assert.match(html,/prediction-settlement-timeline/);
});

test('settlement timeline distinguishes source-observed announcement, dispute, final result, unknown times and rule revisions',()=>{
 const evidence=normalizeSettlementEvidence({platform:'Polymarket',marketId:'12345',capturedAt:'2026-09-26T12:00:00Z',payload:{closed:true,status:'closed',result:'YES',close_time:'2026-09-25T12:00:00Z',conditionId:'0x'+'1'.repeat(64),rules_primary:'Original rule'}});
 const open=buildSettlementTimeline({...evidence,status:'disputed',announcedResult:'YES',disputeStatus:'disputed',result:null,determinationAt:null,settlementAt:null},[
  {...evidence,capturedAt:'2026-09-25T12:00:00Z',rulesHash:'rule-v1'},
  {...evidence,capturedAt:'2026-09-26T12:00:00Z',rulesHash:'rule-v2'},
 ]);
 assert.deepEqual(open.stages.map(row=>row.key),['close','announcement','dispute','final','capital-release']);
 assert.equal(open.stages[0].at,'2026-09-25T12:00:00.000Z');
 assert.equal(open.stages[1].timeKind,'observed');
 assert.equal(open.stages[1].at,'2026-09-25T12:00:00.000Z');
 assert.equal(open.stages[2].status,'disputed');
 assert.equal(open.stages[2].at,null);
 assert.equal(open.stages[3].status,'disputed');
 assert.equal(open.stages[3].at,null);
 assert.deepEqual(open.ruleRevisions.map(row=>row.hash),['rule-v1','rule-v2']);
 const settled=buildSettlementTimeline({...evidence,status:'settled',result:'YES',announcedResult:'YES',settlementAt:null},[]);
 assert.equal(settled.stages[3].status,'settled');
 assert.equal(settled.stages[3].at,null,'a settled state without settlement timestamp must not get a fabricated timestamp');
 assert.equal(buildSettlementTimeline({...evidence,status:'closed',result:null,announcedResult:null,disputeStatus:'unknown'},[]).stages[3].status,'unknown');
});

test('cached settlement fallback includes the same timeline as a fresh response', () => {
  const server = fs.readFileSync('src/web/server.ts', 'utf8');
  const start = server.indexOf("app.get('/api/prediction/settlement/:platform/:marketId'");
  const end = server.indexOf("app.get('/api/contracts/kline'", start);
  assert.notEqual(start, -1);
  assert.ok(end > start);
  const route = server.slice(start, end);
  assert.match(route, /timeline:buildSettlementTimeline\(evidence,history\)/);
  assert.match(route, /if\(cached\)[\s\S]*?timeline:buildSettlementTimeline\(cached,history\)/,
    'cached provider-failure response must preserve the settlement timeline');
});

test('settlement rule revision URLs are filtered to safe HTTP sources', () => {
  const evidence = normalizeSettlementEvidence({ platform: 'Kalshi', marketId: 'KXSAFE-26', capturedAt: '2026-09-26T12:00:00Z', payload: { status: 'open' } });
  const timeline = buildSettlementTimeline(evidence, [
    { ...evidence, capturedAt: '2026-09-25T12:00:00Z', rulesHash: 'bad', sourceUrl: 'javascript:alert(1)', resolutionSourceUrl: 'data:text/html,unsafe' },
    { ...evidence, capturedAt: '2026-09-26T12:00:00Z', rulesHash: 'safe', sourceUrl: 'https://example.org/rules' },
  ]);
  assert.deepEqual(timeline.ruleRevisions.map(row => row.sourceUrl), [null, 'https://example.org/rules']);
});
test('settlement audit exposes contradictory outcomes and observed waiting time without inventing withdrawal availability',()=>{
 const evidence=normalizeSettlementEvidence({platform:'Polymarket',marketId:'12345',capturedAt:'2026-09-26T12:00:00Z',payload:{closed:true,status:'closed',result:'YES',close_time:'2026-09-25T12:00:00Z',conditionId:'0x'+'1'.repeat(64),rules_primary:'Original rule'}});
 const current={...evidence,status:'settled',result:'NO',announcedResult:'YES',settlementAt:'2026-09-26T00:00:00Z'};
 const timeline=buildSettlementTimeline(current,[{...evidence,status:'settled',result:'YES',capturedAt:'2026-09-25T18:00:00Z'}]);
 assert.equal(timeline.audit.conflicts.length,1);assert.equal(timeline.audit.resultRevisions.length,1);assert.equal(timeline.audit.observedWaitMs,43200000);assert.equal(timeline.audit.capitalReleaseAt,null);
 assert.match(timeline.audit.reason,/资金|提现/);
 const unknown=buildSettlementTimeline({...current,closeAt:null,settlementAt:null},[]);assert.equal(unknown.audit.observedWaitMs,null);
});

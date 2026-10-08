const test=require('node:test'),assert=require('node:assert/strict');
const release=require('../scripts/telegram-result-release.cjs');
const snapshot=()=>({market:'crypto',instrument:'crypto:gateio:BTC_USDT',
  sections:{funding:{dataStatus:'delayed',source:'https://api.gateio.ws/api/v4/futures/usdt/funding_rate?contract=BTC_USDT&limit=100'}},
  funding:[{at:'2026-10-08T08:00:00.000Z',ratePct:0.01},{at:'2026-10-08T00:00:00.000Z',ratePct:0}]});
test('result acceptance detects a receipt/reply-capable transport before sending an original message',()=>{
  require('ts-node/register/transpile-only');
  const {TelegramApiTransport}=require('../src/features/telegram-bot');
  assert.equal(new TelegramApiTransport('unused-test-token').resultReplyProtocolVersion,1);
});
test('real result release chooses the newest uniquely identified completed source record',()=>{
  const detail=snapshot(),copy=structuredClone(detail),event=release.selectFundingEvent(detail,Date.parse('2026-10-08T09:00:00Z'));
  assert.equal(event.date,'2026-10-08T08:00:00.000Z');assert.equal(event.instrument,detail.instrument);
  assert.equal(event.kind,'funding');assert.equal(event.actual,undefined);assert.deepEqual(detail,copy);
});
test('result verification never manufactures evidence from empty, failed, cross-market or future rows',()=>{
  for(const patch of [{market:'stocks'},{instrument:'crypto:gateio:OTHER_USDT'},
    {funding:[]},{funding:[{at:'2026-10-09T00:00:00.000Z',ratePct:0.01}]},
    {funding:[{at:'2026-10-08T08:00:00.000Z',ratePct:NaN}]},
    {sections:{funding:{dataStatus:'unavailable',source:snapshot().sections.funding.source}}}])
    assert.throws(()=>release.selectFundingEvent({...snapshot(),...patch},Date.parse('2026-10-08T09:00:00Z')));
  const duplicate=snapshot();duplicate.funding.push({...duplicate.funding[0]});
  assert.throws(()=>release.selectFundingEvent(duplicate,Date.parse('2026-10-08T09:00:00Z')));
});
test('result release rejects nonofficial funding sources and invalid source numbers',()=>{
  for(const source of ['http://api.gateio.ws/api/v4/futures/usdt/funding_rate',
    'https://api.gateio.ws.evil.test/api/v4/futures/usdt/funding_rate',
    'https://user:secret@api.gateio.ws/api/v4/futures/usdt/funding_rate']) {
    const detail=snapshot();detail.sections.funding.source=source;
    assert.throws(()=>release.selectFundingEvent(detail,Date.parse('2026-10-08T09:00:00Z')));
  }
});
